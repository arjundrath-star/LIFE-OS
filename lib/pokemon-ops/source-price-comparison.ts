import type { PkSourceProductBenchmark } from "./types";

export function sourcePriceComparisonForSet(
  setFilter: string,
  benchmarks: PkSourceProductBenchmark[],
): PkSourceProductBenchmark | null {
  if (setFilter === "all") return null;
  return benchmarks.find((row) => row.set_name === setFilter) ?? {
    set_name: setFilter,
    medium_buy_ppp_cents: null,
    tcgplayer_ppp_cents: null,
    tcgplayer_observed_date: null,
    tcgplayer_observed_at: null,
    carddistro_ppp_cents: null,
    carddistro_observed_date: null,
    carddistro_observed_at: null,
  };
}

/**
 * Freshness is based only on the row's created_at timestamp. observed_date is
 * source metadata and must never be interpreted as an exact scrape timestamp.
 */
export function formatObservationAge(observedAt: string | null, now = new Date()): string {
  if (!observedAt) return "No observation";
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "Observation date unavailable";
  const hours = Math.max(0, Math.floor((now.getTime() - observed) / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"} behind`;
}
