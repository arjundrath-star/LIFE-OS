// Client-safe formatting helpers for pokemon-ops money/derived values. Pure
// functions only — no @/db import (this file is imported from "use client"
// components, unlike lib/pokemon-ops/{db,metrics}.ts which are server-only).

/** Integer cents -> "$12.34" (negative -> "-$1.23"). */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

/** Days-of-supply / velocity: raw double -> fixed-1 string, null -> "∞" (never
 *  sells out) is the metrics.ts contract for velocity 0 with stock > 0). */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "∞";
  if (!Number.isFinite(days)) return "∞";
  return days.toFixed(1);
}

export function formatVelocity(unitsPerDay: number | null | undefined): string {
  if (unitsPerDay === null || unitsPerDay === undefined || !Number.isFinite(unitsPerDay)) return "—";
  return unitsPerDay.toFixed(2);
}

export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
