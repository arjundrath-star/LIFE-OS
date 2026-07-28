#!/usr/bin/env python3
"""Tests for tcgplayer_scraper.py.

Run: python3 -m pytest \
       agents/pokemon-sourcing-scout/tests/test_tcgplayer_scraper.py -v
(or plain `python -m unittest`, since no pytest-only features are used;
see the __main__ block.)
"""
from __future__ import annotations

import csv
import io
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "tcgplayer"

sys.path.insert(0, str(SCRIPT_DIR))
import tcgplayer_scraper as scraper  # noqa: E402


class TestMappingTable(unittest.TestCase):
    def test_all_15_db_set_names_present(self):
        # These are the 15 canonical `active=1 AND form='booster'` set_names
        # from pk_products (agents/pokemon-sourcing-scout builds against a
        # read-only copy captured 2026-07-17; the scraper's mapping table
        # must not silently drop or add a set relative to this list).
        expected = {
            "Phantasmal Flames", "Mega Evolution", "Destined Rivals",
            "Journey Together", "Paldean Fates", "151", "Pitch Black",
            "Chaos Rising", "Perfect Order", "Ascended Heroes",
            "White Flare", "Black Bolt", "Surging Sparks",
            "Prismatic Evolutions", "Storm Emerald",
        }
        self.assertEqual(set(scraper.SET_NAME_TO_GROUP.keys()), expected)

    def test_unmapped_set_is_storm_emerald_only(self):
        unmapped = [k for k, v in scraper.SET_NAME_TO_GROUP.items() if v is None]
        self.assertEqual(unmapped, ["Storm Emerald"])

    def test_mega_evolution_maps_to_base_set_not_promo_or_energy(self):
        # Regression guard for the fuzzy-mapping case: "Mega Evolution" as a
        # substring also matches "ME: Mega Evolution Promo" (24451) and
        # "MEE: Mega Evolution Energies" (24461) in the live group list. The
        # hard-coded mapping must point at the base set group (24380).
        self.assertEqual(scraper.SET_NAME_TO_GROUP["Mega Evolution"], 24380)
        self.assertNotIn(
            scraper.SET_NAME_TO_GROUP["Mega Evolution"], (24451, 24461)
        )


class TestFindBoosterPackProduct(unittest.TestCase):
    def test_exact_match_excludes_sleeved_and_code_card_and_bundle(self):
        products_json = {
            "results": [
                {"productId": 1, "name": "Destined Rivals Sleeved Booster Pack"},
                {"productId": 2, "name": "Destined Rivals Booster Pack"},
                {"productId": 3, "name": "Code Card - Destined Rivals Booster Pack"},
                {"productId": 4, "name": "Destined Rivals Booster Pack Art Bundle [Set of 4]"},
            ]
        }
        product = scraper.find_booster_pack_product(products_json, "Destined Rivals")
        self.assertIsNotNone(product)
        self.assertEqual(product["productId"], 2)

    def test_no_match_returns_none(self):
        products_json = {"results": [{"productId": 1, "name": "Something Else"}]}
        self.assertIsNone(scraper.find_booster_pack_product(products_json, "Destined Rivals"))


class TestPriceFallback(unittest.TestCase):
    def test_uses_market_price_when_present(self):
        prices_json = {"results": [{"productId": 42, "marketPrice": 9.51, "midPrice": 10.44}]}
        result = scraper.find_price_for_product(prices_json, 42)
        self.assertEqual(result, (9.51, "price=marketPrice"))

    def test_falls_back_to_mid_price_when_market_price_is_null(self):
        prices_json = {"results": [{"productId": 42, "marketPrice": None, "midPrice": 10.44}]}
        result = scraper.find_price_for_product(prices_json, 42)
        self.assertEqual(result, (10.44, "price=midPrice_fallback"))

    def test_none_when_both_missing(self):
        prices_json = {"results": [{"productId": 42, "marketPrice": None, "midPrice": None}]}
        self.assertIsNone(scraper.find_price_for_product(prices_json, 42))

    def test_none_when_product_id_not_present(self):
        prices_json = {"results": [{"productId": 999, "marketPrice": 1.0, "midPrice": 1.0}]}
        self.assertIsNone(scraper.find_price_for_product(prices_json, 42))


class TestBuildRowsAgainstRecordedFixtures(unittest.TestCase):
    """Exact expected CSV rows for 3+ sets, sourced from the real fixtures
    captured 2026-07-17 in fixtures/tcgplayer/. Includes Mega Evolution
    (the fuzzy-mapping case)."""

    EXPECTED = {
        "Destined Rivals": (
            "9.51",
            "https://www.tcgplayer.com/product/624683/pokemon-sv10-destined-rivals-destined-rivals-booster-pack",
        ),
        "Mega Evolution": (
            "8.27",
            "https://www.tcgplayer.com/product/644352/pokemon-me01-mega-evolution-mega-evolution-booster-pack",
        ),
        "151": (
            "29.41",
            "https://www.tcgplayer.com/product/504467/pokemon-sv-scarlet-and-violet-151-151-booster-pack",
        ),
    }

    @classmethod
    def setUpClass(cls):
        if not FIXTURE_DIR.exists():
            raise unittest.SkipTest(f"fixture dir not found: {FIXTURE_DIR}")
        cls.rows = scraper.build_rows(
            "2026-07-17", live=False, fixture_dir=FIXTURE_DIR
        )
        cls.by_set = {r.set_name: r for r in cls.rows}

    def test_row_count_is_14_mapped_sets(self):
        # 15 in the table, minus Storm Emerald (no group) = 14 rows.
        self.assertEqual(len(self.rows), 14)

    def test_storm_emerald_not_in_output(self):
        self.assertNotIn("Storm Emerald", self.by_set)

    def test_expected_rows_exact(self):
        for set_name, (price, listing_ref) in self.EXPECTED.items():
            with self.subTest(set_name=set_name):
                row = self.by_set[set_name]
                self.assertEqual(row.observed_date, "2026-07-17")
                self.assertEqual(row.price_per_pack_usd, price)
                self.assertEqual(row.listing_ref, listing_ref)
                self.assertEqual(row.notes, "price=marketPrice")

    def test_output_sorted_by_set_name(self):
        names = [r.set_name for r in self.rows]
        self.assertEqual(names, sorted(names))

    def test_csv_header_and_row_shape(self):
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(scraper.CSV_HEADER)
        for row in self.rows:
            writer.writerow(row.as_csv_row())
        buf.seek(0)
        reader = csv.reader(buf)
        header = next(reader)
        self.assertEqual(header, scraper.CSV_HEADER)
        first_data_row = next(reader)
        self.assertEqual(first_data_row[1], "tcgplayer")  # source
        self.assertEqual(first_data_row[3], "booster")  # form
        self.assertEqual(first_data_row[5], "1")  # lot_size
        self.assertEqual(first_data_row[6], "0")  # includes_shipping
        self.assertEqual(first_data_row[7], "0")  # includes_tax


class TestDeterminism(unittest.TestCase):
    def test_running_twice_produces_identical_rows(self):
        if not FIXTURE_DIR.exists():
            raise unittest.SkipTest(f"fixture dir not found: {FIXTURE_DIR}")
        rows_a = scraper.build_rows("2026-07-17", live=False, fixture_dir=FIXTURE_DIR)
        rows_b = scraper.build_rows("2026-07-17", live=False, fixture_dir=FIXTURE_DIR)
        self.assertEqual(
            [r.as_csv_row() for r in rows_a],
            [r.as_csv_row() for r in rows_b],
        )

    def test_full_cli_run_twice_produces_byte_identical_csv(self):
        if not FIXTURE_DIR.exists():
            raise unittest.SkipTest(f"fixture dir not found: {FIXTURE_DIR}")
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out_a = Path(tmp) / "a.csv"
            out_b = Path(tmp) / "b.csv"
            rc_a = scraper.main(
                ["--fixture-dir", str(FIXTURE_DIR), "--observed-date", "2026-07-17", "--out", str(out_a)]
            )
            rc_b = scraper.main(
                ["--fixture-dir", str(FIXTURE_DIR), "--observed-date", "2026-07-17", "--out", str(out_b)]
            )
            self.assertEqual(rc_a, 0)
            self.assertEqual(rc_b, 0)
            self.assertEqual(out_a.read_text(), out_b.read_text())


class TestCompleteCoverageMode(unittest.TestCase):
    def test_full_fixture_has_no_missing_mapped_sets(self):
        rows = scraper.build_rows("2026-07-17", live=False, fixture_dir=FIXTURE_DIR)
        self.assertEqual(scraper.missing_mapped_sets(rows), [])

    def test_require_complete_exits_nonzero_for_partial_fetch(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "partial.csv"
            rc = scraper.main([
                "--fixture-dir", tmp,
                "--observed-date", "2026-07-17",
                "--require-complete",
                "--out", str(out),
            ])
            self.assertEqual(rc, 2)
            self.assertTrue(out.exists(), "partial evidence should remain archived for diagnosis")


class TestMissingFixtureIsSkippedNotFatal(unittest.TestCase):
    def test_missing_fixture_file_for_a_group_is_skipped_with_stderr_note(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            empty_dir = Path(tmp)
            rows = scraper.build_rows("2026-07-17", live=False, fixture_dir=empty_dir)
            self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
