// Pokemon ops data layer. Server-only (SQLite via @/db).
// Append-only domains: current state (stock, benchmark, active assignment) is
// derived by query, never mutated. All write helpers run inside IMMEDIATE
// transactions so external CLIs (Hermes scans, cron importers) share the WAL db
// with the server safely — DEFERRED write transactions from a second writer die
// with SQLITE_BUSY_SNAPSHOT mid-tx; IMMEDIATE takes the write lock up front.
// Nested calls (e.g. from the importer's own IMMEDIATE tx) become savepoints.
import { all, get, getDb } from "@/db";
import {
  LOT_STATUSES,
  OBSERVATION_SOURCES,
  PRODUCT_FORMS,
  PRODUCT_TIERS,
  RECOMMENDATION_RULES,
  RECOMMENDATION_SEVERITIES,
  RECOMMENDATION_STATUSES,
  REPRINT_STATUSES,
  SALE_SOURCES,
  STOCK_EVENT_TYPES,
  type Machine,
  type NewImportReceipt,
  type NewPriceObservation,
  type NewProduct,
  type NewPurchaseLot,
  type NewRecommendation,
  type NewSale,
  type NewSkuAssignment,
  type NewStockEvent,
  type PkImportReceipt,
  type PkPriceObservation,
  type PkProduct,
  type PkPurchaseLot,
  type PkRecommendation,
  type PkSale,
  type PkSkuAssignment,
  type PkStockEvent,
} from "./types";

const nowIso = () => new Date().toISOString();

function immediate<T>(fn: () => T): T {
  return getDb().transaction(fn).immediate();
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`bad ${label}: ${value}`);
  }
}

function assertInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got ${String(value)}`);
  }
  return value;
}

function assertDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD, got ${value}`);
  }
  return value;
}

// ---- machines (existing table; ops only reads/ensures, never restructures) ----

export function getMachineByName(name: string): Machine | undefined {
  return get<Machine>(`SELECT * FROM machines WHERE name = ?`, name);
}

/** Lookup-first ensure. Existing rows are left alone except NULL note/location backfill. */
export function ensureMachine(input: {
  name: string;
  location: string;
  status: string;
  note: string;
}): number {
  return immediate(() => {
    const existing = getMachineByName(input.name);
    if (existing) {
      getDb()
        .prepare(
          `UPDATE machines SET
             location = COALESCE(location, ?),
             note = COALESCE(note, ?)
           WHERE id = ?`
        )
        .run(input.location, input.note, existing.id);
      return existing.id;
    }
    const res = getDb()
      .prepare(`INSERT INTO machines (name, location, status, note) VALUES (?, ?, ?, ?)`)
      .run(input.name, input.location, input.status, input.note);
    return Number(res.lastInsertRowid);
  });
}

// ---- pk_products ----

export function getProductBySetName(setName: string): PkProduct | undefined {
  return get<PkProduct>(`SELECT * FROM pk_products WHERE set_name = ?`, setName);
}

export function getProduct(id: number): PkProduct | undefined {
  return get<PkProduct>(`SELECT * FROM pk_products WHERE id = ?`, id);
}

export function listProducts(): PkProduct[] {
  return all<PkProduct>(`SELECT * FROM pk_products ORDER BY set_name`);
}

export function insertProduct(input: NewProduct): number {
  assertEnum(input.form, PRODUCT_FORMS, "form");
  assertEnum(input.tier, PRODUCT_TIERS, "tier");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT INTO pk_products (set_name, form, display_name, release_date, tier, reprint_status, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.set_name,
        input.form,
        input.display_name ?? input.set_name,
        input.release_date ?? null,
        input.tier,
        input.reprint_status ?? "none",
        input.active ?? 1
      );
    return Number(res.lastInsertRowid);
  });
}

/** Canonical-name resolution: one row per set_name, lookup-first, idempotent. */
export function ensureProduct(input: NewProduct): number {
  return immediate(() => {
    const existing = getProductBySetName(input.set_name);
    if (existing) return existing.id;
    return insertProduct(input);
  });
}

export interface ProductPatch {
  tier?: string;
  reprint_status?: string;
  active?: 0 | 1;
  display_name?: string;
}

/** Partial edit: tier / reprint_status / active / display_name. set_name is immutable (canonical key). */
export function updateProductFields(id: number, patch: ProductPatch): PkProduct {
  if (!getProduct(id)) throw new Error(`product ${id} not found`);
  if (patch.tier !== undefined) assertEnum(patch.tier, PRODUCT_TIERS, "tier");
  if (patch.reprint_status !== undefined) {
    assertEnum(patch.reprint_status, REPRINT_STATUSES, "reprint_status");
  }
  if (patch.active !== undefined && patch.active !== 0 && patch.active !== 1) {
    throw new Error(`active must be 0 or 1, got ${String(patch.active)}`);
  }
  return immediate(() => {
    getDb()
      .prepare(
        `UPDATE pk_products SET
           tier = COALESCE(?, tier),
           reprint_status = COALESCE(?, reprint_status),
           active = COALESCE(?, active),
           display_name = COALESCE(?, display_name)
         WHERE id = ?`
      )
      .run(
        patch.tier ?? null,
        patch.reprint_status ?? null,
        patch.active ?? null,
        patch.display_name ?? null,
        id
      );
    return getProduct(id)!;
  });
}

// ---- pk_price_observations ----

export function insertPriceObservation(
  input: NewPriceObservation
): { id: number | null; inserted: boolean } {
  assertEnum(input.source, OBSERVATION_SOURCES, "observation source");
  assertDate(input.observed_date, "observed_date");
  assertInt(input.price_per_pack_cents, "price_per_pack_cents");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT OR IGNORE INTO pk_price_observations
           (observed_date, source, product_id, price_per_pack_cents, lot_size,
            total_cost_cents, includes_shipping, includes_tax, listing_ref,
            quantity_available, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.observed_date,
        input.source,
        input.product_id,
        input.price_per_pack_cents,
        input.lot_size ?? null,
        input.total_cost_cents ?? null,
        input.includes_shipping ?? null,
        input.includes_tax ?? null,
        (input.listing_ref ?? "").trim(),
        input.quantity_available ?? null,
        input.notes ?? null
      );
    return res.changes === 1
      ? { id: Number(res.lastInsertRowid), inserted: true }
      : { id: null, inserted: false };
  });
}

export function latestBenchmarkForProduct(productId: number): PkPriceObservation | undefined {
  return get<PkPriceObservation>(
    `SELECT * FROM pk_v_benchmark_current WHERE product_id = ?`,
    productId
  );
}

export function listBenchmarks(): Array<PkPriceObservation & { set_name: string }> {
  return all(
    `SELECT b.*, p.set_name
     FROM pk_v_benchmark_current b JOIN pk_products p ON p.id = b.product_id
     ORDER BY p.set_name`
  );
}

export function listRecentObservations(
  limit = 50
): Array<PkPriceObservation & { set_name: string }> {
  return all(
    `SELECT o.*, p.set_name
     FROM pk_price_observations o JOIN pk_products p ON p.id = o.product_id
     ORDER BY o.observed_date DESC, o.id DESC LIMIT ?`,
    limit
  );
}

export function listObservationsForProduct(productId: number): PkPriceObservation[] {
  return all<PkPriceObservation>(
    `SELECT * FROM pk_price_observations WHERE product_id = ?
     ORDER BY observed_date DESC, id DESC`,
    productId
  );
}

export interface ObservationFilter {
  productId?: number;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function listObservationsFiltered(
  opts: ObservationFilter = {}
): Array<PkPriceObservation & { set_name: string }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.productId !== undefined) {
    clauses.push("o.product_id = ?");
    params.push(opts.productId);
  }
  if (opts.source) {
    clauses.push("o.source = ?");
    params.push(opts.source);
  }
  if (opts.dateFrom) {
    clauses.push("o.observed_date >= ?");
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    clauses.push("o.observed_date <= ?");
    params.push(opts.dateTo);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 50);
  return all(
    `SELECT o.*, p.set_name
     FROM pk_price_observations o JOIN pk_products p ON p.id = o.product_id
     ${where}
     ORDER BY o.observed_date DESC, o.id DESC LIMIT ?`,
    ...params
  );
}

// ---- pk_purchase_lots ----

/**
 * Computes landed_cost_per_pack_cents and snapshots the benchmark at insert:
 * benchmark_price_cents = latest carddistro observation for the product,
 * benchmark_delta_cents = landed − benchmark (negative = cheaper than mentor).
 */
export function insertPurchaseLot(input: NewPurchaseLot): number {
  assertEnum(input.source, OBSERVATION_SOURCES, "lot source");
  assertDate(input.purchase_date, "purchase_date");
  assertInt(input.total_cost_cents, "total_cost_cents");
  const packCount = assertInt(input.pack_count, "pack_count");
  if (packCount <= 0) throw new Error(`pack_count must be > 0, got ${packCount}`);
  if (input.status) assertEnum(input.status, LOT_STATUSES, "lot status");
  return immediate(() => {
    const landed = Math.round(input.total_cost_cents / packCount);
    const benchmark = latestBenchmarkForProduct(input.product_id);
    const benchmarkPrice = benchmark ? benchmark.price_per_pack_cents : null;
    const res = getDb()
      .prepare(
        `INSERT INTO pk_purchase_lots
           (purchase_date, source, product_id, pack_count, total_cost_cents,
            landed_cost_per_pack_cents, observation_id, benchmark_price_cents,
            benchmark_delta_cents, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.purchase_date,
        input.source,
        input.product_id,
        packCount,
        input.total_cost_cents,
        landed,
        input.observation_id ?? null,
        benchmarkPrice,
        benchmarkPrice === null ? null : landed - benchmarkPrice,
        input.status ?? "in_transit",
        input.notes ?? null
      );
    return Number(res.lastInsertRowid);
  });
}

export function getPurchaseLot(id: number): PkPurchaseLot | undefined {
  return get<PkPurchaseLot>(`SELECT * FROM pk_purchase_lots WHERE id = ?`, id);
}

export function listPurchaseLots(): Array<PkPurchaseLot & { set_name: string }> {
  return all(
    `SELECT l.*, p.set_name
     FROM pk_purchase_lots l JOIN pk_products p ON p.id = l.product_id
     ORDER BY l.purchase_date DESC, l.id DESC`
  );
}

export function listPurchaseLotsFiltered(
  opts: { status?: string; productId?: number } = {}
): Array<PkPurchaseLot & { set_name: string }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    clauses.push("l.status = ?");
    params.push(opts.status);
  }
  if (opts.productId !== undefined) {
    clauses.push("l.product_id = ?");
    params.push(opts.productId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return all(
    `SELECT l.*, p.set_name
     FROM pk_purchase_lots l JOIN pk_products p ON p.id = l.product_id
     ${where}
     ORDER BY l.purchase_date DESC, l.id DESC`,
    ...params
  );
}

/** Status transition (in_transit -> received -> allocated -> depleted). Enum-validated only. */
export function updateLotStatus(id: number, status: string): PkPurchaseLot {
  assertEnum(status, LOT_STATUSES, "lot status");
  return immediate(() => {
    const res = getDb().prepare(`UPDATE pk_purchase_lots SET status = ? WHERE id = ?`).run(status, id);
    if (res.changes === 0) throw new Error(`purchase lot ${id} not found`);
    return getPurchaseLot(id)!;
  });
}

// ---- pk_sku_assignments ----

export function insertSkuAssignment(input: NewSkuAssignment): number {
  assertInt(input.slot_number, "slot_number");
  assertInt(input.price_cents, "price_cents");
  assertInt(input.capacity, "capacity");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT INTO pk_sku_assignments
           (machine_id, slot_number, product_id, price_cents, capacity, assigned_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.machine_id,
        input.slot_number,
        input.product_id,
        input.price_cents,
        input.capacity,
        input.assigned_at ?? nowIso(),
        input.note ?? null
      );
    return Number(res.lastInsertRowid);
  });
}

/** Rotation/price change: end the old row (append the new one separately). */
export function endSkuAssignment(id: number, endedAt?: string): void {
  immediate(() => {
    const res = getDb()
      .prepare(`UPDATE pk_sku_assignments SET ended_at = ? WHERE id = ? AND ended_at IS NULL`)
      .run(endedAt ?? nowIso(), id);
    if (res.changes === 0) throw new Error(`sku assignment ${id} not found or already ended`);
  });
}

export function listActiveAssignments(
  machineId?: number
): Array<PkSkuAssignment & { set_name: string }> {
  if (machineId !== undefined) {
    return all(
      `SELECT a.*, p.set_name
       FROM pk_sku_assignments a JOIN pk_products p ON p.id = a.product_id
       WHERE a.ended_at IS NULL AND a.machine_id = ?
       ORDER BY a.slot_number`,
      machineId
    );
  }
  return all(
    `SELECT a.*, p.set_name
     FROM pk_sku_assignments a JOIN pk_products p ON p.id = a.product_id
     WHERE a.ended_at IS NULL
     ORDER BY a.machine_id, a.slot_number`
  );
}

export function listAssignmentHistory(
  machineId?: number
): Array<PkSkuAssignment & { set_name: string }> {
  if (machineId !== undefined) {
    return all(
      `SELECT a.*, p.set_name
       FROM pk_sku_assignments a JOIN pk_products p ON p.id = a.product_id
       WHERE a.machine_id = ?
       ORDER BY a.slot_number, a.assigned_at`,
      machineId
    );
  }
  return all(
    `SELECT a.*, p.set_name
     FROM pk_sku_assignments a JOIN pk_products p ON p.id = a.product_id
     ORDER BY a.machine_id, a.slot_number, a.assigned_at`
  );
}

export function getActiveAssignmentForSlot(
  machineId: number,
  slotNumber: number
): (PkSkuAssignment & { set_name: string }) | undefined {
  return get(
    `SELECT a.*, p.set_name
     FROM pk_sku_assignments a JOIN pk_products p ON p.id = a.product_id
     WHERE a.machine_id = ? AND a.slot_number = ? AND a.ended_at IS NULL`,
    machineId,
    slotNumber
  );
}

/** Rotation/price-change entry point: ends any active row for (machine_id, slot_number)
 *  then appends the new one, atomically. */
export function reassignSku(input: NewSkuAssignment): number {
  return immediate(() => {
    const active = get<{ id: number }>(
      `SELECT id FROM pk_sku_assignments WHERE machine_id = ? AND slot_number = ? AND ended_at IS NULL`,
      input.machine_id,
      input.slot_number
    );
    if (active) endSkuAssignment(active.id, input.assigned_at);
    return insertSkuAssignment(input);
  });
}

// ---- pk_stock_events ----

export function insertStockEvent(input: NewStockEvent): number {
  assertEnum(input.event, STOCK_EVENT_TYPES, "stock event");
  assertInt(input.qty_delta, "qty_delta");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT INTO pk_stock_events (machine_id, slot_number, event, qty_delta, lot_id, at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.machine_id,
        input.slot_number,
        input.event,
        input.qty_delta,
        input.lot_id ?? null,
        input.at ?? nowIso(),
        input.note ?? null
      );
    return Number(res.lastInsertRowid);
  });
}

export function listStockEvents(machineId: number, slotNumber: number): PkStockEvent[] {
  return all<PkStockEvent>(
    `SELECT * FROM pk_stock_events WHERE machine_id = ? AND slot_number = ?
     ORDER BY at, id`,
    machineId,
    slotNumber
  );
}

/**
 * Current stock = baseline from the last audit_count (absolute count in qty_delta)
 * + Σ refill/shrink_adjust deltas after it − sales after it. No audit yet →
 * baseline 0 over the full history.
 */
export function currentStockForSlot(machineId: number, slotNumber: number): number {
  const audit = get<PkStockEvent>(
    `SELECT * FROM pk_stock_events
     WHERE machine_id = ? AND slot_number = ? AND event = 'audit_count'
     ORDER BY at DESC, id DESC LIMIT 1`,
    machineId,
    slotNumber
  );
  if (!audit) {
    const deltas = get<{ s: number }>(
      `SELECT COALESCE(SUM(qty_delta), 0) AS s FROM pk_stock_events
       WHERE machine_id = ? AND slot_number = ? AND event != 'audit_count'`,
      machineId,
      slotNumber
    )!.s;
    const sold = get<{ s: number }>(
      `SELECT COALESCE(SUM(qty), 0) AS s FROM pk_sales
       WHERE machine_id = ? AND slot_number = ?`,
      machineId,
      slotNumber
    )!.s;
    return deltas - sold;
  }
  const deltas = get<{ s: number }>(
    `SELECT COALESCE(SUM(qty_delta), 0) AS s FROM pk_stock_events
     WHERE machine_id = ? AND slot_number = ? AND event != 'audit_count'
       AND (at > ? OR (at = ? AND id > ?))`,
    machineId,
    slotNumber,
    audit.at,
    audit.at,
    audit.id
  )!.s;
  const sold = get<{ s: number }>(
    `SELECT COALESCE(SUM(qty), 0) AS s FROM pk_sales
     WHERE machine_id = ? AND slot_number = ? AND sold_at > ?`,
    machineId,
    slotNumber,
    audit.at
  )!.s;
  return audit.qty_delta + deltas - sold;
}

// ---- pk_sales ----

export function insertSale(input: NewSale): { id: number | null; inserted: boolean } {
  assertEnum(input.source, SALE_SOURCES, "sale source");
  assertInt(input.qty, "qty");
  assertInt(input.unit_price_cents, "unit_price_cents");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT OR IGNORE INTO pk_sales
           (machine_id, slot_number, product_id, qty, unit_price_cents, sold_at, source, external_txn_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.machine_id,
        input.slot_number,
        input.product_id,
        input.qty,
        input.unit_price_cents,
        input.sold_at,
        input.source,
        (input.external_txn_id ?? "").trim()
      );
    return res.changes === 1
      ? { id: Number(res.lastInsertRowid), inserted: true }
      : { id: null, inserted: false };
  });
}

export function listRecentSales(limit = 50): Array<PkSale & { set_name: string }> {
  return all(
    `SELECT s.*, p.set_name
     FROM pk_sales s JOIN pk_products p ON p.id = s.product_id
     ORDER BY s.sold_at DESC, s.id DESC LIMIT ?`,
    limit
  );
}

export function listSalesFiltered(
  opts: { machineId?: number; since?: string; limit?: number } = {}
): Array<PkSale & { set_name: string }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.machineId !== undefined) {
    clauses.push("s.machine_id = ?");
    params.push(opts.machineId);
  }
  if (opts.since) {
    clauses.push("s.sold_at >= ?");
    params.push(opts.since);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 50);
  return all(
    `SELECT s.*, p.set_name
     FROM pk_sales s JOIN pk_products p ON p.id = s.product_id
     ${where}
     ORDER BY s.sold_at DESC, s.id DESC LIMIT ?`,
    ...params
  );
}

/**
 * Even day-by-day attribution of a bulk qty across [since_ts's date, now's date]
 * inclusive (both truncated to UTC calendar day). Remainder goes to the most
 * recent (last) day. since_ts == now's date collapses to a single day.
 */
export function computeDayAttribution(
  qty: number,
  sinceIso: string,
  nowIso_: string
): Array<{ date: string; qty: number }> {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`qty must be a positive integer, got ${String(qty)}`);
  }
  const sinceDate = sinceIso.slice(0, 10);
  const nowDate = nowIso_.slice(0, 10);
  const sinceMs = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const nowMs = new Date(`${nowDate}T00:00:00.000Z`).getTime();
  if (Number.isNaN(sinceMs)) throw new Error(`bad since_ts: ${sinceIso}`);
  if (Number.isNaN(nowMs)) throw new Error(`bad now: ${nowIso_}`);
  if (nowMs < sinceMs) throw new Error(`since_ts (${sinceIso}) is after now (${nowIso_})`);
  const dayMs = 24 * 60 * 60 * 1000;
  const dayCount = Math.round((nowMs - sinceMs) / dayMs) + 1;
  const base = Math.floor(qty / dayCount);
  const remainder = qty - base * dayCount;
  const days: Array<{ date: string; qty: number }> = [];
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(sinceMs + i * dayMs).toISOString().slice(0, 10);
    const isLast = i === dayCount - 1;
    days.push({ date, qty: base + (isLast ? remainder : 0) });
  }
  return days;
}

export interface QuickBulkSaleInput {
  machine_id: number;
  slot_number: number;
  qty: number;
  since_ts: string;
  now?: string;
}

/** "Sold N of slot X since <ts>" quick entry: attributes qty across days, one
 *  pk_sales row per day (skipping zero-qty days), unit_price from the active
 *  assignment, source 'manual'. */
export function quickBulkSale(input: QuickBulkSaleInput): {
  product_id: number;
  unit_price_cents: number;
  rows: Array<{ id: number; sold_at: string; qty: number }>;
} {
  return immediate(() => {
    const assignment = getActiveAssignmentForSlot(input.machine_id, input.slot_number);
    if (!assignment) {
      throw new Error(
        `no active sku assignment for machine ${input.machine_id} slot ${input.slot_number}`
      );
    }
    const now = input.now ?? nowIso();
    const attribution = computeDayAttribution(input.qty, input.since_ts, now);
    const rows = attribution
      .filter((d) => d.qty > 0)
      .map((d) => {
        const sold_at = `${d.date}T12:00:00.000Z`;
        const res = insertSale({
          machine_id: input.machine_id,
          slot_number: input.slot_number,
          product_id: assignment.product_id,
          qty: d.qty,
          unit_price_cents: assignment.price_cents,
          sold_at,
          source: "manual",
        });
        return { id: res.id!, sold_at, qty: d.qty };
      });
    return { product_id: assignment.product_id, unit_price_cents: assignment.price_cents, rows };
  });
}

// ---- pk_recommendations ----

export function insertRecommendation(input: NewRecommendation): number {
  assertEnum(input.rule, RECOMMENDATION_RULES, "recommendation rule");
  if (input.severity) assertEnum(input.severity, RECOMMENDATION_SEVERITIES, "severity");
  return immediate(() => {
    const res = getDb()
      .prepare(
        `INSERT INTO pk_recommendations (rule, machine_id, slot_number, payload_json, severity)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.rule,
        input.machine_id ?? null,
        input.slot_number ?? null,
        JSON.stringify(input.payload ?? {}),
        input.severity ?? "info"
      );
    return Number(res.lastInsertRowid);
  });
}

export function listOpenRecommendations(): PkRecommendation[] {
  return all<PkRecommendation>(
    `SELECT * FROM pk_recommendations WHERE status = 'open' ORDER BY created_at DESC, id DESC`
  );
}

export interface RecommendationFilter {
  status?: string;
  rule?: string;
  machineId?: number;
  limit?: number;
}

export function listRecommendationsFiltered(opts: RecommendationFilter = {}): PkRecommendation[] {
  if (opts.status !== undefined) {
    assertEnum(opts.status, RECOMMENDATION_STATUSES, "recommendation status");
  }
  if (opts.rule !== undefined) assertEnum(opts.rule, RECOMMENDATION_RULES, "recommendation rule");
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.rule) {
    clauses.push("rule = ?");
    params.push(opts.rule);
  }
  if (opts.machineId !== undefined) {
    clauses.push("machine_id = ?");
    params.push(opts.machineId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 100);
  return all<PkRecommendation>(
    `SELECT * FROM pk_recommendations ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...params
  );
}

// ---- pk_import_receipts ----

export function getImportReceipt(sha256: string): PkImportReceipt | undefined {
  return get<PkImportReceipt>(`SELECT * FROM pk_import_receipts WHERE sha256 = ?`, sha256);
}

export function insertImportReceipt(input: NewImportReceipt): PkImportReceipt {
  return immediate(() => {
    getDb()
      .prepare(
        `INSERT INTO pk_import_receipts (sha256, filename, kind, row_count) VALUES (?, ?, ?, ?)`
      )
      .run(input.sha256, input.filename, input.kind, input.row_count);
    return getImportReceipt(input.sha256)!;
  });
}

// ---- pk_config ----

export function getConfig(key: string): string | undefined {
  return get<{ v: string }>(`SELECT v FROM pk_config WHERE k = ?`, key)?.v;
}

export function listConfig(): Array<{ k: string; v: string; updated_at: string }> {
  return all(`SELECT * FROM pk_config ORDER BY k`);
}

export function getConfigInt(key: string): number {
  const raw = getConfig(key);
  if (raw === undefined) throw new Error(`pk_config missing key: ${key}`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`pk_config key ${key} is not numeric: ${raw}`);
  return n;
}

export function setConfig(key: string, value: string | number): void {
  immediate(() => {
    getDb()
      .prepare(
        `INSERT INTO pk_config (k, v, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
      )
      .run(key, String(value), nowIso());
  });
}
