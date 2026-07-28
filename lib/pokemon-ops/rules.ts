// Pokemon ops rules engine. Pure deterministic decision layer: reads the pk_*
// tables + pk_config, emits pk_recommendations rows. No LLM calls, no
// Date.now()/new Date() — `asOf` is threaded in by the caller (scheduler tick
// / API route pass new Date().toISOString()).
//
// Dedupe: a candidate is skipped when an OPEN pk_recommendations row already
// exists with the same (rule, machine_id, slot_number) — payload differences
// do NOT reopen (the open row is the operator's todo; numbers drift daily but
// the action is the same). Once the operator acks/dismisses/completes it, the
// next run may emit a fresh row. Check + insert run inside one IMMEDIATE
// transaction (two-writer WAL rule; nested data-layer txs become savepoints).
import { all, get, getDb } from "@/db";
import {
  getConfigInt,
  insertRecommendation,
  latestBenchmarkForProduct,
  listActiveAssignments,
  currentStockForSlot,
} from "./db";
import {
  daysOfSupply,
  velocity,
  DAY_MS,
  VELOCITY_WINDOW_DAYS,
} from "./metrics";
import type { PkPriceObservation, PkSkuAssignment, NewRecommendation } from "./types";

/**
 * Rule defaults (operator heuristics). pk_config keys
 * (refill_cycle_days, budget_cents, min_margin_cents) stay in pk_config; these
 * are the engine's own constants. alert_threshold_pct is the SOURCING alert
 * threshold and is deliberately NOT used by refill_sync.
 */
export const RULE_CONSTANTS = {
  /** refill_sync fires when max−min days-of-supply across a machine's slots
   *  exceeds this (strictly >). One restock trip should cover everything. */
  REFILL_SYNC_SPREAD_DAYS: 7,
  /** dead_stock: no sales in this trailing window → rotate to mystery slot. */
  DEAD_STOCK_DAYS: 21,
  /** price_raise/add_slot fire when projected sellout (days of supply) is
   *  strictly below this percentage of refill_cycle_days. */
  SELLOUT_THRESHOLD_PCT: 50,
  /** Fast pack → +$1–2 price (mentor heuristic). */
  PRICE_RAISE_MIN_CENTS: 100,
  PRICE_RAISE_MAX_CENTS: 200,
  /** add_slot rotate-candidate: an assigned slot qualifies as donor capacity
   *  when its days of supply is ≥ this (Infinity qualifies). */
  ADD_SLOT_MIN_SUPPLY_DAYS: 21,
  /** refill_order only trusts price observations at most this old (inclusive:
   *  an observation exactly 30 days old still counts). */
  OBSERVATION_MAX_AGE_DAYS: 30,
  /** Mini Wall physical slot count; slots 1..8 without an active assignment
   *  count as unassigned add_slot candidates. */
  MACHINE_SLOT_COUNT: 8,
  /** Trailing window for velocity-derived numbers (re-exported from metrics). */
  VELOCITY_WINDOW_DAYS,
  /** Rules evaluated per machine (refill_sync, price_raise/add_slot,
   *  dead_stock, refill_order) — the `evaluated` counter unit. */
  RULES_PER_MACHINE: 4,
} as const;

export interface RunRulesResult {
  /** machines-with-active-assignments × RULES_PER_MACHINE. */
  evaluated: number;
  emitted: number;
  skipped_duplicates: number;
}

interface SlotStat {
  assignment: PkSkuAssignment & { set_name: string };
  stock: number;
  velocity: number;
  dos: number; // Infinity allowed
}

function parseIso(label: string, iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad ${label}: ${iso}`);
  return ms;
}

/** Infinity → null for JSON payloads (JSON.stringify would do it anyway;
 *  explicit here so payload shapes are self-documenting). */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Dedupe-checked insert; returns true when a row was inserted. */
function emitWithDedupe(cand: NewRecommendation): boolean {
  return getDb()
    .transaction(() => {
      const existing = get<{ id: number }>(
        `SELECT id FROM pk_recommendations
         WHERE status = 'open' AND rule = ? AND machine_id IS ? AND slot_number IS ?
         LIMIT 1`,
        cand.rule,
        cand.machine_id ?? null,
        cand.slot_number ?? null
      );
      if (existing) return false;
      insertRecommendation(cand);
      return true;
    })
    .immediate();
}

// ---- refill_sync ----

function refillSyncCandidate(machineId: number, slots: SlotStat[]): NewRecommendation | null {
  const finite = slots.filter((s) => Number.isFinite(s.dos));
  if (finite.length < 2) return null;
  const maxDos = Math.max(...finite.map((s) => s.dos));
  const minDos = Math.min(...finite.map((s) => s.dos));
  const spread = maxDos - minDos;
  if (!(spread > RULE_CONSTANTS.REFILL_SYNC_SPREAD_DAYS)) return null;
  // Ties: lowest slot_number wins (slots are already slot_number ASC).
  const fastest = finite.find((s) => s.dos === minDos)!;
  const slowest = finite.find((s) => s.dos === maxDos)!;
  return {
    rule: "refill_sync",
    machine_id: machineId,
    slot_number: null,
    severity: "action",
    payload: {
      spread_days: spread,
      threshold_days: RULE_CONSTANTS.REFILL_SYNC_SPREAD_DAYS,
      slots: slots.map((s) => ({
        slot_number: s.assignment.slot_number,
        product_id: s.assignment.product_id,
        set_name: s.assignment.set_name,
        days_of_supply: finiteOrNull(s.dos),
        velocity_units_per_day: s.velocity,
        current_stock: s.stock,
      })),
      // Equalize sellout at the refill visit: the fastest slot (lowest days of
      // supply) gets a price nudge UP (slows it), the slowest gets a nudge
      // down or a rotation (speeds it / frees the capital).
      suggestion: {
        raise_price_slot: fastest.assignment.slot_number,
        lower_price_or_rotate_slot: slowest.assignment.slot_number,
      },
    },
  };
}

// ---- price_raise / add_slot ----

function priceRaiseCandidates(
  machineId: number,
  slots: SlotStat[],
  refillCycleDays: number
): NewRecommendation[] {
  const thresholdDays = (refillCycleDays * RULE_CONSTANTS.SELLOUT_THRESHOLD_PCT) / 100;
  const out: NewRecommendation[] = [];
  const activeSlotNumbers = new Set(slots.map((s) => s.assignment.slot_number));

  for (const s of slots) {
    // Strict <: exactly at the threshold does NOT trigger.
    if (!(s.dos < thresholdDays)) continue;
    out.push({
      rule: "price_raise",
      machine_id: machineId,
      slot_number: s.assignment.slot_number,
      severity: "action",
      payload: {
        product_id: s.assignment.product_id,
        set_name: s.assignment.set_name,
        days_of_supply: s.dos, // finite by construction (< threshold)
        threshold_days: thresholdDays,
        velocity_units_per_day: s.velocity,
        current_stock: s.stock,
        current_price_cents: s.assignment.price_cents,
        suggested_price_min_cents: s.assignment.price_cents + RULE_CONSTANTS.PRICE_RAISE_MIN_CENTS,
        suggested_price_max_cents: s.assignment.price_cents + RULE_CONSTANTS.PRICE_RAISE_MAX_CENTS,
      },
    });

    // add_slot when capacity allows. Candidate preference:
    // 1) lowest-numbered physically unassigned slot (1..MACHINE_SLOT_COUNT);
    // 2) else the OTHER assigned slot with the highest days of supply, if that
    //    is ≥ ADD_SLOT_MIN_SUPPLY_DAYS (Infinity qualifies and outranks any
    //    finite value; ties → lowest slot_number).
    let candidateSlot: number | null = null;
    let candidateKind: "unassigned" | "rotate" | null = null;
    let candidateDos: number | null = null;
    for (let n = 1; n <= RULE_CONSTANTS.MACHINE_SLOT_COUNT; n++) {
      if (!activeSlotNumbers.has(n)) {
        candidateSlot = n;
        candidateKind = "unassigned";
        break;
      }
    }
    if (candidateSlot === null) {
      let best: SlotStat | null = null;
      for (const other of slots) {
        if (other.assignment.slot_number === s.assignment.slot_number) continue;
        if (!(other.dos >= RULE_CONSTANTS.ADD_SLOT_MIN_SUPPLY_DAYS)) continue;
        if (best === null || other.dos > best.dos) best = other; // ASC scan → tie keeps lowest slot
      }
      if (best) {
        candidateSlot = best.assignment.slot_number;
        candidateKind = "rotate";
        candidateDos = finiteOrNull(best.dos);
      }
    }
    if (candidateSlot !== null) {
      out.push({
        rule: "add_slot",
        machine_id: machineId,
        slot_number: s.assignment.slot_number, // the fast slot needing a second lane
        severity: "action",
        payload: {
          product_id: s.assignment.product_id,
          set_name: s.assignment.set_name,
          fast_slot: s.assignment.slot_number,
          fast_days_of_supply: s.dos,
          candidate_slot: candidateSlot,
          candidate_kind: candidateKind,
          candidate_days_of_supply: candidateDos,
        },
      });
    }
  }
  return out;
}

// ---- dead_stock ----

function deadStockCandidates(
  machineId: number,
  slots: SlotStat[],
  asOf: string
): NewRecommendation[] {
  const asOfMs = parseIso("asOf", asOf);
  const cutoffIso = new Date(asOfMs - RULE_CONSTANTS.DEAD_STOCK_DAYS * DAY_MS).toISOString();
  const out: NewRecommendation[] = [];
  for (const s of slots) {
    if (s.stock <= 0) continue;
    const recent = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pk_sales
       WHERE machine_id = ? AND slot_number = ? AND sold_at > ? AND sold_at <= ?`,
      machineId,
      s.assignment.slot_number,
      cutoffIso,
      asOf
    )!.n;
    if (recent > 0) continue;
    const lastSale = get<{ sold_at: string }>(
      `SELECT sold_at FROM pk_sales
       WHERE machine_id = ? AND slot_number = ? AND sold_at <= ?
       ORDER BY sold_at DESC, id DESC LIMIT 1`,
      machineId,
      s.assignment.slot_number,
      asOf
    );
    out.push({
      rule: "dead_stock",
      machine_id: machineId,
      slot_number: s.assignment.slot_number,
      severity: "info",
      payload: {
        product_id: s.assignment.product_id,
        set_name: s.assignment.set_name,
        current_stock: s.stock,
        window_days: RULE_CONSTANTS.DEAD_STOCK_DAYS,
        last_sale_at: lastSale ? lastSale.sold_at : null,
        // Raw fractional days (asOf − last sale) / 1 day; null when never sold.
        days_since_last_sale: lastSale
          ? (asOfMs - parseIso("sold_at", lastSale.sold_at)) / DAY_MS
          : null,
        suggestion: "rotate_to_mystery",
      },
    });
  }
  return out;
}

// ---- refill_order ----

interface ProductNeed {
  productId: number;
  setName: string;
  slotNumbers: number[];
  need: number;
  minDos: number; // Infinity allowed
  minSlot: number;
  minPriceCents: number;
}

/**
 * Source selection per product: take the FRESHEST observation per source
 * (max observed_date, tie → max id), drop sources whose freshest observation
 * is older than OBSERVATION_MAX_AGE_DAYS (observed_date <
 * date(asOf − 30 days); exactly 30 days old is still fresh), then pick the
 * cheapest (lowest price_per_pack_cents; tie → most recent observed_date;
 * tie → source name ascending alphabetically). TCGplayer and eBay sold are
 * valuation indicators, not actionable offers, so they do not participate.
 * Carddistro remains eligible here as a supplier quote. Observation prices are
 * treated as the expected landed cost per pack (includes_shipping /
 * includes_tax flags are ignored in v1 — documented simplification).
 */
function pickSource(
  productId: number,
  freshCutoffDate: string
): PkPriceObservation | null {
  const rows = all<PkPriceObservation>(
    `SELECT * FROM pk_price_observations
     WHERE product_id = ? AND source NOT IN ('tcgplayer', 'ebay_sold')
     ORDER BY source, observed_date DESC, id DESC`,
    productId
  );
  const freshestPerSource: PkPriceObservation[] = [];
  let lastSource: string | null = null;
  for (const r of rows) {
    if (r.source !== lastSource) {
      lastSource = r.source;
      if (r.observed_date >= freshCutoffDate) freshestPerSource.push(r);
    }
  }
  if (freshestPerSource.length === 0) return null;
  freshestPerSource.sort((a, b) => {
    if (a.price_per_pack_cents !== b.price_per_pack_cents) {
      return a.price_per_pack_cents - b.price_per_pack_cents;
    }
    if (a.observed_date !== b.observed_date) return a.observed_date < b.observed_date ? 1 : -1;
    return a.source < b.source ? -1 : 1;
  });
  return freshestPerSource[0];
}

/**
 * Shopping-list generator. Greedy fill, lowest days-of-supply first:
 * products are grouped across the machine's slots (need = Σ max(0,
 * capacity − stock); expected margin uses the LOWEST active assignment price
 * for the product on this machine — conservative), ordered by min days of
 * supply ascending (Infinity last; tie → lowest slot number), and bought at
 * qty = min(need, floor(remaining_budget / unit_cost)) until the budget runs
 * out. Products with expected margin < min_margin_cents (strict <; exactly at
 * the minimum is kept) or with no fresh source are recorded under `skipped`.
 * Products with zero need are omitted entirely; a product the budget can no
 * longer afford at all (qty 0) is omitted from items. Emitted only when the
 * item list is non-empty.
 */
function refillOrderCandidate(
  machineId: number,
  slots: SlotStat[],
  asOf: string,
  cfg: { budgetCents: number; minMarginCents: number }
): NewRecommendation | null {
  const asOfMs = parseIso("asOf", asOf);
  const freshCutoffDate = new Date(
    asOfMs - RULE_CONSTANTS.OBSERVATION_MAX_AGE_DAYS * DAY_MS
  )
    .toISOString()
    .slice(0, 10);

  const byProduct = new Map<number, ProductNeed>();
  for (const s of slots) {
    const need = Math.max(0, s.assignment.capacity - s.stock);
    const existing = byProduct.get(s.assignment.product_id);
    if (!existing) {
      byProduct.set(s.assignment.product_id, {
        productId: s.assignment.product_id,
        setName: s.assignment.set_name,
        slotNumbers: [s.assignment.slot_number],
        need,
        minDos: s.dos,
        minSlot: s.assignment.slot_number,
        minPriceCents: s.assignment.price_cents,
      });
    } else {
      existing.slotNumbers.push(s.assignment.slot_number);
      existing.need += need;
      if (s.dos < existing.minDos) existing.minDos = s.dos;
      existing.minSlot = Math.min(existing.minSlot, s.assignment.slot_number);
      existing.minPriceCents = Math.min(existing.minPriceCents, s.assignment.price_cents);
    }
  }

  const groups = [...byProduct.values()]
    .filter((g) => g.need > 0)
    .sort((a, b) => {
      const aDos = Number.isFinite(a.minDos) ? a.minDos : Number.MAX_VALUE;
      const bDos = Number.isFinite(b.minDos) ? b.minDos : Number.MAX_VALUE;
      if (aDos !== bDos) return aDos - bDos;
      return a.minSlot - b.minSlot;
    });

  const items: unknown[] = [];
  const skipped: unknown[] = [];
  let remaining = cfg.budgetCents;

  for (const g of groups) {
    const obs = pickSource(g.productId, freshCutoffDate);
    if (!obs) {
      skipped.push({
        product_id: g.productId,
        set_name: g.setName,
        slot_numbers: g.slotNumbers,
        reason: "no_fresh_observation",
      });
      continue;
    }
    const unitCost = obs.price_per_pack_cents;
    const margin = g.minPriceCents - unitCost;
    if (margin < cfg.minMarginCents) {
      skipped.push({
        product_id: g.productId,
        set_name: g.setName,
        slot_numbers: g.slotNumbers,
        reason: "below_min_margin",
        source: obs.source,
        unit_cost_cents: unitCost,
        price_cents: g.minPriceCents,
        expected_margin_per_pack_cents: margin,
      });
      continue;
    }
    const qty = Math.min(g.need, Math.floor(remaining / unitCost));
    if (qty <= 0) continue;
    const benchmark = latestBenchmarkForProduct(g.productId);
    const lineTotal = qty * unitCost;
    remaining -= lineTotal;
    items.push({
      product_id: g.productId,
      set_name: g.setName,
      slot_numbers: g.slotNumbers,
      need: g.need,
      days_of_supply: finiteOrNull(g.minDos),
      qty,
      source: obs.source,
      observed_date: obs.observed_date,
      unit_cost_cents: unitCost,
      line_total_cents: lineTotal,
      expected_margin_per_pack_cents: margin,
      benchmark_delta_cents: benchmark ? unitCost - benchmark.price_per_pack_cents : null,
    });
  }

  if (items.length === 0) return null;
  return {
    rule: "refill_order",
    machine_id: machineId,
    slot_number: null,
    severity: "action",
    payload: {
      budget_cents: cfg.budgetCents,
      spent_cents: cfg.budgetCents - remaining,
      remaining_cents: remaining,
      items,
      skipped,
    },
  };
}

// ---- runner ----

/**
 * Evaluates all rules for every machine that has ≥1 active SKU assignment.
 * Deterministic given DB contents + asOf. Candidate order per machine:
 * refill_sync, then per-slot price_raise/add_slot (slot ASC), then dead_stock
 * (slot ASC), then refill_order — only row ids depend on this order.
 */
export function runRules(asOf: string): RunRulesResult {
  parseIso("asOf", asOf); // validate early
  const refillCycleDays = getConfigInt("refill_cycle_days");
  const budgetCents = getConfigInt("budget_cents");
  const minMarginCents = getConfigInt("min_margin_cents");

  const machineRows = all<{ machine_id: number }>(
    `SELECT DISTINCT machine_id FROM pk_sku_assignments
     WHERE ended_at IS NULL ORDER BY machine_id`
  );

  let evaluated = 0;
  let emitted = 0;
  let skippedDuplicates = 0;

  for (const { machine_id } of machineRows) {
    evaluated += RULE_CONSTANTS.RULES_PER_MACHINE;
    const assignments = listActiveAssignments(machine_id); // slot_number ASC
    const slots: SlotStat[] = assignments.map((a) => ({
      assignment: a,
      stock: currentStockForSlot(machine_id, a.slot_number),
      velocity: velocity(machine_id, a.slot_number, asOf),
      dos: daysOfSupply(machine_id, a.slot_number, asOf),
    }));

    const candidates: NewRecommendation[] = [];
    const sync = refillSyncCandidate(machine_id, slots);
    if (sync) candidates.push(sync);
    candidates.push(...priceRaiseCandidates(machine_id, slots, refillCycleDays));
    candidates.push(...deadStockCandidates(machine_id, slots, asOf));
    const order = refillOrderCandidate(machine_id, slots, asOf, { budgetCents, minMarginCents });
    if (order) candidates.push(order);

    for (const cand of candidates) {
      if (emitWithDedupe(cand)) emitted += 1;
      else skippedDuplicates += 1;
    }
  }

  return { evaluated, emitted, skipped_duplicates: skippedDuplicates };
}
