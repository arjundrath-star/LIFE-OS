// Phase 5 alerts CLI: all SQL/business logic for scripts/pokemon-ops-alerts.sh
// lives here — the bash wrapper only sends/logs/marks via this CLI's JSON
// output on stdout, it never hand-rolls SQL.
//
// Usage: tsx scripts/pokemon-ops-alerts-data.ts <subcommand> [flags]
//   pending --as-of <iso>                    -> { alerts: [{ kind, id, message }, ...] }
//   digest  --as-of <iso>                    -> { message: string }
//   mark    --kind rec|obs --id <n> --at <iso> -> { ok: true }
//
// Determinism: every subcommand takes an explicit timestamp (--as-of / --at)
// from its caller; this file never calls Date.now() / new Date() for logic.
import { all, getDb } from "@/db";
import {
  getConfigInt,
  getMachine,
  listBestFreshOffers,
  listPendingActionRecommendations,
  listPendingSourcingAlerts,
  markObservationAlerted,
  markRecommendationAlerted,
} from "@/lib/pokemon-ops/db";
import { pokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { PkRecommendation } from "@/lib/pokemon-ops/types";

/** Digest's "fresh" window for best-offer-per-product (PLAN sourcing feed
 *  convention: same 30d used by the refill_order rule). */
const DIGEST_FRESH_OFFER_MAX_AGE_DAYS = 30;

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function parseIsoOrThrow(label: string, value: string | undefined): string {
  if (!value) throw new Error(`missing required flag: --${label}`);
  if (Number.isNaN(Date.parse(value))) throw new Error(`bad ${label}: ${value}`);
  return value;
}

/**
 * Every subcommand here writes exactly one JSON line to stdout, which the
 * bash wrapper feeds straight into jq. db/index.ts's migrate() step
 * console.logs "[db] applied migration ..." lines on a DB's first-ever open
 * (documented in tests/pokemon-ops/run-fixture.ts as the reason that runner
 * writes to a file instead of stdout) — on a brand-new DB that noise would
 * land on stdout ahead of our JSON and break jq downstream. getDb() caches
 * its connection at module scope, so triggering (and swallowing) that one-time
 * migration log up front, before any subcommand prints anything, is enough.
 */
function ensureDbQuietly(): void {
  const originalLog = console.log;
  console.log = () => {};
  try {
    getDb();
  } finally {
    console.log = originalLog;
  }
}

function renderRecommendationMessage(rec: PkRecommendation): string {
  const machine = rec.machine_id != null ? getMachine(rec.machine_id) : undefined;
  const machineLabel = machine ? machine.name : rec.machine_id != null ? `machine ${rec.machine_id}` : "machine";
  const slotLabel = rec.slot_number != null ? ` slot ${rec.slot_number}` : "";
  const payload = JSON.parse(rec.payload_json) as Record<string, any>;

  let detail: string;
  switch (rec.rule) {
    case "refill_sync":
      detail =
        `days-of-supply spread ${payload.spread_days}d exceeds ${payload.threshold_days}d: ` +
        `raise price on slot ${payload.suggestion.raise_price_slot}, ` +
        `rotate/lower slot ${payload.suggestion.lower_price_or_rotate_slot}`;
      break;
    case "price_raise":
      detail =
        `${payload.set_name} days-of-supply ${payload.days_of_supply}d is below ${payload.threshold_days}d: ` +
        `raise price from ${usd(payload.current_price_cents)} to ` +
        `${usd(payload.suggested_price_min_cents)}-${usd(payload.suggested_price_max_cents)}`;
      break;
    case "add_slot":
      detail =
        `${payload.set_name} in slot ${payload.fast_slot} is selling fast ` +
        `(days-of-supply ${payload.fast_days_of_supply}d): add ${payload.candidate_kind} slot ${payload.candidate_slot}`;
      break;
    case "dead_stock":
      detail =
        `${payload.set_name} has had no sales in ${payload.window_days}d (stock ${payload.current_stock}): ` +
        `rotate to mystery slot`;
      break;
    case "refill_order":
      detail =
        `spend ${usd(payload.spent_cents)} of ${usd(payload.budget_cents)} budget across ` +
        `${(payload.items ?? []).length} item(s)`;
      break;
    default:
      detail = `${rec.rule} recommendation open, see dashboard for details`;
  }
  return `[${rec.rule.toUpperCase()}] ${machineLabel}${slotLabel}: ${detail}`;
}

function renderSourcingMessage(row: {
  set_name: string;
  price_per_pack_cents: number;
  source: string;
  benchmark_price_cents: number;
  beats_pct: number;
}): string {
  return (
    `SOURCING: ${row.set_name} at ${usd(row.price_per_pack_cents)} from ${row.source} ` +
    `beats benchmark ${usd(row.benchmark_price_cents)} by ${row.beats_pct.toFixed(1)}%`
  );
}

interface Alert {
  kind: "rec" | "obs";
  id: number;
  message: string;
}

function cmdPending(asOf: string): void {
  getDb();
  const thresholdPct = getConfigInt("alert_threshold_pct");
  const recs = listPendingActionRecommendations();
  const obs = listPendingSourcingAlerts(thresholdPct);
  const alerts: Alert[] = [
    ...recs.map((r) => ({ kind: "rec" as const, id: r.id, message: renderRecommendationMessage(r) })),
    ...obs.map((o) => ({ kind: "obs" as const, id: o.id, message: renderSourcingMessage(o) })),
  ];
  process.stdout.write(JSON.stringify({ alerts }));
}

function cmdDigest(asOf: string): void {
  getDb();
  const snap = pokemonOpsSnapshot(asOf);
  const severityCounts = all<{ severity: string; c: number }>(
    `SELECT severity, COUNT(*) AS c FROM pk_recommendations WHERE status = 'open' GROUP BY severity`
  );
  const bySeverity: Record<string, number> = { info: 0, action: 0, urgent: 0 };
  for (const row of severityCounts) bySeverity[row.severity] = row.c;
  const openTotal = bySeverity.info + bySeverity.action + bySeverity.urgent;
  const offers = listBestFreshOffers(asOf, DIGEST_FRESH_OFFER_MAX_AGE_DAYS);

  const lines: string[] = [];
  lines.push(`Pokemon Ops Morning Digest (${asOf.slice(0, 10)})`);
  lines.push("");
  lines.push(
    `Margin: ${
      snap.kpis.margin_per_slot_day_cents !== null ? `${usd(snap.kpis.margin_per_slot_day_cents)}/slot/day` : "n/a"
    }`
  );
  lines.push(`Total invested: ${usd(snap.kpis.total_invested_cents)}`);
  lines.push(
    `Sell-through (30d): ${
      snap.kpis.sell_through_pct !== null ? `${snap.kpis.sell_through_pct.toFixed(1)}%` : "n/a"
    }`
  );
  lines.push(
    `Days-of-supply spread: ${
      snap.kpis.days_of_supply_spread !== null ? `${snap.kpis.days_of_supply_spread.toFixed(1)}d` : "n/a"
    }`
  );
  lines.push("");
  lines.push(
    `Open recommendations: ${openTotal} total (urgent ${bySeverity.urgent}, action ${bySeverity.action}, info ${bySeverity.info})`
  );
  lines.push("");
  if (offers.length > 0) {
    lines.push("Best fresh sourcing offers:");
    for (const o of offers) {
      let deltaStr = "";
      if (o.benchmark_price_cents !== null) {
        const pct = ((o.benchmark_price_cents - o.price_per_pack_cents) / o.benchmark_price_cents) * 100;
        const dir = o.price_per_pack_cents <= o.benchmark_price_cents ? "below" : "above";
        deltaStr = ` (benchmark ${usd(o.benchmark_price_cents)}, ${Math.abs(pct).toFixed(1)}% ${dir})`;
      }
      lines.push(`  ${o.set_name}: ${usd(o.price_per_pack_cents)} from ${o.source}${deltaStr}`);
    }
  } else {
    lines.push("No fresh sourcing offers.");
  }

  process.stdout.write(JSON.stringify({ message: lines.join("\n") }));
}

function cmdMark(kind: string, id: number, at: string): void {
  getDb();
  if (kind === "rec") markRecommendationAlerted(id, at);
  else if (kind === "obs") markObservationAlerted(id, at);
  else throw new Error(`bad --kind: ${kind} (expected rec|obs)`);
  process.stdout.write(JSON.stringify({ ok: true }));
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function main(): void {
  ensureDbQuietly();
  const [subcommand, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "pending": {
      const asOf = parseIsoOrThrow("as-of", flags["as-of"]);
      cmdPending(asOf);
      return;
    }
    case "digest": {
      const asOf = parseIsoOrThrow("as-of", flags["as-of"]);
      cmdDigest(asOf);
      return;
    }
    case "mark": {
      const kind = flags["kind"];
      const id = Number(flags["id"]);
      const at = parseIsoOrThrow("at", flags["at"]);
      if (!kind) throw new Error("missing required flag: --kind");
      if (!Number.isInteger(id)) throw new Error(`bad --id: ${flags["id"]}`);
      cmdMark(kind, id, at);
      return;
    }
    default:
      throw new Error(`usage: tsx scripts/pokemon-ops-alerts-data.ts <pending|digest|mark> [flags]`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
