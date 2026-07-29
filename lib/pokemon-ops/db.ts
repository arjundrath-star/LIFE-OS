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
  type ObservationSource,
  type NewImportReceipt,
  type NewPriceObservation,
  type NewProduct,
  type NewPurchaseLot,
  type PurchaseLotPatch,
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

export function getMachine(id: number): Machine | undefined {
  return get<Machine>(`SELECT * FROM machines WHERE id = ?`, id);
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
): { id: number | null; inserted: boolean; updated: boolean } {
  assertEnum(input.source, OBSERVATION_SOURCES, "observation source");
  assertDate(input.observed_date, "observed_date");
  assertInt(input.price_per_pack_cents, "price_per_pack_cents");
  const values = {
    lotSize: input.lot_size ?? null,
    totalCostCents: input.total_cost_cents ?? null,
    includesShipping: input.includes_shipping ?? null,
    includesTax: input.includes_tax ?? null,
    listingRef: (input.listing_ref ?? "").trim(),
    quantityAvailable: input.quantity_available ?? null,
    notes: input.notes ?? null,
  };
  return immediate(() => {
    const db = getDb();
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO pk_price_observations
           (observed_date, source, product_id, price_per_pack_cents, lot_size,
            total_cost_cents, includes_shipping, includes_tax, listing_ref,
            quantity_available, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(
        input.observed_date,
        input.source,
        input.product_id,
        input.price_per_pack_cents,
        values.lotSize,
        values.totalCostCents,
        values.includesShipping,
        values.includesTax,
        values.listingRef,
        values.quantityAvailable,
        values.notes
      );
    if (res.changes === 1) {
      return { id: Number(res.lastInsertRowid), inserted: true, updated: false };
    }

    const existing = db.prepare(
      `SELECT id, price_per_pack_cents, lot_size, total_cost_cents,
              includes_shipping, includes_tax, quantity_available, notes
         FROM pk_price_observations
        WHERE source=? AND listing_ref=? AND observed_date=? AND product_id=?`
    ).get(input.source, values.listingRef, input.observed_date, input.product_id) as {
      id: number;
      price_per_pack_cents: number;
      lot_size: number | null;
      total_cost_cents: number | null;
      includes_shipping: number | null;
      includes_tax: number | null;
      quantity_available: number | null;
      notes: string | null;
    } | undefined;

    // Exact reruns dedupe forever. During the current UTC day only, benchmark
    // collectors may correct a stable listing in place so downstream buy levels
    // can reprice immediately; prior dated observations remain immutable.
    const utcToday = new Date().toISOString().slice(0, 10);
    const mutableCurrentBenchmark = input.observed_date === utcToday
      && (input.source === "tcgplayer" || input.source === "carddistro");
    const changed = existing && (
      existing.price_per_pack_cents !== input.price_per_pack_cents
      || existing.lot_size !== values.lotSize
      || existing.total_cost_cents !== values.totalCostCents
      || existing.includes_shipping !== values.includesShipping
      || existing.includes_tax !== values.includesTax
      || existing.quantity_available !== values.quantityAvailable
      || existing.notes !== values.notes
    );
    if (existing && mutableCurrentBenchmark && changed) {
      db.prepare(
        `UPDATE pk_price_observations
            SET price_per_pack_cents=?, lot_size=?, total_cost_cents=?,
                includes_shipping=?, includes_tax=?, quantity_available=?, notes=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=?`
      ).run(
        input.price_per_pack_cents,
        values.lotSize,
        values.totalCostCents,
        values.includesShipping,
        values.includesTax,
        values.quantityAvailable,
        values.notes,
        existing.id,
      );
      return { id: existing.id, inserted: false, updated: true };
    }
    return { id: null, inserted: false, updated: false };
  });
}

export function latestBenchmarkForProduct(productId: number): PkPriceObservation | undefined {
  return get<PkPriceObservation>(
    `SELECT * FROM pk_v_benchmark_current WHERE product_id = ?`,
    productId
  );
}

/** External market benchmark eligible on a given date. TCGplayer market is
 * primary; eBay sold is used only when no TCGplayer observation exists for the
 * product on or before that date. Supplier quotes and active listings never
 * define benchmark value. */
export function benchmarkForProductAtDate(
  productId: number,
  onOrBeforeDate: string
): PkPriceObservation | undefined {
  assertDate(onOrBeforeDate, "benchmark date");
  return get<PkPriceObservation>(
    `SELECT *
     FROM pk_price_observations
     WHERE product_id = ?
       AND observed_date <= ?
       AND source IN ('tcgplayer', 'ebay_sold')
     ORDER BY CASE source WHEN 'tcgplayer' THEN 0 ELSE 1 END,
              observed_date DESC, id DESC
     LIMIT 1`,
    productId,
    onOrBeforeDate
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
 * Computes landed_cost_per_pack_cents and snapshots the external market
 * benchmark eligible on the purchase date (TCGplayer primary, eBay sold
 * fallback). benchmark_delta_cents = landed − benchmark.
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
    const benchmark = benchmarkForProductAtDate(input.product_id, input.purchase_date);
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

/**
 * Corrects operator-entered purchase details while keeping all derived economics
 * in sync. Structural FIFO fields cannot move once the lot has fed a machine
 * or its product has recorded sales; cost and notes remain correctable so an
 * operator can repair the accounting basis without orphaning historical units.
 */
export function updatePurchaseLotFields(id: number, patch: PurchaseLotPatch): PkPurchaseLot {
  assertInt(id, "purchase lot id");
  return immediate(() => {
    const current = getPurchaseLot(id);
    if (!current) throw new Error(`purchase lot ${id} not found`);

    const purchaseDate = patch.purchase_date ?? current.purchase_date;
    const source = patch.source ?? current.source;
    const productId = patch.product_id ?? current.product_id;
    const packCount = patch.pack_count ?? current.pack_count;
    const totalCost = patch.total_cost_cents ?? current.total_cost_cents;
    const status = patch.status ?? current.status;
    const notes = patch.notes === undefined ? current.notes : patch.notes;

    assertDate(purchaseDate, "purchase_date");
    assertEnum(source, OBSERVATION_SOURCES, "lot source");
    assertInt(productId, "product_id");
    assertInt(packCount, "pack_count");
    assertInt(totalCost, "total_cost_cents");
    assertEnum(status, LOT_STATUSES, "lot status");
    if (packCount <= 0) throw new Error(`pack_count must be > 0, got ${packCount}`);
    if (totalCost < 0) throw new Error(`total_cost_cents must be >= 0, got ${totalCost}`);
    if (!getProduct(productId)) throw new Error(`product ${productId} not found`);

    const allocated = get<{ qty: number }>(
      `SELECT COALESCE(SUM(qty_delta), 0) qty
       FROM pk_stock_events WHERE lot_id = ? AND event = 'refill' AND qty_delta > 0`,
      id
    )?.qty ?? 0;
    const structuralChange =
      productId !== current.product_id ||
      purchaseDate !== current.purchase_date ||
      packCount !== current.pack_count ||
      ((status === "in_transit") !== (current.status === "in_transit"));
    const currentProductSales = get<{ count: number }>(
      `SELECT COUNT(*) count FROM pk_sales WHERE product_id = ?`,
      current.product_id
    )?.count ?? 0;
    const destinationProductSales = productId === current.product_id
      ? currentProductSales
      : get<{ count: number }>(`SELECT COUNT(*) count FROM pk_sales WHERE product_id = ?`, productId)?.count ?? 0;
    if (structuralChange && (allocated > 0 || currentProductSales > 0 || destinationProductSales > 0)) {
      throw new Error("cannot change product, purchase date, pack count, or transit state after refill allocation or sales history exists");
    }

    const landed = Math.round(totalCost / packCount);
    const benchmarkIdentityChanged =
      productId !== current.product_id || purchaseDate !== current.purchase_date;
    const benchmarkPrice = benchmarkIdentityChanged
      ? benchmarkForProductAtDate(productId, purchaseDate)?.price_per_pack_cents ?? null
      : current.benchmark_price_cents;
    const observationId =
      productId !== current.product_id || purchaseDate !== current.purchase_date || source !== current.source
        ? null
        : current.observation_id;
    getDb().prepare(
      `UPDATE pk_purchase_lots
       SET purchase_date = ?, source = ?, product_id = ?, pack_count = ?,
           total_cost_cents = ?, landed_cost_per_pack_cents = ?,
           observation_id = ?, benchmark_price_cents = ?, benchmark_delta_cents = ?, status = ?, notes = ?
       WHERE id = ?`
    ).run(
      purchaseDate,
      source,
      productId,
      packCount,
      totalCost,
      landed,
      observationId,
      benchmarkPrice,
      benchmarkPrice === null ? null : landed - benchmarkPrice,
      status,
      notes,
      id
    );
    return getPurchaseLot(id)!;
  });
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

/**
 * Cheapest fresh (observed_date >= asOf − maxAgeDays, inclusive — same
 * exactly-N-days-old-still-fresh convention as rules.ts's refill_order),
 * actionable observation per product, newest FEED_LIMIT collapsed to one
 * row per product_id. Ties: lowest price wins; tie on price → most recent
 * observed_date, then highest id. TCGplayer/eBay sold are market indicators,
 * not buy offers; Carddistro remains excluded. Products with no fresh
 * actionable observation are simply absent (never a fake row).
 */
export interface BestFreshOffer {
  product_id: number;
  set_name: string;
  source: ObservationSource;
  observed_date: string;
  price_per_pack_cents: number;
  benchmark_price_cents: number | null;
}

export function listBestFreshOffers(asOf: string, maxAgeDays: number): BestFreshOffer[] {
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) throw new Error(`bad asOf: ${asOf}`);
  const cutoffDate = new Date(asOfMs - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  const rows = all<PkPriceObservation & { set_name: string }>(
    `SELECT o.*, p.set_name
     FROM pk_price_observations o
     JOIN pk_products p ON p.id = o.product_id
     WHERE o.source NOT IN ('carddistro', 'tcgplayer', 'ebay_sold')
       AND o.observed_date >= ?
     ORDER BY o.product_id, o.price_per_pack_cents ASC, o.observed_date DESC, o.id DESC`,
    cutoffDate
  );
  const seen = new Set<number>();
  const out: BestFreshOffer[] = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    const benchmark = latestBenchmarkForProduct(r.product_id);
    out.push({
      product_id: r.product_id,
      set_name: r.set_name,
      source: r.source,
      observed_date: r.observed_date,
      price_per_pack_cents: r.price_per_pack_cents,
      benchmark_price_cents: benchmark ? benchmark.price_per_pack_cents : null,
    });
  }
  return out.sort((a, b) => a.set_name.localeCompare(b.set_name));
}

/**
 * Sourcing alerts (Phase 5): unalerted actionable offers whose price beats the
 * product's current external market benchmark by more than
 * thresholdPct. Observations for a product with no benchmark yet are
 * excluded (nothing to compare against). Ordered by id ASC (insertion
 * order — first-seen, first-alerted, deterministic).
 */
export interface SourcingAlertCandidate extends PkPriceObservation {
  set_name: string;
  benchmark_price_cents: number;
  beats_pct: number;
}

export function listPendingSourcingAlerts(thresholdPct: number): SourcingAlertCandidate[] {
  return all<SourcingAlertCandidate>(
    `SELECT o.*, p.set_name,
            b.price_per_pack_cents AS benchmark_price_cents,
            (1.0 - (o.price_per_pack_cents * 1.0 / b.price_per_pack_cents)) * 100.0 AS beats_pct
     FROM pk_price_observations o
     JOIN pk_products p ON p.id = o.product_id
     JOIN pk_v_benchmark_current b ON b.product_id = o.product_id
     WHERE o.alerted_at IS NULL
       AND o.source NOT IN ('carddistro', 'tcgplayer', 'ebay_sold')
       AND o.price_per_pack_cents <= b.price_per_pack_cents * (1.0 - ? / 100.0)
     ORDER BY o.id`,
    thresholdPct
  );
}

/** Send-then-mark (Phase 5 alerts): only sets alerted_at if still NULL, so a
 *  retried mark call after a successful send is a no-op — idempotent. */
export function markObservationAlerted(id: number, at: string): void {
  immediate(() => {
    getDb()
      .prepare(`UPDATE pk_price_observations SET alerted_at = ? WHERE id = ? AND alerted_at IS NULL`)
      .run(at, id);
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

/** Phase 5 alerts: open, unalerted, actionable (severity action|urgent)
 *  recommendations. Ordered by id ASC (insertion order — first-opened,
 *  first-alerted, deterministic). info-severity rows never alert. */
export function listPendingActionRecommendations(): PkRecommendation[] {
  return all<PkRecommendation>(
    `SELECT * FROM pk_recommendations
     WHERE status = 'open' AND severity IN ('action','urgent') AND alerted_at IS NULL
     ORDER BY id`
  );
}

/** Send-then-mark (Phase 5 alerts): only sets alerted_at if still NULL, so a
 *  retried mark call after a successful send is a no-op — idempotent. */
export function markRecommendationAlerted(id: number, at: string): void {
  immediate(() => {
    getDb()
      .prepare(`UPDATE pk_recommendations SET alerted_at = ? WHERE id = ? AND alerted_at IS NULL`)
      .run(at, id);
  });
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

/** Ack/dismiss (or any status transition) from the dashboard. Enum-validated
 *  only, same shape as updateLotStatus — no rule-specific side effects here. */
export function updateRecommendationStatus(
  id: number,
  status: string
): PkRecommendation {
  assertEnum(status, RECOMMENDATION_STATUSES, "recommendation status");
  return immediate(() => {
    const res = getDb()
      .prepare(`UPDATE pk_recommendations SET status = ? WHERE id = ?`)
      .run(status, id);
    if (res.changes === 0) throw new Error(`recommendation ${id} not found`);
    return get<PkRecommendation>(`SELECT * FROM pk_recommendations WHERE id = ?`, id)!;
  });
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
