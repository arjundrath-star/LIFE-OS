"""Tests for agents/pokemon-sourcing-scout/scripts/ebay_scraper.py.

Run with the project venv:
    agents/pokemon-sourcing-scout/venv/bin/python -m pytest \
        agents/pokemon-sourcing-scout/tests/test_ebay_scraper.py -v

These are pure parser/heuristic tests plus full fixture-dir integration
tests. No network access, no LLM calls, no DB writes. get_target_sets()
does a single read-only SELECT against the live pokemon-ops sqlite db
(safe: it never writes).
"""
from __future__ import annotations

import csv
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = REPO_ROOT / "agents" / "pokemon-sourcing-scout" / "scripts"
FIXTURE_DIR = REPO_ROOT / "agents" / "pokemon-sourcing-scout" / "fixtures" / "ebay"
SCRIPT_PATH = SCRIPT_DIR / "ebay_scraper.py"

sys.path.insert(0, str(SCRIPT_DIR))
import ebay_scraper as scraper  # noqa: E402

TARGET_SETS = [
    "Phantasmal Flames",
    "Mega Evolution",
    "Destined Rivals",
    "Journey Together",
    "Paldean Fates",
    "151",
    "Pitch Black",
    "Chaos Rising",
    "Perfect Order",
    "Ascended Heroes",
    "White Flare",
    "Black Bolt",
    "Surging Sparks",
    "Prismatic Evolutions",
    "Storm Emerald",
]
OBSERVED_DATE = "2026-07-17"


# --------------------------------------------------------------------------
# Lot-size heuristic unit tests
# --------------------------------------------------------------------------


def test_lot_size_booster_box_default():
    assert scraper.detect_lot_size("pokemon prismatic evolutions booster box sealed") == (
        36,
        "booster_box_default",
    )


def test_lot_size_generic_x_n():
    assert scraper.detect_lot_size("pokemon 151 booster packs x36 sealed lot") == (36, "x_n")


def test_lot_size_n_packs():
    assert scraper.detect_lot_size("pokemon journey together booster 36 packs sealed") == (
        36,
        "n_packs",
    )


def test_lot_size_lot_of_n():
    assert scraper.detect_lot_size("pokemon surging sparks booster pack lot of 10 sealed") == (
        10,
        "lot_of_n",
    )


def test_lot_size_case_of_boxes():
    assert scraper.detect_lot_size(
        "pokemon destined rivals booster box case of 6 boxes sealed"
    ) == (216, "case_of_boxes")


def test_lot_size_n_booster_boxes():
    assert scraper.detect_lot_size("pokemon white flare 3 booster boxes sealed lot") == (
        108,
        "n_booster_boxes",
    )


def test_lot_size_undetermined_returns_none():
    assert scraper.detect_lot_size("pokemon prismatic evolutions single card near mint") is None


# --------------------------------------------------------------------------
# Exclusion unit tests
# --------------------------------------------------------------------------


def test_exclusion_etb():
    assert scraper.find_exclusion("pokemon 151 elite trainer box etb sealed") == "etb_excluded"
    assert scraper.find_exclusion("pokemon surging sparks etb booster box bundle") == "etb_excluded"


def test_exclusion_graded_slab():
    assert (
        scraper.find_exclusion("pokemon destined rivals booster box psa graded case bgs 9.5")
        == "graded_slab_excluded"
    )


def test_exclusion_non_sealed():
    assert (
        scraper.find_exclusion("pokemon storm emerald booster box resealed unsealed repack")
        == "non_sealed_excluded"
    )


def test_exclusion_none_for_clean_listing():
    assert scraper.find_exclusion("pokemon chaos rising booster box sealed") is None


# --------------------------------------------------------------------------
# Set detection
# --------------------------------------------------------------------------


def test_detect_set_matches_target():
    assert scraper.detect_set("pokemon 151 booster packs x36 sealed lot", TARGET_SETS) == "151"


def test_detect_set_unknown_returns_none():
    assert scraper.detect_set("yu-gi-oh booster box case sealed 12 boxes", TARGET_SETS) is None


def test_detect_set_word_boundary_no_false_positive():
    # "151" must not match inside an unrelated numeric token.
    assert scraper.detect_set("some item numbered 1510 for sale", TARGET_SETS) is None


# --------------------------------------------------------------------------
# Price parsing
# --------------------------------------------------------------------------


def test_parse_money_dollar():
    assert scraper.parse_money("$189.99") == 189.99


def test_parse_money_free():
    assert scraper.parse_money("Free shipping") == 0.0


def test_parse_money_none():
    assert scraper.parse_money(None) is None


def test_parse_money_thousands_comma():
    assert scraper.parse_money("$1,200.00") == 1200.00


# --------------------------------------------------------------------------
# USD-only currency guard (eBay geolocates the box; foreign-currency prices
# must be dropped, never read as dollars)
# --------------------------------------------------------------------------


def test_is_usd_price_plain_and_us_dollars():
    assert scraper.is_usd_price("$189.99") is True
    assert scraper.is_usd_price("US $420.00") is True
    assert scraper.is_usd_price("Free shipping") is True
    assert scraper.is_usd_price(None) is True


def test_is_usd_price_rejects_foreign_currencies():
    assert scraper.is_usd_price("R$ 7,493.96") is False
    assert scraper.is_usd_price("£120.00") is False
    assert scraper.is_usd_price("120,00 EUR") is False
    assert scraper.is_usd_price("C $250.00") is False
    assert scraper.is_usd_price("AU $310.00") is False


def test_build_row_drops_non_usd_price():
    card = scraper.ListingCard(
        item_id="444444444443",
        url="https://www.ebay.com/itm/444444444443",
        title="Lot of (72) Pokemon TCG 151 Booster Packs Sealed",
        subtitle="",
        price_text="R$ 7,493.96",
        shipping_text="+R$ 331.59 shipping",
    )
    row, skip = scraper.build_row(card, "ebay_active", TARGET_SETS, OBSERVED_DATE)
    assert row is None
    assert skip.startswith("non_usd_price")


# --------------------------------------------------------------------------
# build_row: price + shipping math, full row shape
# --------------------------------------------------------------------------


def test_build_row_price_plus_shipping_math():
    card = scraper.ListingCard(
        item_id="111111111111",
        url="https://www.ebay.com/itm/111111111111",
        title="Pokemon TCG Prismatic Evolutions Booster Box Sealed New",
        subtitle="",
        price_text="$189.99",
        shipping_text="+$15.00 shipping",
    )
    row, skip = scraper.build_row(card, "ebay_sold", TARGET_SETS, OBSERVED_DATE)
    assert skip is None
    assert row["set_name"] == "Prismatic Evolutions"
    assert row["source"] == "ebay_sold"
    assert row["form"] == "booster"
    assert row["lot_size"] == "36"
    # (189.99 + 15.00) / 36 = 5.6942 (rounded to 4dp as emitted)
    assert row["price_per_pack_usd"] == f"{(189.99 + 15.00) / 36:.4f}"
    assert row["includes_shipping"] == "1"
    assert row["listing_ref"] == "https://www.ebay.com/itm/111111111111"


def test_build_row_etb_is_dropped():
    card = scraper.ListingCard(
        item_id="333333333331",
        url="https://www.ebay.com/itm/333333333331",
        title="Pokemon 151 Elite Trainer Box ETB Sealed New",
        subtitle="",
        price_text="$54.99",
        shipping_text="Free shipping",
    )
    row, skip = scraper.build_row(card, "ebay_active", TARGET_SETS, OBSERVED_DATE)
    assert row is None
    assert skip.startswith("etb_excluded")


def test_build_row_unknown_set_is_dropped():
    card = scraper.ListingCard(
        item_id="999999999999",
        url="https://www.ebay.com/itm/999999999999",
        title="Yu-Gi-Oh Booster Box Case Sealed 12 Boxes",
        subtitle="",
        price_text="$720.00",
        shipping_text="+$30.00 shipping",
    )
    row, skip = scraper.build_row(card, "ebay_sold", TARGET_SETS, OBSERVED_DATE)
    assert row is None
    assert skip.startswith("unknown_set")


# --------------------------------------------------------------------------
# Fixture-file integration tests
# --------------------------------------------------------------------------


def test_sold_fixture_produces_expected_rows():
    html = (FIXTURE_DIR / "ebay_sold_pokemon_booster_lots.html").read_text()
    rows, skips = scraper.parse_search_page(html, "ebay_sold", TARGET_SETS, OBSERVED_DATE)

    by_ref = {r["listing_ref"]: r for r in rows}
    assert set(by_ref) == {
        "https://www.ebay.com/itm/111111111111",
        "https://www.ebay.com/itm/111111111112",
        "https://www.ebay.com/itm/111111111113",
        "https://www.ebay.com/itm/111111111114",
        "https://www.ebay.com/itm/111111111117",
    }
    assert by_ref["https://www.ebay.com/itm/111111111111"]["lot_size"] == "36"
    assert by_ref["https://www.ebay.com/itm/111111111111"]["set_name"] == "Prismatic Evolutions"
    assert by_ref["https://www.ebay.com/itm/111111111112"]["lot_size"] == "36"
    assert by_ref["https://www.ebay.com/itm/111111111112"]["set_name"] == "151"
    assert by_ref["https://www.ebay.com/itm/111111111113"]["lot_size"] == "216"
    assert by_ref["https://www.ebay.com/itm/111111111113"]["set_name"] == "Destined Rivals"
    assert by_ref["https://www.ebay.com/itm/111111111114"]["lot_size"] == "10"
    assert by_ref["https://www.ebay.com/itm/111111111114"]["set_name"] == "Surging Sparks"
    assert by_ref["https://www.ebay.com/itm/111111111117"]["lot_size"] == "36"
    assert by_ref["https://www.ebay.com/itm/111111111117"]["set_name"] == "Journey Together"
    assert all(r["source"] == "ebay_sold" for r in rows)

    # PSA slab (111115) and Yu-Gi-Oh (111116) must be excluded/skipped, not emitted.
    assert "https://www.ebay.com/itm/111111111115" not in by_ref
    assert "https://www.ebay.com/itm/111111111116" not in by_ref
    reasons = " ".join(skips)
    assert "graded_slab_excluded" in reasons
    assert "unknown_set" in reasons


def test_active_fixture_produces_expected_rows():
    html = (FIXTURE_DIR / "ebay_active_pokemon_booster_lots.html").read_text()
    rows, skips = scraper.parse_search_page(html, "ebay_active", TARGET_SETS, OBSERVED_DATE)

    by_ref = {r["listing_ref"]: r for r in rows}
    assert set(by_ref) == {
        "https://www.ebay.com/itm/222222222221",
        "https://www.ebay.com/itm/222222222222",
        "https://www.ebay.com/itm/222222222223",
    }
    assert by_ref["https://www.ebay.com/itm/222222222221"]["lot_size"] == "36"
    assert by_ref["https://www.ebay.com/itm/222222222222"]["lot_size"] == "108"
    assert by_ref["https://www.ebay.com/itm/222222222223"]["lot_size"] == "24"
    assert all(r["source"] == "ebay_active" for r in rows)

    # ETB (222224) and opened/display-only (222225) must be excluded.
    assert "https://www.ebay.com/itm/222222222224" not in by_ref
    assert "https://www.ebay.com/itm/222222222225" not in by_ref
    reasons = " ".join(skips)
    assert "etb_excluded" in reasons
    assert "non_sealed_excluded" in reasons


def test_etb_exclusion_case_fixture():
    html = (FIXTURE_DIR / "ebay_active_etb_exclusion_case.html").read_text()
    rows, skips = scraper.parse_search_page(html, "ebay_active", TARGET_SETS, OBSERVED_DATE)

    by_ref = {r["listing_ref"]: r for r in rows}
    # Only the clean "Chaos Rising Booster Box Sealed" row should survive.
    assert set(by_ref) == {"https://www.ebay.com/itm/333333333335"}
    assert by_ref["https://www.ebay.com/itm/333333333335"]["set_name"] == "Chaos Rising"
    assert by_ref["https://www.ebay.com/itm/333333333335"]["lot_size"] == "36"

    reasons = " ".join(skips)
    assert reasons.count("etb_excluded") == 2
    assert "graded_slab_excluded" in reasons
    assert "non_sealed_excluded" in reasons


# --------------------------------------------------------------------------
# Current-DOM (li.s-card) fixture: the shape a live fetch returns
# --------------------------------------------------------------------------


def test_scard_dom_fixture_parses_current_ebay_markup():
    html = (FIXTURE_DIR / "ebay_active_scard_dom.html").read_text()
    rows, skips = scraper.parse_search_page(html, "ebay_active", TARGET_SETS, OBSERVED_DATE)

    by_ref = {r["listing_ref"]: r for r in rows}
    # Two USD-priced cards survive; the "Opens in a new window or tab" title
    # suffix is stripped so set/lot detection still works.
    assert set(by_ref) == {
        "https://www.ebay.com/itm/444444444441",
        "https://www.ebay.com/itm/444444444442",
    }
    r1 = by_ref["https://www.ebay.com/itm/444444444441"]
    assert r1["set_name"] == "Prismatic Evolutions"
    assert r1["lot_size"] == "36"  # bare booster box
    assert r1["source"] == "ebay_active"
    # (189.99 + 12.50) / 36
    assert r1["price_per_pack_usd"] == f"{(189.99 + 12.50) / 36:.4f}"

    r2 = by_ref["https://www.ebay.com/itm/444444444442"]
    assert r2["set_name"] == "White Flare"
    assert r2["lot_size"] == "108"  # 3 booster boxes
    # $420.00 + free shipping -> shipping folds to 0
    assert r2["price_per_pack_usd"] == f"{420.00 / 108:.4f}"

    reasons = " ".join(skips)
    # BRL card dropped on currency, ETB card dropped on doctrine.
    assert "non_usd_price" in reasons
    assert "444444444443" in reasons
    assert "etb_excluded" in reasons
    assert "https://www.ebay.com/itm/444444444443" not in by_ref
    assert "https://www.ebay.com/itm/444444444444" not in by_ref


# --------------------------------------------------------------------------
# Full CLI determinism: same fixture in -> identical CSV out, twice
# --------------------------------------------------------------------------


def _run_cli(out_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--fixture-dir",
            str(FIXTURE_DIR),
            "--out",
            str(out_path),
            "--observed-date",
            OBSERVED_DATE,
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_cli_deterministic_across_two_runs(tmp_path: Path):
    out1 = tmp_path / "run1.csv"
    out2 = tmp_path / "run2.csv"
    _run_cli(out1)
    _run_cli(out2)
    assert out1.read_text() == out2.read_text()


def test_cli_output_header_and_sort_order(tmp_path: Path):
    out = tmp_path / "run.csv"
    _run_cli(out)
    with out.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        assert header == scraper.CSV_HEADER
        refs = [row[8] for row in reader]
    assert refs == sorted(refs)
    assert len(refs) == len(set(refs))  # no duplicate listing_ref (dedupe key)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
