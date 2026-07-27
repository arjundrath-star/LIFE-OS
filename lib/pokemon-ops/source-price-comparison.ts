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

export type BenchmarkSource = "tcgplayer" | "carddistro";

export function latestSourceObservationAt(
  benchmarks: PkSourceProductBenchmark[],
  source: BenchmarkSource,
): string | null {
  const key = `${source}_observed_at` as const;
  return benchmarks.reduce<string | null>((latest, row) => {
    const candidate = row[key];
    if (!candidate || !Number.isFinite(Date.parse(candidate))) return latest;
    if (!latest || Date.parse(candidate) > Date.parse(latest)) return candidate;
    return latest;
  }, null);
}

/**
 * Freshness is based only on the row's created_at timestamp. observed_date is
 * provenance metadata and must not be treated as a midnight timestamp.
 */
export function formatObservationAge(observedAt: string | null, now = new Date()): string {
  if (!observedAt) return "No observation";
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return "No observation";
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - observedMs) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ${elapsedMinutes % 60}m ago`;
  return `${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h ago`;
}
