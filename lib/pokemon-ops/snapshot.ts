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
  margin_per_slot_day_cents: number | null;
  projected_sellout_date: string | null;
  /** Proven only when the latest stock event for this slot references a lot. */
  source_lot_id: number | null;
  landed_cost_per_pack_cents: number | null;
  source_lot_name: string | null;
  in_transit_units: number;
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

/** Physical stock that has arrived but has not been moved into a machine. */
export interface PokemonOpsGeneralInventoryRow {
  product_id: number;
  set_name: string;
  on_hand_units: number;
  /** Landed-cost value of on_hand_units. */
  cost_value_cents: number | null;
  /** Current TCGplayer/eBay-sold estimate, or null when no benchmark exists. */
  estimated_market_value_cents: number | null;
  market_price_per_pack_cents: number | null;
  market_source: string | null;
  market_observed_date: string | null;
  in_transit_units: number;
  in_transit_cost_cents: number | null;
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
    /** Arrived purchase-lot units not yet moved into a machine. */
    general_inventory_units: number;
    general_inventory_cost_cents: number | null;
    /** null when any on-hand product lacks a current market benchmark. */
    general_inventory_market_cents: number | null;
    in_transit_units: number;
    in_transit_cost_cents: number | null;
  };
  slots: PokemonOpsSlotRow[];
  general_inventory: PokemonOpsGeneralInventoryRow[];
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

interface InventoryLotBalance {
  product_id: number;
  set_name: string;
  pack_count: number;
  landed_cost_per_pack_cents: number;
  cost_confirmed: 0 | 1;
  status: string;
  refilled_units: number;
}

/**
 * Unassigned inventory is derived from purchase lots, not machine slot counts:
 * arrived units minus positive refill movements tied to each lot. In-transit
 * lots are reported separately and depleted lots never inflate on-hand stock.
 */
function generalInventory(): PokemonOpsGeneralInventoryRow[] {
  const lots = all<InventoryLotBalance>(
    `SELECT l.product_id, p.set_name, l.pack_count,
            l.landed_cost_per_pack_cents, l.cost_confirmed, l.status,
            COALESCE(SUM(CASE
              WHEN e.event = 'refill' AND e.qty_delta > 0 THEN e.qty_delta
              ELSE 0
            END), 0) AS refilled_units
     FROM pk_purchase_lots l
     JOIN pk_products p ON p.id = l.product_id
     LEFT JOIN pk_stock_events e ON e.lot_id = l.id
     GROUP BY l.id
     ORDER BY p.set_name, l.purchase_date, l.id`
  );

  const grouped = new Map<number, PokemonOpsGeneralInventoryRow>();
  for (const lot of lots) {
    let row = grouped.get(lot.product_id);
    if (!row) {
      const market = latestBenchmarkForProduct(lot.product_id);
      row = {
        product_id: lot.product_id,
        set_name: lot.set_name,
        on_hand_units: 0,
        cost_value_cents: 0,
        estimated_market_value_cents: market ? 0 : null,
        market_price_per_pack_cents: market?.price_per_pack_cents ?? null,
        market_source: market?.source ?? null,
        market_observed_date: market?.observed_date ?? null,
        in_transit_units: 0,
        in_transit_cost_cents: 0,
      };
      grouped.set(lot.product_id, row);
    }

    if (lot.status === "in_transit") {
      row.in_transit_units += lot.pack_count;
      row.in_transit_cost_cents = lot.cost_confirmed === 0 || row.in_transit_cost_cents === null
        ? null
        : row.in_transit_cost_cents + lot.pack_count * lot.landed_cost_per_pack_cents;
      continue;
    }
    if (lot.status === "depleted") continue;

    const available = Math.max(0, lot.pack_count - lot.refilled_units);
    row.on_hand_units += available;
    row.cost_value_cents = lot.cost_confirmed === 0 || row.cost_value_cents === null
      ? null
      : row.cost_value_cents + available * lot.landed_cost_per_pack_cents;
    if (row.estimated_market_value_cents !== null && row.market_price_per_pack_cents !== null) {
      row.estimated_market_value_cents += available * row.market_price_per_pack_cents;
    }
  }

  return [...grouped.values()]
    .filter((row) => row.on_hand_units > 0 || row.in_transit_units > 0)
    .sort((a, b) => a.set_name.localeCompare(b.set_name));
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
      const lot = all<{ id:number|null; source:string|null; landed_cost_per_pack_cents:number|null }>(`SELECT l.id,l.source,l.landed_cost_per_pack_cents FROM pk_stock_events e LEFT JOIN pk_purchase_lots l ON l.id=e.lot_id AND l.product_id=? WHERE e.machine_id=? AND e.slot_number=? AND e.at>=? ORDER BY e.at DESC,e.id DESC LIMIT 1`, a.product_id, machine.id, a.slot_number, a.assigned_at)[0];
      const transit = all<{ qty:number }>(`SELECT COALESCE(SUM(pack_count),0) qty FROM pk_purchase_lots WHERE product_id=? AND status='in_transit'`, a.product_id)[0].qty;
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
        source_lot_id: lot?.id ?? null,
        landed_cost_per_pack_cents: lot?.landed_cost_per_pack_cents ?? null,
        source_lot_name: lot?.source ?? null,
        in_transit_units: transit,
      };
    });
    marginPerSlotDayTotal = slots.length === 0 || slots.some(slot => slot.margin_per_slot_day_cents === null)
      ? null
      : slots.reduce((sum, slot) => sum + (slot.margin_per_slot_day_cents ?? 0), 0);
    sellThrough = sellThroughPct(machine.id, asOf);
    spread = refillSyncSpread(machine.id, asOf);
  }

  const openRecs: PokemonOpsRecommendation[] = listOpenRecommendations().map((r) => {
    const { payload_json, ...rest } = r;
    return { ...rest, payload: JSON.parse(payload_json) };
  });
  const general = generalInventory();
  const generalUnits = general.reduce((sum, row) => sum + row.on_hand_units, 0);
  const generalCost = general.some(row => row.on_hand_units > 0 && row.cost_value_cents === null)
    ? null
    : general.reduce((sum, row) => sum + (row.cost_value_cents ?? 0), 0);
  const generalMarket = general.some(
    (row) => row.on_hand_units > 0 && row.estimated_market_value_cents === null
  )
    ? null
    : general.reduce((sum, row) => sum + (row.estimated_market_value_cents ?? 0), 0);
  const inTransitUnits = general.reduce((sum, row) => sum + row.in_transit_units, 0);
  const inTransitCost = general.some(row => row.in_transit_units > 0 && row.in_transit_cost_cents === null)
    ? null
    : general.reduce((sum, row) => sum + (row.in_transit_cost_cents ?? 0), 0);

  return {
    asOf,
    machine: machineOut,
    kpis: {
      margin_per_slot_day_cents: marginPerSlotDayTotal,
      total_invested_cents: totalInvested(),
      sell_through_pct: sellThrough,
      days_of_supply_spread: spread,
      general_inventory_units: generalUnits,
      general_inventory_cost_cents: generalCost,
      general_inventory_market_cents: generalMarket,
      in_transit_units: inTransitUnits,
      in_transit_cost_cents: inTransitCost,
    },
    slots,
    general_inventory: general,
    open_recommendations: openRecs,
    recent_sales: listRecentSales(FEED_LIMIT),
    sourcing_feed: sourcingFeed(),
    recent_lots: recentLots(),
  };
}
