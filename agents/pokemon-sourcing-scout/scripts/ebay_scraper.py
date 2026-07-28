#!/usr/bin/env python3
"""eBay sourcing scraper for pokemon-ops Phase 6.

Daily scan of eBay SOLD and ACTIVE bulk-lot listings for target Pokemon
booster sets. Emits price observations as CSV rows matching the
pokemon-ops shared observation importer format exactly:

    observed_date,source,set_name,form,price_per_pack_usd,lot_size,
    includes_shipping,includes_tax,listing_ref,notes

Deterministic, no LLM calls. Two input modes:

  --fixture-dir DIR   parse saved HTML pages from DIR (test mode)
  --live              attempt real network fetches via the fallback ladder

Exactly one of --fixture-dir / --live must be given.

FETCH LADDER (see README "eBay scraper" section for the compliance
posture and the verified results):
  1. requests with normal desktop-browser headers.
  2. headless system chromium (/usr/bin/chromium --headless=new
     --dump-dom) driven as a subprocess.
  2b. headless chromium reusing one persistent --user-data-dir for the
     lifetime of the process, so a run is one browser session rather
     than N unrelated ones.
  3. if every rung returns a blocked/error page for every query: log a
     clear stderr note and exit 0 with 0 rows, so the dispatcher and the
     TCGplayer feed still run. This script must never hard-fail just
     because eBay declined to serve it, and it must never escalate.

Request volume is deliberately small (one sold-search plus one
active-search per target set per day, capped by --max-per-set) with a
sleep between queries. looks_blocked() recognizes eBay's own error-page
markers so a block is treated as a stop signal, not as data.

The load-bearing output constraint is currency. eBay renders prices in
the currency of the viewer's geolocated site, so from a non-US egress
the same listings come back in local currency with no USD figure
anywhere in the page. The CSV contract is USD-only and this scraper is
deterministic (no live FX lookup), so build_row DROPS non-USD-priced
cards ("non_usd_price" skip). A run can therefore parse a full results
page and still emit 0 rows; from a US-geolocated egress those same
cards flow straight through with no code change.

LOT-SIZE HEURISTIC TABLE (checked in this order against the lowercased
title + subtitle/description text; first match wins):

  1. "case of N box(es)"                          -> N * 36 packs
  2. "N box(es)" / "box(es) x N" / "N x box(es)"   -> N * 36 packs
     (booster-box count, with or without the word "booster")
  3. "lot of N"                                    -> N packs
  4. "N x" / "x N"  (generic multiplier, not already -> N packs
     claimed by a box rule above)
  5. "N pack(s)" / "N pk(s)"                       -> N packs
  6. bare "booster box" (no number found anywhere)  -> 36 packs
     (a booster box is 36 packs for every currently active target set)
  7. nothing matches                               -> lot size unknown;
     row is DROPPED (a $/pack figure cannot be computed without a lot
     size) and a reason is logged to stderr.

EXCLUSIONS (checked before lot-size parsing; listing dropped, reason
logged to stderr):
  - ETB / Elite Trainer Box listings (operator doctrine: box premium
    wasted on ETBs, Phase 6 spec explicitly excludes them).
  - graded/slab singles: "PSA", "BGS", "CGC", "SGC", "graded", "slab".
  - non-sealed listings: "opened", "unsealed", "resealed", "empty box",
    "box only", "no packs", "display only".

SET DETECTION: each listing card's title/subtitle is matched against the
canonical set names read read-only from pk_products (active=1,
form='booster') via `SELECT set_name FROM pk_products WHERE active=1
AND form='booster'`. A listing whose title doesn't contain any target
set name (case-insensitive, word-bounded) is skipped as "unknown set".
Search results are never perfectly on-topic, so this is a real safety
net, not just test scaffolding.
"""
from __future__ import annotations

import argparse
import atexit
import csv
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import quote_plus

try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover - environment guard
    BeautifulSoup = None  # type: ignore

try:
    import requests
except ImportError:  # pragma: no cover - environment guard
    requests = None  # type: ignore

DEFAULT_DB_PATH = os.environ.get(
    "RATHWORKSPACE_DB",
    str(Path(__file__).resolve().parents[3] / "data" / "rathworkspace.db"),
)
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

CHROMIUM_BIN = "/usr/bin/chromium"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

# Markers that mean "this is eBay's bot-block / captcha / error page, not a
# real search results page", used to decide whether a fetched page is usable.
BLOCK_MARKERS = (
    "error page | ebay",
    "something went wrong on our end",
    "pardon our interruption",
    "captcha",
    "are you a human",
)


# --------------------------------------------------------------------------
# Exclusions
# --------------------------------------------------------------------------

EXCLUSION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("etb_excluded", re.compile(r"\betb\b|elite\s*trainer\s*box", re.I)),
    (
        "graded_slab_excluded",
        re.compile(r"\b(psa|bgs|cgc|sgc)\b\s*\d*|\bgraded\b|\bslab(bed)?\b", re.I),
    ),
    (
        "non_sealed_excluded",
        re.compile(
            r"\b(opened|unsealed|resealed|empty\s*box|box\s*only|no\s*packs?|display\s*only)\b",
            re.I,
        ),
    ),
]


def find_exclusion(text: str) -> Optional[str]:
    for reason, pattern in EXCLUSION_RULES:
        if pattern.search(text):
            return reason
    return None


# --------------------------------------------------------------------------
# Lot-size heuristics
# --------------------------------------------------------------------------

_BOX_WORD = r"box(?:es)?"


def _rule_case_of_boxes(text: str) -> Optional[tuple[int, str]]:
    m = re.search(rf"case\s*of\s*(\d+)\s*{_BOX_WORD}", text, re.I)
    if m:
        n = int(m.group(1))
        return n * 36, "case_of_boxes"
    return None


def _rule_n_boxes(text: str) -> Optional[tuple[int, str]]:
    # "2 booster boxes", "2x booster box", "booster box x2", "booster boxes x 2"
    patterns = [
        rf"(\d+)\s*x\s*(?:booster\s*)?{_BOX_WORD}",
        rf"(?:booster\s*)?{_BOX_WORD}\s*x\s*(\d+)",
        rf"(\d+)\s*(?:booster\s*)?{_BOX_WORD}\b",
    ]
    for p in patterns:
        m = re.search(p, text, re.I)
        if m:
            n = int(m.group(1))
            if n > 0:
                return n * 36, "n_booster_boxes"
    return None


def _rule_lot_of_n(text: str) -> Optional[tuple[int, str]]:
    # Live eBay titles routinely bracket the count: "Lot of (72) ...".
    m = re.search(r"lot\s*of\s*\(?\s*(\d+)", text, re.I)
    if m:
        return int(m.group(1)), "lot_of_n"
    return None


def _rule_generic_x_n(text: str) -> Optional[tuple[int, str]]:
    for p in (r"(\d+)\s*x\b", r"\bx\s*(\d+)\b"):
        m = re.search(p, text, re.I)
        if m:
            n = int(m.group(1))
            if n > 0:
                return n, "x_n"
    return None


def _rule_n_packs(text: str) -> Optional[tuple[int, str]]:
    m = re.search(r"(\d+)\s*p(?:ac)?ks?\b", text, re.I)
    if m:
        return int(m.group(1)), "n_packs"
    return None


def _rule_booster_box_default(text: str) -> Optional[tuple[int, str]]:
    if re.search(rf"booster\s*{_BOX_WORD}", text, re.I):
        return 36, "booster_box_default"
    return None


# Order matters: box-count rules must run before the generic "x N" / "N
# packs" rules, or "2 booster boxes" would be misread as lot_size=2.
LOT_SIZE_RULES = [
    _rule_case_of_boxes,
    _rule_n_boxes,
    _rule_lot_of_n,
    _rule_generic_x_n,
    _rule_n_packs,
    _rule_booster_box_default,
]


def detect_lot_size(text: str) -> Optional[tuple[int, str]]:
    for rule in LOT_SIZE_RULES:
        result = rule(text)
        if result:
            return result
    return None


# --------------------------------------------------------------------------
# Set detection
# --------------------------------------------------------------------------


def get_target_sets(db_path: str) -> list[str]:
    """Read-only: canonical active booster set names from pk_products."""
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        cur = conn.execute(
            "SELECT set_name FROM pk_products WHERE active=1 AND form='booster'"
        )
        return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def _set_name_pattern(name: str) -> re.Pattern[str]:
    return re.compile(r"\b" + re.escape(name) + r"\b", re.I)


def detect_set(text: str, target_sets: Iterable[str]) -> Optional[str]:
    # Longest names first so a shorter name can't shadow a longer, more
    # specific one that happens to contain it.
    for name in sorted(target_sets, key=len, reverse=True):
        if _set_name_pattern(name).search(text):
            return name
    return None


# --------------------------------------------------------------------------
# Price / shipping parsing
# --------------------------------------------------------------------------


def parse_money(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    if re.search(r"\bfree\b", text, re.I):
        return 0.0
    m = re.search(r"\$\s*([\d,]+\.?\d*)", text)
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


# eBay renders prices in the currency of the *viewer's* geolocated site,
# not the listing's. From an egress IP that geolocates outside the US the
# same global listings come back priced in BRL ("R$ 7,493.96"), GBP, EUR,
# and so on. A bare "$"-anchored parse would silently read "R$ 7,493.96"
# as 7493.96 *dollars*, corrupting the $/pack figure. The CSV contract is
# USD-only, so any price carrying a non-USD currency marker must be
# dropped, not converted (an FX rate is a time-varying external input this
# deterministic scraper must not take).
NON_USD_CURRENCY = re.compile(
    r"(R\$|C\s*\$|CA\s*\$|AU\s*\$|A\s*\$|NZ\s*\$|HK\s*\$|S\$|£|€|¥|₩|"
    r"\b(?:EUR|GBP|BRL|CAD|AUD|NZD|JPY|CHF|CNY|MXN|INR)\b)",
    re.I,
)


def is_usd_price(text: Optional[str]) -> bool:
    """True when a price string is plain US dollars (no foreign marker).

    "US $189.99" and "$189.99" are USD; "R$ 7,493.96" / "£120" / "120 EUR"
    are not. Empty/None is treated as USD-neutral (no price to reject here;
    the missing-price path handles it downstream).
    """
    if not text:
        return True
    return NON_USD_CURRENCY.search(text) is None


# --------------------------------------------------------------------------
# Listing card model + row building
# --------------------------------------------------------------------------


@dataclass
class ListingCard:
    item_id: str
    url: str
    title: str
    subtitle: str
    price_text: Optional[str]
    shipping_text: Optional[str]


def build_row(
    card: ListingCard,
    source: str,
    target_sets: Iterable[str],
    observed_date: str,
) -> tuple[Optional[dict], Optional[str]]:
    """Returns (row, None) on success or (None, skip_reason) when dropped."""
    combined_text = f"{card.title} {card.subtitle}"

    excl = find_exclusion(combined_text)
    if excl:
        return None, f"{excl}: {card.item_id}"

    set_name = detect_set(combined_text, target_sets)
    if set_name is None:
        return None, f"unknown_set: {card.item_id} title={card.title!r}"

    # Currency is a hard reject independent of lot size: a foreign-currency
    # price can never yield a USD $/pack, so drop it before spending effort
    # on lot parsing.
    if not is_usd_price(card.price_text):
        return None, (
            f"non_usd_price: {card.item_id} price={card.price_text!r} "
            "(non-US eBay site served; USD-only per CSV contract)"
        )

    lot = detect_lot_size(combined_text)
    if lot is None:
        return None, f"lot_size_undetermined: {card.item_id} title={card.title!r}"
    lot_size, rule_name = lot

    price = parse_money(card.price_text)
    if price is None:
        return None, f"price_undetermined: {card.item_id} title={card.title!r}"
    shipping = parse_money(card.shipping_text) or 0.0

    total = price + shipping
    price_per_pack = total / lot_size

    notes = (
        f"lot_size={lot_size} ({rule_name}); price=${price:.2f} + "
        f"shipping=${shipping:.2f}; title={card.title!r}"
    )

    row = {
        "observed_date": observed_date,
        "source": source,
        "set_name": set_name,
        "form": "booster",
        "price_per_pack_usd": f"{price_per_pack:.4f}",
        "lot_size": str(lot_size),
        "includes_shipping": "1",
        "includes_tax": "",
        "listing_ref": card.url or card.item_id,
        "notes": notes,
    }
    return row, None


# --------------------------------------------------------------------------
# HTML parsing (BeautifulSoup): real eBay search-result card structure
# --------------------------------------------------------------------------


def _card_from_li(li) -> Optional[ListingCard]:
    link = li.select_one("a.s-item__link")
    if link is None:
        return None
    href = link.get("href", "")
    m = re.search(r"/itm/(\d+)", href)
    item_id = m.group(1) if m else href

    title_el = li.select_one(".s-item__title")
    title = title_el.get_text(" ", strip=True) if title_el else ""
    if title.lower() in ("shop on ebay", ""):
        return None  # eBay's perennial placeholder first card

    subtitle_el = li.select_one(".s-item__subtitle")
    subtitle = subtitle_el.get_text(" ", strip=True) if subtitle_el else ""

    price_el = li.select_one(".s-item__price")
    price_text = price_el.get_text(" ", strip=True) if price_el else None

    shipping_el = li.select_one(".s-item__shipping, .s-item__logisticsCost")
    shipping_text = shipping_el.get_text(" ", strip=True) if shipping_el else None

    return ListingCard(
        item_id=item_id,
        url=href.split("?")[0] if href else f"https://www.ebay.com/itm/{item_id}",
        title=title,
        subtitle=subtitle,
        price_text=price_text,
        shipping_text=shipping_text,
    )


_TITLE_TAIL = re.compile(r"\s*opens in a new window or tab\s*$", re.I)


def _card_from_scard(li) -> Optional[ListingCard]:
    """Parse eBay's current search-result card DOM (`li.s-card`).

    eBay migrated the SRP off the legacy `li.s-item` / `.s-item__title`
    markup that `_card_from_li` (and the hand-built fixtures) target onto a
    `.s-card` / `.su-card-container` structure: title in `.s-card__title`
    (with a trailing "Opens in a new window or tab" a11y suffix to strip),
    price in `.s-card__price`, and shipping in whichever
    `.s-card__attribute-row` mentions shipping. Verified live 2026-07-17.
    """
    link = li.select_one("a[href*='/itm/']")
    if link is None:
        return None
    href = link.get("href", "")
    m = re.search(r"/itm/(\d+)", href)
    item_id = m.group(1) if m else href

    title_el = li.select_one(".s-card__title")
    title = title_el.get_text(" ", strip=True) if title_el else ""
    title = _TITLE_TAIL.sub("", title).strip()
    if title.lower() in ("shop on ebay", ""):
        return None  # eBay's perennial placeholder card

    subtitle_el = li.select_one(".s-card__subtitle")
    subtitle = subtitle_el.get_text(" ", strip=True) if subtitle_el else ""

    price_el = li.select_one(".s-card__price")
    price_text = price_el.get_text(" ", strip=True) if price_el else None

    shipping_text = None
    for row in li.select(".s-card__attribute-row"):
        row_text = row.get_text(" ", strip=True)
        if "shipping" in row_text.lower() or re.search(r"\bfree\b", row_text, re.I):
            shipping_text = row_text
            break

    canonical_url = href.split("?")[0] if href else f"https://www.ebay.com/itm/{item_id}"
    # Normalise the host: live cards sometimes emit bare "ebay.com/itm/..".
    canonical_url = re.sub(r"^https?://(www\.)?ebay\.com", "https://www.ebay.com", canonical_url)
    return ListingCard(
        item_id=item_id,
        url=canonical_url,
        title=title,
        subtitle=subtitle,
        price_text=price_text,
        shipping_text=shipping_text,
    )


def parse_search_page(
    html: str,
    source: str,
    target_sets: Iterable[str],
    observed_date: str,
    max_rows: Optional[int] = None,
) -> tuple[list[dict], list[str]]:
    """Parse one saved/fetched eBay search-result page into observation rows.

    Returns (rows, skip_reasons). `source` must be 'ebay_sold' or
    'ebay_active'. The caller decides this from which query produced the
    page (eBay's sold-search and active-search are distinct URLs/pages,
    never mixed on one page).

    Handles both eBay SRP DOM generations: the legacy `li.s-item` markup
    (what the hand-built fixtures use) and the current `li.s-card` markup
    (what a live fetch returns as of 2026-07). A page is parsed with
    whichever card selector actually matches, so legacy fixtures and live
    pages both work without a flag.
    """
    if BeautifulSoup is None:
        raise RuntimeError("beautifulsoup4 is not installed in this interpreter")

    soup = BeautifulSoup(html, "html.parser")

    legacy = soup.select("li.s-item")
    if legacy:
        cards_html, extract = legacy, _card_from_li
    else:
        cards_html, extract = soup.select("li.s-card"), _card_from_scard

    rows: list[dict] = []
    skips: list[str] = []
    for li in cards_html:
        card = extract(li)
        if card is None:
            continue
        row, skip_reason = build_row(card, source, target_sets, observed_date)
        if row is not None:
            rows.append(row)
            if max_rows is not None and len(rows) >= max_rows:
                break
        else:
            skips.append(skip_reason)
    return rows, skips


def looks_blocked(html: str) -> bool:
    lowered = html.lower()
    if any(marker in lowered for marker in BLOCK_MARKERS):
        return True
    # A real SRP carries listing cards in one of the two DOM generations
    # (legacy `s-item`, current `s-card`); a block/error page carries
    # neither. Accept either so the check survives eBay's DOM migration.
    return "s-item" not in lowered and "s-card" not in lowered


# --------------------------------------------------------------------------
# Live fetch ladder
# --------------------------------------------------------------------------


def build_search_url(set_name: str, sold: bool) -> str:
    query = quote_plus(f"pokemon {set_name} booster pack lot")
    url = f"https://www.ebay.com/sch/i.html?_nkw={query}"
    if sold:
        url += "&LH_Sold=1&LH_Complete=1"
    return url


def fetch_via_requests(url: str) -> Optional[str]:
    if requests is None:
        print("rung1 (requests): module not available", file=sys.stderr)
        return None
    try:
        resp = requests.get(url, headers=BROWSER_HEADERS, timeout=20)
    except Exception as exc:  # noqa: BLE001
        print(f"rung1 (requests) fetch error for {url}: {exc}", file=sys.stderr)
        return None
    print(f"rung1 (requests): {url} -> HTTP {resp.status_code}", file=sys.stderr)
    if resp.status_code != 200:
        return None
    if looks_blocked(resp.text):
        print("rung1 (requests): response looks like a block/captcha page", file=sys.stderr)
        return None
    return resp.text


def fetch_via_chromium(url: str, timeout_s: int = 30) -> Optional[str]:
    if not Path(CHROMIUM_BIN).exists():
        print(f"rung2 (chromium): {CHROMIUM_BIN} not found", file=sys.stderr)
        return None
    cmd = [
        CHROMIUM_BIN,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--dump-dom",
        "--virtual-time-budget=8000",
        url,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s
        )
    except Exception as exc:  # noqa: BLE001
        print(f"rung2 (chromium) subprocess error for {url}: {exc}", file=sys.stderr)
        return None
    html = proc.stdout or ""
    print(
        f"rung2 (chromium): {url} -> exit {proc.returncode}, {len(html)} bytes dumped",
        file=sys.stderr,
    )
    if not html:
        return None
    if looks_blocked(html):
        print("rung2 (chromium): response looks like a block/captcha page", file=sys.stderr)
        return None
    return html


_SESSION_PROFILE_DIR: Optional[str] = None
_SESSION_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _cleanup_session_profile() -> None:
    global _SESSION_PROFILE_DIR
    if _SESSION_PROFILE_DIR:
        shutil.rmtree(_SESSION_PROFILE_DIR, ignore_errors=True)
        _SESSION_PROFILE_DIR = None


atexit.register(_cleanup_session_profile)


def _chromium_dump(url: str, profile_dir: str, timeout_s: int, budget_ms: int) -> tuple[int, str]:
    cmd = [
        CHROMIUM_BIN,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        f"--user-data-dir={profile_dir}",
        f"--user-agent={_SESSION_UA}",
        "--window-size=1366,768",
        "--lang=en-US",
        "--accept-lang=en-US,en",
        f"--virtual-time-budget={budget_ms}",
        f"--timeout={timeout_s * 1000}",
        "--dump-dom",
        url,
    ]
    try:
        # Generous outer wall-clock margin over the page-load timeout: eBay's
        # SRP is a heavy page and the first fetch of a process can take
        # ~50-80s end to end even when it ultimately succeeds.
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s + 45)
    except Exception as exc:  # noqa: BLE001
        print(f"rung2b (session chromium) subprocess error for {url}: {exc}", file=sys.stderr)
        return -1, ""
    return proc.returncode, proc.stdout or ""


def fetch_via_session_chromium(url: str) -> Optional[str]:
    """Rung 2b: headless chromium reusing one persistent profile per process.

    Rungs 1 and 2 treat every query as an unrelated first visit. This rung
    creates a single `--user-data-dir` for the lifetime of the process,
    opens the site's entry page once, and then issues the search fetches
    through that same profile, so one scraper run looks like one browser
    session instead of N disconnected ones. The profile is a temp dir and
    is removed on exit (`_cleanup_session_profile`).

    If the response still comes back as the site's block/error page,
    `looks_blocked()` catches it and this rung returns None so the caller
    degrades to rung 3 (0 rows, exit 0). No retry escalation, no proxying.
    """
    global _SESSION_PROFILE_DIR
    if not Path(CHROMIUM_BIN).exists():
        print(f"rung2b (session chromium): {CHROMIUM_BIN} not found", file=sys.stderr)
        return None

    if _SESSION_PROFILE_DIR is None:
        import tempfile

        _SESSION_PROFILE_DIR = tempfile.mkdtemp(prefix="ebay_session_")
        rc, home = _chromium_dump(
            "https://www.ebay.com/", _SESSION_PROFILE_DIR, timeout_s=60, budget_ms=12000
        )
        # The entry page carries no s-item/s-card cards, so the full
        # looks_blocked() check would false-positive on it, and it mentions
        # "captcha" in its own JS, so the BLOCK_MARKERS list would too. The
        # only meaningful signal here is "rendered, and not the site's error
        # page", whose telltale is the "Error Page | eBay" <title>. This is a
        # diagnostic print, not a gate.
        session_ok = bool(home) and "error page | ebay" not in home.lower()
        print(
            f"rung2b (session chromium): entry page exit {rc}, {len(home)} bytes, "
            f"session established={session_ok}",
            file=sys.stderr,
        )

    # The first /sch fetch of a process is occasionally slow enough to hit the
    # page-load timeout and come back empty; one retry against the same
    # profile covers that without escalating request volume.
    for attempt in (1, 2):
        rc, html = _chromium_dump(url, _SESSION_PROFILE_DIR, timeout_s=70, budget_ms=12000)
        print(
            f"rung2b (session chromium) attempt {attempt}: {url} -> exit {rc}, "
            f"{len(html)} bytes dumped",
            file=sys.stderr,
        )
        if not html:
            continue
        if looks_blocked(html):
            print(
                "rung2b (session chromium): response looks like a block/captcha page",
                file=sys.stderr,
            )
            return None
        return html
    return None


def fetch_page(url: str) -> Optional[str]:
    """Rung 1 -> rung 2 -> rung 2b -> None (rung 3: caller degrades)."""
    html = fetch_via_requests(url)
    if html is not None:
        return html
    html = fetch_via_chromium(url)
    if html is not None:
        return html
    html = fetch_via_session_chromium(url)
    if html is not None:
        return html
    print(f"rung3: eBay blocked/unusable on all rungs for {url}", file=sys.stderr)
    return None


def scan_live(
    target_sets: list[str], max_per_set: int, observed_date: str
) -> list[dict]:
    all_rows: list[dict] = []
    any_page_used = False
    for set_name in target_sets:
        for sold in (True, False):
            source = "ebay_sold" if sold else "ebay_active"
            url = build_search_url(set_name, sold)
            html = fetch_page(url)
            if html is None:
                continue
            any_page_used = True
            rows, skips = parse_search_page(
                html, source, target_sets, observed_date, max_rows=max_per_set
            )
            all_rows.extend(rows)
            for reason in skips:
                print(f"skip [{set_name}/{source}]: {reason}", file=sys.stderr)
            time.sleep(1)  # be polite between requests
    if not any_page_used:
        print(
            "eBay appears fully blocked from this box for every query attempted; "
            "degrading gracefully with 0 rows (exit code 0).",
            file=sys.stderr,
        )
    return all_rows


# --------------------------------------------------------------------------
# Fixture-dir mode
# --------------------------------------------------------------------------


def source_from_filename(name: str) -> Optional[str]:
    lowered = name.lower()
    if "sold" in lowered:
        return "ebay_sold"
    if "active" in lowered:
        return "ebay_active"
    return None


def scan_fixture_dir(
    fixture_dir: Path, target_sets: list[str], max_per_set: int, observed_date: str
) -> list[dict]:
    all_rows: list[dict] = []
    per_set_count: dict[str, int] = {}
    html_files = sorted(fixture_dir.glob("*.html"))
    if not html_files:
        print(f"no *.html fixtures found in {fixture_dir}", file=sys.stderr)
    for path in html_files:
        source = source_from_filename(path.name)
        if source is None:
            print(
                f"skipping fixture {path.name}: filename must contain "
                "'sold' or 'active' to indicate source",
                file=sys.stderr,
            )
            continue
        html = path.read_text(encoding="utf-8")
        rows, skips = parse_search_page(html, source, target_sets, observed_date)
        for reason in skips:
            print(f"skip [{path.name}]: {reason}", file=sys.stderr)
        for row in rows:
            count = per_set_count.get(row["set_name"], 0)
            if count >= max_per_set:
                continue
            per_set_count[row["set_name"]] = count + 1
            all_rows.append(row)
    return all_rows


# --------------------------------------------------------------------------
# CSV output
# --------------------------------------------------------------------------


def write_csv(rows: list[dict], out_path: Path) -> None:
    rows_sorted = sorted(rows, key=lambda r: r["listing_ref"])
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADER)
        writer.writeheader()
        for row in rows_sorted:
            writer.writerow(row)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="output CSV path")
    parser.add_argument(
        "--fixture-dir", help="parse saved HTML fixtures from this dir instead of fetching"
    )
    parser.add_argument("--live", action="store_true", help="attempt real network fetches")
    parser.add_argument(
        "--max-per-set", type=int, default=10, help="max rows per target set (default 10)"
    )
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="pokemon-ops sqlite db (read-only)")
    parser.add_argument(
        "--observed-date",
        default=None,
        help="override observed_date (default: today, UTC, YYYY-MM-DD)",
    )
    args = parser.parse_args(argv)

    if bool(args.fixture_dir) == bool(args.live):
        parser.error("exactly one of --fixture-dir or --live is required")

    observed_date = args.observed_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    target_sets = get_target_sets(args.db)
    if not target_sets:
        print(f"no active booster products found in {args.db}", file=sys.stderr)

    if args.live:
        rows = scan_live(target_sets, args.max_per_set, observed_date)
    else:
        rows = scan_fixture_dir(
            Path(args.fixture_dir), target_sets, args.max_per_set, observed_date
        )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_csv(rows, out_path)
    print(f"wrote {len(rows)} rows to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
