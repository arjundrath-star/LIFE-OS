// Pokemon ops dashboard snapshot builder. The single server-side aggregation
// point for everything the /pokemon-ops tab needs — panels never compute
// business math client-side, they render this shape. Built entirely on
// lib/pokemon-ops/{db,metrics}.ts (the derived-only layer). Deterministic given
// (DB contents, asOf) like the rest of the ops layer: asOf is passed in by the
// caller (scheduler tick / API route), never computed here.
import { all } from "@/db";
import {
  currentStockForSlot,
  latestBenchmarkForProduct,
  listActiveAssignments,
  listOpenRecommendations,
  listPurchaseLotsFiltered,
  listRecentSales,
} from "./db";
import {
  DAY_MS,
  VELOCITY_WINDOW_DAYS,
  daysOfSupply,
  marginPerSlotDay,
  projectedSelloutDate,
  refillSyncSpread,
  totalInvested,
  velocity,
} from "./metrics";
import type { Machine, PkPriceObservation, PkPurchaseLot, PkRecommendation, PkSale } from "./types";

/** Trailing window for the sell-through KPI. Independent of VELOCITY_WINDOW_DAYS
 *  (14d) — sell-through is a slower-moving capital-efficiency number, 30d is the
 *  PLAN-specified window. */
const SELL_THROUGH_WINDOW_DAYS = 30;

/** How many sourcing-feed / recent-sales / recent-lots rows the snapshot carries. */
const FEED_LIMIT = 20;

export interface PokemonOpsSlotRow {
  slot_number: number;
  product_id: number;
  set_name: string;
  price_cents: number;
  capacity: number;
  /** Units sold per day, trailing VELOCITY_WINDOW_DAYS. */
  velocity_units_per_day: number;
  current_stock: number;
  /** Infinity (never sells out) serializes to null. */
  days_of_supply: number | null;
  /** Sum of FIFO-allocated sale margin for this slot / VELOCITY_WINDOW_DAYS. */
  margin_per_slot_day_cents: number;
  projected_sellout_date: string | null;
}

export interface PokemonOpsRecommendation extends Omit<PkRecommendation, "payload_json"> {
  payload: unknown;
}

export interface PokemonOpsSourcingRow {
  observation_id: number;
  product_id: number;
  set_name: string;
  source: string;
  observed_date: string;
  price_per_pack_cents: number;
  listing_ref: string;
  /** price − current external market benchmark; null if no benchmark yet. */
  benchmark_delta_cents: number | null;
}

export interface PokemonOpsSnapshot {
  asOf: string;
  /** The one machine with active SKU assignments, else machines[0], else null
   *  (genuinely empty DB — honest empty state, not a fake row). */
  machine: { id: number; name: string; location: string | null } | null;
  kpis: {
    /**
     * PRIMARY KPI. Sum (NOT average) of marginPerSlotDay across every slot with
     * an active assignment on `machine` — the whole machine's daily margin
     * contribution, trailing VELOCITY_WINDOW_DAYS (14d). null when there is no
     * machine or it has no active slots (nothing to sum).
     */
    margin_per_slot_day_cents: number | null;
    /** Σ pk_purchase_lots.total_cost_cents, all-time, all statuses (metrics.totalInvested).
     *  A real 0 when there are no lots yet — not a fake placeholder. */
    total_invested_cents: number;
    /**
     * 100 * (units sold) / (units stocked via 'refill' stock events), both
     * trailing SELL_THROUGH_WINDOW_DAYS (30d), machine-wide across every slot
     * (not just actively-assigned ones — a slot can be refilled/sold against
     * before/after a reassignment). null when there is no machine or zero
     * units were refilled in the window (undefined ratio, not a fake 0/100).
     */
    sell_through_pct: number | null;
    /** metrics.refillSyncSpread(machine, asOf) — max−min days-of-supply across
     *  active slots; null with <2 finite values (metrics' own contract). */
    days_of_supply_spread: number | null;
  };
  slots: PokemonOpsSlotRow[];
  open_recommendations: PokemonOpsRecommendation[];
  recent_sales: Array<PkSale & { set_name: string }>;
  /** Latest observation per (product, source) pair, newest FEED_LIMIT by
   *  observed_date, with delta vs the product's current external market benchmark. */
  sourcing_feed: PokemonOpsSourcingRow[];
  /** Newest purchase lots (for UI display + the lot-form E2E assertion — a
   *  freshly-created lot must be visible somewhere on the page). */
  recent_lots: Array<PkPurchaseLot & { set_name: string }>;
}

function parseIso(label: string, iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad ${label}: ${iso}`);
  return ms;
}

/** machine = the one machine with active assignments (lowest machine_id wins on
 *  a tie — deterministic), else machines[0] by id, else null on a genuinely
 *  empty machines table. */
function pickMachine(): Machine | null {
  const machines = all<Machine>(`SELECT * FROM machines ORDER BY id`);
  if (machines.length === 0) return null;
  const withAssignment = all<{ machine_id: number }>(
    `SELECT DISTINCT machine_id FROM pk_sku_assignments WHERE ended_at IS NULL ORDER BY machine_id LIMIT 1`
  );
  if (withAssignment.length > 0) {
    const found = machines.find((m) => m.id === withAssignment[0].machine_id);
    if (found) return found;
  }
  return machines[0];
}

/** Σ qty sold − Σ qty refilled over the trailing window, machine-wide. null when
 *  nothing was refilled in the window (division by zero would lie: it is not a
 *  0% or 100% sell-through, it is "no refill data to compare against"). */
function sellThroughPct(machineId: number, asOf: string): number | null {
  const asOfMs = parseIso("asOf", asOf);
  const startIso = new Date(asOfMs - SELL_THROUGH_WINDOW_DAYS * DAY_MS).toISOString();
  const sold = all<{ s: number }>(
    `SELECT COALESCE(SUM(qty), 0) AS s FROM pk_sales
     WHERE machine_id = ? AND sold_at > ? AND sold_at <= ?`,
    machineId,
    startIso,
    asOf
  )[0].s;
  const stocked = all<{ s: number }>(
    `SELECT COALESCE(SUM(qty_delta), 0) AS s FROM pk_stock_events
     WHERE machine_id = ? AND event = 'refill' AND at > ? AND at <= ?`,
    machineId,
    startIso,
    asOf
  )[0].s;
  if (stocked <= 0) return null;
  return (sold / stocked) * 100;
}

/** Latest observation per (product_id, source), newest FEED_LIMIT overall,
 *  each annotated with the benchmark delta current at read time. */
function sourcingFeed(): PokemonOpsSourcingRow[] {
  const rows = all<PkPriceObservation & { set_name: string }>(
    `SELECT o.*, p.set_name
     FROM pk_price_observations o
     JOIN pk_products p ON p.id = o.product_id
     WHERE o.id = (
       SELECT o2.id FROM pk_price_observations o2
       WHERE o2.product_id = o.product_id AND o2.source = o.source
       ORDER BY o2.observed_date DESC, o2.id DESC LIMIT 1
     )
     ORDER BY o.observed_date DESC, o.id DESC
     LIMIT ?`,
    FEED_LIMIT
  );
  return rows.map((r) => {
    const benchmark = latestBenchmarkForProduct(r.product_id);
    return {
      observation_id: r.id,
      product_id: r.product_id,
      set_name: r.set_name,
      source: r.source,
      observed_date: r.observed_date,
      price_per_pack_cents: r.price_per_pack_cents,
      listing_ref: r.listing_ref,
      benchmark_delta_cents: benchmark ? r.price_per_pack_cents - benchmark.price_per_pack_cents : null,
    };
  });
}

function recentLots(): Array<PkPurchaseLot & { set_name: string }> {
  return listPurchaseLotsFiltered().slice(0, FEED_LIMIT);
}

export function pokemonOpsSnapshot(asOf: string): PokemonOpsSnapshot {
  parseIso("asOf", asOf); // validate early, same contract as metrics/rules

  const machine = pickMachine();
  const machineOut = machine ? { id: machine.id, name: machine.name, location: machine.location } : null;

  let slots: PokemonOpsSlotRow[] = [];
  let marginPerSlotDayTotal: number | null = null;
  let sellThrough: number | null = null;
  let spread: number | null = null;

  if (machine) {
    const assignments = listActiveAssignments(machine.id); // slot_number ASC
    slots = assignments.map((a) => {
      const stock = currentStockForSlot(machine.id, a.slot_number);
      const dos = daysOfSupply(machine.id, a.slot_number, asOf);
      return {
        slot_number: a.slot_number,
        product_id: a.product_id,
        set_name: a.set_name,
        price_cents: a.price_cents,
        capacity: a.capacity,
        velocity_units_per_day: velocity(machine.id, a.slot_number, asOf),
        current_stock: stock,
        days_of_supply: Number.isFinite(dos) ? dos : null,
        margin_per_slot_day_cents: marginPerSlotDay(machine.id, a.slot_number, VELOCITY_WINDOW_DAYS, asOf),
        projected_sellout_date: projectedSelloutDate(machine.id, a.slot_number, asOf),
      };
    });
    marginPerSlotDayTotal = slots.length > 0
      ? slots.reduce((sum, s) => sum + s.margin_per_slot_day_cents, 0)
      : null;
    sellThrough = sellThroughPct(machine.id, asOf);
    spread = refillSyncSpread(machine.id, asOf);
  }

  const openRecs: PokemonOpsRecommendation[] = listOpenRecommendations().map((r) => {
    const { payload_json, ...rest } = r;
    return { ...rest, payload: JSON.parse(payload_json) };
  });

  return {
    asOf,
    machine: machineOut,
    kpis: {
      margin_per_slot_day_cents: marginPerSlotDayTotal,
      total_invested_cents: totalInvested(),
      sell_through_pct: sellThrough,
      days_of_supply_spread: spread,
    },
    slots,
    open_recommendations: openRecs,
    recent_sales: listRecentSales(FEED_LIMIT),
    sourcing_feed: sourcingFeed(),
    recent_lots: recentLots(),
  };
}
