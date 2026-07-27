import test from "node:test";
import assert from "node:assert/strict";
import { formatObservationAge, latestSourceObservationAt, sourcePriceComparisonForSet } from "../lib/pokemon-ops/source-price-comparison";
import type { PkSourceProductBenchmark } from "../lib/pokemon-ops/types";

const benchmark: PkSourceProductBenchmark = {
  set_name: "Black Bolt",
  medium_buy_ppp_cents: 1380,
  tcgplayer_ppp_cents: 1623,
  tcgplayer_observed_date: "2026-07-22",
  tcgplayer_observed_at: "2026-07-22T08:00:00.000Z",
  carddistro_ppp_cents: 1723,
  carddistro_observed_date: "2026-07-20",
  carddistro_observed_at: "2026-07-20T04:30:00.000Z",
};

test("All sets intentionally has no per-set comparison", () => {
  assert.equal(sourcePriceComparisonForSet("all", [benchmark]), null);
});

test("Black Bolt preserves existing MEDIUM target, current source prices, and observation metadata", () => {
  const selected = sourcePriceComparisonForSet("Black Bolt", [benchmark]);
  assert.deepEqual(selected, benchmark);
  assert.equal(selected?.medium_buy_ppp_cents, 1380, "Medium buy level must be the existing MEDIUM value");
  assert.equal(selected?.tcgplayer_ppp_cents, 1623);
  assert.equal(selected?.carddistro_ppp_cents, 1723);
  assert.equal(selected?.tcgplayer_observed_date, "2026-07-22");
  assert.equal(selected?.tcgplayer_observed_at, "2026-07-22T08:00:00.000Z");
  assert.equal(selected?.carddistro_observed_date, "2026-07-20");
  assert.equal(selected?.carddistro_observed_at, "2026-07-20T04:30:00.000Z");
});

test("selected set with no read-model row reports each missing value honestly", () => {
  assert.deepEqual(sourcePriceComparisonForSet("Missing Set", [benchmark]), {
    set_name: "Missing Set",
    medium_buy_ppp_cents: null,
    tcgplayer_ppp_cents: null,
    tcgplayer_observed_date: null,
    tcgplayer_observed_at: null,
    carddistro_ppp_cents: null,
    carddistro_observed_date: null,
    carddistro_observed_at: null,
  });
});

test("freshness is a minute-granularity elapsed timer from created_at/observed_at", () => {
  const now = new Date("2026-07-22T12:30:00.000Z");
  assert.equal(formatObservationAge("2026-07-22T08:00:00.000Z", now), "4h 30m ago");
  assert.equal(formatObservationAge("2026-07-20T04:30:00.000Z", now), "2d 8h ago");
  assert.equal(formatObservationAge("2026-07-22T12:15:00.000Z", now), "15m ago");
  assert.equal(formatObservationAge("2026-07-22T12:29:45.000Z", now), "just now");
  assert.equal(formatObservationAge("not-a-date", now), "No observation");
  assert.equal(formatObservationAge(null, now), "No observation");
});

test("latest source sync chooses the newest valid recorded timestamp across sets", () => {
  const older = { ...benchmark, set_name: "151", tcgplayer_observed_at: "2026-07-22T07:59:00.000Z" };
  const newer = { ...benchmark, set_name: "White Flare", tcgplayer_observed_at: "2026-07-22T09:15:00.000Z", carddistro_observed_at: null };
  assert.equal(latestSourceObservationAt([older, benchmark, newer], "tcgplayer"), "2026-07-22T09:15:00.000Z");
  assert.equal(latestSourceObservationAt([older, benchmark, newer], "carddistro"), "2026-07-20T04:30:00.000Z");
  assert.equal(latestSourceObservationAt([{ ...benchmark, tcgplayer_observed_at: "invalid" }], "tcgplayer"), null);
});
