// Pokemon ops derived metrics. Pure, deterministic, read-only. Every value here
// is on the PLAN §2 "Derived only (NEVER stored)" list — computed from the pk_*
// tables on demand, never persisted.
//
// Determinism contract: every function is a pure function of (DB contents, its
// explicit parameters). Functions that need "now" take an `asOf` ISO-8601 UTC
// timestamp parameter — Date.now() / new Date() are NEVER called in this module.
// Callers (scheduler tick, API route) pass new Date().toISOString().
//
// Money: integer cents throughout. The only divisions that produce money are
// rounded with Math.round at the documented point (marginPerSlotDay). Velocity
// and days-of-supply are unitless rates/durations and stay raw IEEE doubles
// (no rounding) — golden fixtures use exact-binary values.
//
// Time windows: a trailing window of N days ending at asOf is the half-open
// interval (asOf − N days, asOf]: a sale exactly at the window start is
// EXCLUDED, a sale exactly at asOf is INCLUDED. All arithmetic in epoch ms,
// 1 day = 86_400_000 ms (UTC, no DST).
import { all } from "@/db";
import { currentStockForSlot, latestBenchmarkForProduct } from "./db";
import type { PkPriceObservation, PkPurchaseLot, PkSale } from "./types";

export const DAY_MS = 86_400_000;

/** Default trailing window for velocity (and everything derived from it:
 *  days of supply, projected sellout, refill-sync spread). 14 days — long
 *  enough to smooth weekday/weekend swings on a low-volume machine, short
 *  enough to react within one refill cycle. Exposed as a parameter on every
 *  velocity-derived function; NOT read from pk_config. */
export const VELOCITY_WINDOW_DAYS = 14;

function parseIso(label: string, iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad ${label}: ${iso}`);
  return ms;
}

// ---- FIFO lot allocation ----

export interface FifoLotDraw {
  lot_id: number;
  qty: number;
  landed_cost_per_pack_cents: number;
}

export interface FifoSaleAllocation {
  sale_id: number;
  machine_id: number;
  slot_number: number;
  sold_at: string;
  qty: number;
  unit_price_cents: number;
  /** Lot draws in FIFO order. Σ draw qty + unallocated_qty = sale qty. */
  allocations: FifoLotDraw[];
  /**
   * Σ over units of (unit_price_cents − landed_cost_per_pack_cents of the lot
   * the unit drew from). Units with no lot to draw from (unallocated) are
   * costed at 0 — see unallocated_qty.
   */
  margin_cents: number;
  /** Units sold beyond total lot supply (data-entry gap: sales recorded with
   *  no covering purchase lot). Costed at 0 cents and flagged here so callers
   *  can surface the gap instead of silently mispricing it. */
  unallocated_qty: number;
}

/**
 * FIFO allocation of a product's sales against its purchase lots, global
 * across machines (lots are bought per product, not per machine).
 *
 * Ordering (the FIFO convention):
 * - Lots: purchase_date ASC, then id ASC. Only lots with status != 'in_transit'
 *   participate — an in-transit lot has not physically arrived so its packs
 *   cannot have been sold. received / allocated / depleted all participate:
 *   allocation is a historical replay, and lot status is operational metadata
 *   that must not change past margins.
 * - Sales: sold_at ASC, then id ASC. Every sale of qty N consumes the next N
 *   available packs, splitting across lot boundaries when needed.
 *
 * Margin per pack = unit_price_cents − landed_cost_per_pack_cents of the lot
 * that pack drew from (integer subtraction, no rounding).
 */
export function fifoAllocation(productId: number): FifoSaleAllocation[] {
  const lots = all<PkPurchaseLot>(
    `SELECT * FROM pk_purchase_lots
     WHERE product_id = ? AND status != 'in_transit'
     ORDER BY purchase_date, id`,
    productId
  );
  const sales = all<PkSale>(
    `SELECT * FROM pk_sales WHERE product_id = ? ORDER BY sold_at, id`,
    productId
  );

  let lotIdx = 0;
  let remainingInLot = lots.length > 0 ? lots[0].pack_count : 0;
  const out: FifoSaleAllocation[] = [];

  for (const sale of sales) {
    let toAllocate = sale.qty;
    const draws: FifoLotDraw[] = [];
    let margin = 0;
    while (toAllocate > 0 && lotIdx < lots.length) {
      if (remainingInLot === 0) {
        lotIdx += 1;
        remainingInLot = lotIdx < lots.length ? lots[lotIdx].pack_count : 0;
        continue;
      }
      const lot = lots[lotIdx];
      const take = Math.min(toAllocate, remainingInLot);
      draws.push({ lot_id: lot.id, qty: take, landed_cost_per_pack_cents: lot.landed_cost_per_pack_cents });
      margin += take * (sale.unit_price_cents - lot.landed_cost_per_pack_cents);
      toAllocate -= take;
      remainingInLot -= take;
    }
    // Unallocated units: costed at 0 (full price counts as margin) + flagged.
    margin += toAllocate * sale.unit_price_cents;
    out.push({
      sale_id: sale.id,
      machine_id: sale.machine_id,
      slot_number: sale.slot_number,
      sold_at: sale.sold_at,
      qty: sale.qty,
      unit_price_cents: sale.unit_price_cents,
      allocations: draws,
      margin_cents: margin,
      unallocated_qty: toAllocate,
    });
  }
  return out;
}

// ---- primary KPI: margin $/slot/day ----

/**
 * PRIMARY KPI. Formula:
 *   marginPerSlotDay = Math.round( Σ margin_cents of sales attributed to
 *                                  (machineId, slotNumber) in (asOf − windowDays, asOf]
 *                                  / windowDays )
 * Sale margins come from the product-level FIFO allocation (fifoAllocation);
 * a sale is attributed to the slot recorded on its pk_sales row. Returns
 * integer cents per day — the ONLY rounding point is the final division.
 */
export function marginPerSlotDay(
  machineId: number,
  slotNumber: number,
  windowDays: number,
  asOf: string
): number {
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error(`windowDays must be a positive integer, got ${String(windowDays)}`);
  }
  const asOfMs = parseIso("asOf", asOf);
  const startMs = asOfMs - windowDays * DAY_MS;

  const productIds = all<{ product_id: number }>(
    `SELECT DISTINCT product_id FROM pk_sales WHERE machine_id = ? AND slot_number = ?`,
    machineId,
    slotNumber
  ).map((r) => r.product_id);

  let total = 0;
  for (const pid of productIds) {
    for (const alloc of fifoAllocation(pid)) {
      if (alloc.machine_id !== machineId || alloc.slot_number !== slotNumber) continue;
      const soldMs = parseIso("sold_at", alloc.sold_at);
      if (soldMs > startMs && soldMs <= asOfMs) total += alloc.margin_cents;
    }
  }
  return Math.round(total / windowDays);
}

// ---- velocity / days of supply / projected sellout ----

/**
 * Units sold per day over the trailing window:
 *   velocity = Σ qty of sales in (asOf − windowDays, asOf] / windowDays
 * Raw double, no rounding. Default window: VELOCITY_WINDOW_DAYS (14).
 */
export function velocity(
  machineId: number,
  slotNumber: number,
  asOf: string,
  windowDays: number = VELOCITY_WINDOW_DAYS
): number {
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error(`windowDays must be a positive integer, got ${String(windowDays)}`);
  }
  const asOfMs = parseIso("asOf", asOf);
  const startIso = new Date(asOfMs - windowDays * DAY_MS).toISOString();
  const row = all<{ s: number }>(
    `SELECT COALESCE(SUM(qty), 0) AS s FROM pk_sales
     WHERE machine_id = ? AND slot_number = ? AND sold_at > ? AND sold_at <= ?`,
    machineId,
    slotNumber,
    startIso,
    asOf
  )[0];
  return row.s / windowDays;
}

/**
 * daysOfSupply = currentStock / velocity.
 * - currentStock ≤ 0 → 0 (already out, regardless of velocity).
 * - velocity 0 with stock > 0 → Infinity (never sells out). JS Infinity in
 *   TypeScript; serialized as null in JSON payloads (JSON.stringify does this
 *   natively) — consumers read null as "no sellout in sight".
 * Current stock is the data layer's currentStockForSlot (full event history;
 * the DB never contains future rows, so this is deterministic given DB + asOf).
 */
export function daysOfSupply(
  machineId: number,
  slotNumber: number,
  asOf: string,
  windowDays: number = VELOCITY_WINDOW_DAYS
): number {
  const stock = currentStockForSlot(machineId, slotNumber);
  if (stock <= 0) return 0;
  const v = velocity(machineId, slotNumber, asOf, windowDays);
  if (v === 0) return Infinity;
  return stock / v;
}

/**
 * projectedSelloutDate = asOf + daysOfSupply (fractional days converted to ms,
 * Math.round to whole ms before building the date). Infinity days of supply →
 * null (no projected sellout).
 */
export function projectedSelloutDate(
  machineId: number,
  slotNumber: number,
  asOf: string,
  windowDays: number = VELOCITY_WINDOW_DAYS
): string | null {
  const dos = daysOfSupply(machineId, slotNumber, asOf, windowDays);
  if (!Number.isFinite(dos)) return null;
  const asOfMs = parseIso("asOf", asOf);
  return new Date(asOfMs + Math.round(dos * DAY_MS)).toISOString();
}

/**
 * refillSyncSpread = max(daysOfSupply) − min(daysOfSupply) over the machine's
 * slots with an active assignment, FINITE values only (a slot with velocity 0
 * has Infinity days of supply and is excluded — it cannot be equalized by
 * timing). Fewer than 2 finite values → null (no spread computable).
 */
export function refillSyncSpread(
  machineId: number,
  asOf: string,
  windowDays: number = VELOCITY_WINDOW_DAYS
): number | null {
  const slots = all<{ slot_number: number }>(
    `SELECT slot_number FROM pk_sku_assignments
     WHERE machine_id = ? AND ended_at IS NULL ORDER BY slot_number`,
    machineId
  );
  const finite: number[] = [];
  for (const s of slots) {
    const dos = daysOfSupply(machineId, s.slot_number, asOf, windowDays);
    if (Number.isFinite(dos)) finite.push(dos);
  }
  if (finite.length < 2) return null;
  return Math.max(...finite) - Math.min(...finite);
}

// ---- capital ----

/**
 * totalInvested = Σ pk_purchase_lots.total_cost_cents over ALL lots, all-time,
 * every status included (in_transit money is spent; depleted lots stay in the
 * lifetime total). Per PLAN §2: "Lots roll up to total invested".
 */
export function totalInvested(): number {
  const row = all<{ s: number }>(
    `SELECT COALESCE(SUM(total_cost_cents), 0) AS s FROM pk_purchase_lots`
  )[0];
  return row.s;
}

// ---- benchmark deltas over time ----

export interface BenchmarkDeltaPoint {
  observation_id: number;
  source: string;
  observed_date: string;
  price_per_pack_cents: number;
  /** External market benchmark at this point's date: latest TCGplayer market
   *  observation, or latest eBay sold observation only when no eligible
   *  TCGplayer observation exists. Same-date ties use highest id. */
  benchmark_price_cents: number | null;
  /** price − benchmark (negative = cheaper than external market). null when
   *  benchmark is null. */
  benchmark_delta_cents: number | null;
}

/**
 * Per-source price history vs the external market benchmark at each
 * observed_date. ALL sources remain visible, but only TCGplayer market and the
 * eBay sold fallback can define benchmark value. Ordered by observed_date ASC,
 * then id ASC; callers group by source as needed.
 */
export function benchmarkDeltaSeries(productId: number): BenchmarkDeltaPoint[] {
  const observations = all<PkPriceObservation>(
    `SELECT * FROM pk_price_observations WHERE product_id = ?
     ORDER BY observed_date, id`,
    productId
  );
  const tcgBenchmarks = observations.filter((o) => o.source === "tcgplayer");
  const ebaySoldBenchmarks = observations.filter((o) => o.source === "ebay_sold");

  return observations.map((o) => {
    let current: PkPriceObservation | null = null;
    // Scan in date/id ascending order so the final eligible row is the latest.
    // TCGplayer is primary for this date; eBay sold is consulted only if none exists.
    for (const b of tcgBenchmarks) {
      if (b.observed_date <= o.observed_date) current = b;
      else break;
    }
    if (!current) {
      for (const b of ebaySoldBenchmarks) {
        if (b.observed_date <= o.observed_date) current = b;
        else break;
      }
    }
    return {
      observation_id: o.id,
      source: o.source,
      observed_date: o.observed_date,
      price_per_pack_cents: o.price_per_pack_cents,
      benchmark_price_cents: current ? current.price_per_pack_cents : null,
      benchmark_delta_cents: current ? o.price_per_pack_cents - current.price_per_pack_cents : null,
    };
  });
}
