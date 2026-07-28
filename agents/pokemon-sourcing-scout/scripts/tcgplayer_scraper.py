#!/usr/bin/env python3
"""TCGplayer daily market price feed for pokemon-ops Phase 6.

Emits one CSV row per target sealed Booster Pack product per day, in the
shared price-observation format consumed by
``scripts/pokemon-ops-import.ts observations <csv>``:

    observed_date,source,set_name,form,price_per_pack_usd,lot_size,
    includes_shipping,includes_tax,listing_ref,notes

Source: tcgcsv.com (https://tcgcsv.com/), a third-party mirror that republishes
TCGplayer's own category/group/product/price data as daily JSON dumps. See
README.md's "TCGplayer feed" section for the full source-choice writeup.
tcgplayer.com itself is not scraped (bot-blocked; out of scope by design).

Endpoints used (Pokemon = categoryId 3):
  - https://tcgcsv.com/tcgplayer/3/groups             -> list of all groups
                                                          (set-level; used only
                                                          to build/refresh the
                                                          mapping table below,
                                                          not at scrape time)
  - https://tcgcsv.com/tcgplayer/3/{groupId}/products  -> products in a group
  - https://tcgcsv.com/tcgplayer/3/{groupId}/prices    -> prices in a group,
                                                          keyed by productId

IMPORTANT: tcgcsv.com returns HTTP 401 for the default Python `requests`/
`urllib` User-Agent string. A browser-/curl-like User-Agent header is
required (see USER_AGENT below). This was confirmed live 2026-07-17.

Product selection rule: within a mapped group, the target product is the one
whose exact name is "{set_name} Booster Pack". This is deliberately an exact
string match (not a substring/regex). It was verified against all 14 mapped
groups' real product lists and cleanly excludes "Sleeved Booster Pack",
"Booster Pack Art Bundle [Set of 4]", and "Code Card - ... Booster Pack",
which all exist as separate SKUs and would otherwise false-positive on a
looser "contains 'booster pack'" match.

Price selection: marketPrice, falling back to midPrice if marketPrice is
null/missing (documented in the `notes` column of the emitted row as
"price=marketPrice" or "price=midPrice_fallback"). If neither is available
the product is skipped with a stderr note (no row emitted, since a required price
field can never be blank in the downstream importer).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

CATEGORY_ID = 3  # Pokemon, on tcgcsv.com
BASE_URL = "https://tcgcsv.com/tcgplayer"

# tcgcsv.com 401s on the default python-requests/urllib User-Agent; a
# curl-like UA works. Confirmed live 2026-07-17.
USER_AGENT = "curl/8.5.0"

# Reviewed 2026-07-17 against the live https://tcgcsv.com/tcgplayer/3/groups
# listing (217 groups at the time), for our 15 active `booster` products in
# pk_products. Each entry is the tcgcsv groupId for that set's TCGplayer
# group. A set with no TCGplayer group yet is mapped to None and skipped
# (stderr note) rather than omitted, so the table stays the single reviewed
# source of truth for all 15 canonical set names.
#
# Fuzzy-mapping note: "Mega Evolution" is ambiguous by substring. The live
# group list also has "ME: Mega Evolution Promo" (24451) and "MEE: Mega
# Evolution Energies" (24461) alongside the actual base-set group "ME01:
# Mega Evolution" (24380). We hard-code 24380 (the main numbered set group,
# not a promo/energy spinoff) rather than fuzzy-matching at runtime.
SET_NAME_TO_GROUP: dict[str, Optional[int]] = {
    "Phantasmal Flames": 24448,       # ME02: Phantasmal Flames
    "Mega Evolution": 24380,          # ME01: Mega Evolution (see fuzzy note above)
    "Destined Rivals": 24269,         # SV10: Destined Rivals
    "Journey Together": 24073,        # SV09: Journey Together
    "Paldean Fates": 23353,           # SV: Paldean Fates
    "151": 23237,                     # SV: Scarlet & Violet 151
    "Pitch Black": 24688,             # ME05: Pitch Black
    "Chaos Rising": 24655,            # ME04: Chaos Rising
    "Perfect Order": 24587,           # ME03: Perfect Order
    "Ascended Heroes": 24541,         # ME: Ascended Heroes
    "White Flare": 24326,             # SV: White Flare
    "Black Bolt": 24325,              # SV: Black Bolt
    "Surging Sparks": 23651,          # SV08: Surging Sparks
    "Prismatic Evolutions": 23821,    # SV: Prismatic Evolutions
    "Storm Emerald": None,            # not yet released (2026-07-31 per DB);
                                       # no TCGplayer group exists as of
                                       # 2026-07-17, skip with stderr note.
}

CSV_HEADER = [
    "observed_date",
    "source",
    "set_name",
    "form",
    "price_per_pack_usd",
    "lot_size",
    "includes_shipping",
    "includes_tax",
    "listing_ref",
    "notes",
]


@dataclass
class Row:
    observed_date: str
    set_name: str
    price_per_pack_usd: str
    listing_ref: str
    notes: str

    def as_csv_row(self) -> list[str]:
        return [
            self.observed_date,
            "tcgplayer",
            self.set_name,
            "booster",
            self.price_per_pack_usd,
            "1",
            "0",
            "0",
            self.listing_ref,
            self.notes,
        ]


class FetchError(RuntimeError):
    pass


def _fetch_json_live(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise FetchError(f"HTTP {e.code} fetching {url}") from e
    except urllib.error.URLError as e:
        raise FetchError(f"network error fetching {url}: {e}") from e


def _fetch_json_fixture(fixture_dir: Path, group_id: int, kind: str) -> dict:
    path = fixture_dir / f"{group_id}_{kind}.json"
    if not path.exists():
        raise FetchError(f"fixture file not found: {path}")
    return json.loads(path.read_text())


def get_group_data(group_id: int, *, live: bool, fixture_dir: Optional[Path]) -> tuple[dict, dict]:
    """Returns (products_json, prices_json) for a group."""
    if live:
        products = _fetch_json_live(f"{BASE_URL}/{CATEGORY_ID}/{group_id}/products")
        prices = _fetch_json_live(f"{BASE_URL}/{CATEGORY_ID}/{group_id}/prices")
        return products, prices
    assert fixture_dir is not None
    products = _fetch_json_fixture(fixture_dir, group_id, "products")
    prices = _fetch_json_fixture(fixture_dir, group_id, "prices")
    return products, prices


def find_booster_pack_product(products_json: dict, set_name: str) -> Optional[dict]:
    """Exact-name match: "{set_name} Booster Pack". See module docstring for
    why this is exact rather than substring-based."""
    target = f"{set_name} Booster Pack"
    for r in products_json.get("results", []):
        if r.get("name") == target:
            return r
    return None


def find_price_for_product(prices_json: dict, product_id: int) -> Optional[tuple[float, str]]:
    """Returns (price, notes_suffix) using marketPrice, falling back to
    midPrice. Returns None if neither is available."""
    for r in prices_json.get("results", []):
        if r.get("productId") != product_id:
            continue
        market = r.get("marketPrice")
        if market is not None:
            return float(market), "price=marketPrice"
        mid = r.get("midPrice")
        if mid is not None:
            return float(mid), "price=midPrice_fallback"
        return None
    return None


def build_rows(
    observed_date: str,
    *,
    live: bool,
    fixture_dir: Optional[Path],
) -> list[Row]:
    rows: list[Row] = []
    for set_name in sorted(SET_NAME_TO_GROUP):
        group_id = SET_NAME_TO_GROUP[set_name]
        if group_id is None:
            print(
                f"skip: {set_name!r} has no TCGplayer group mapped yet (unreleased)",
                file=sys.stderr,
            )
            continue
        try:
            products_json, prices_json = get_group_data(
                group_id, live=live, fixture_dir=fixture_dir
            )
        except FetchError as e:
            print(f"skip: {set_name!r} (group {group_id}): {e}", file=sys.stderr)
            continue

        product = find_booster_pack_product(products_json, set_name)
        if product is None:
            print(
                f"skip: {set_name!r} (group {group_id}): no product named "
                f"'{set_name} Booster Pack' found",
                file=sys.stderr,
            )
            continue

        product_id = product["productId"]
        price_result = find_price_for_product(prices_json, product_id)
        if price_result is None:
            print(
                f"skip: {set_name!r} (group {group_id}, product {product_id}): "
                f"no marketPrice or midPrice available",
                file=sys.stderr,
            )
            continue
        price, notes = price_result

        listing_ref = product.get("url") or (
            f"https://tcgcsv.com/tcgplayer/{CATEGORY_ID}/{group_id}/products#{product_id}"
        )

        rows.append(
            Row(
                observed_date=observed_date,
                set_name=set_name,
                price_per_pack_usd=f"{price:.2f}",
                listing_ref=listing_ref,
                notes=notes,
            )
        )

    # Deterministic order: sort by set_name (already iterated in sorted
    # order above, but re-sort explicitly so output order never depends on
    # dict-iteration semantics).
    rows.sort(key=lambda r: r.set_name)
    return rows


def write_csv(rows: list[Row], out_path: Path) -> None:
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(CSV_HEADER)
        for row in rows:
            writer.writerow(row.as_csv_row())


def missing_mapped_sets(rows: list[Row]) -> list[str]:
    """Mapped/released sets that did not produce exactly one usable row."""
    expected = {name for name, group_id in SET_NAME_TO_GROUP.items() if group_id is not None}
    observed = {row.set_name for row in rows}
    return sorted(expected - observed)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="output CSV path")
    parser.add_argument(
        "--fixture-dir",
        default=None,
        help="read recorded JSON fixtures from this directory instead of live HTTP",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="fetch from tcgcsv.com over HTTP instead of fixtures",
    )
    parser.add_argument(
        "--observed-date",
        default=None,
        help="override observed_date (default: today's UTC date, YYYY-MM-DD); "
        "mainly for deterministic testing",
    )
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="exit non-zero unless every mapped/released set produced one usable row",
    )
    args = parser.parse_args(argv)

    if args.live and args.fixture_dir:
        parser.error("--live and --fixture-dir are mutually exclusive")
    if not args.live and not args.fixture_dir:
        parser.error("one of --live or --fixture-dir is required")

    fixture_dir = Path(args.fixture_dir) if args.fixture_dir else None
    observed_date = args.observed_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    rows = build_rows(observed_date, live=args.live, fixture_dir=fixture_dir)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_csv(rows, out_path)

    print(f"wrote {len(rows)} rows to {out_path}", file=sys.stderr)
    missing = missing_mapped_sets(rows)
    if args.require_complete and missing:
        print(
            "fatal: incomplete TCGplayer coverage; missing mapped sets: " + ", ".join(missing),
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
