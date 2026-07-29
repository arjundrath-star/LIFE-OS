// Phase 1 pokemon-ops tests. Runs against an isolated temp DB: RATHWORKSPACE_DB
// is set BEFORE the db module loads (db/index.ts reads it at module load), so the
// data-layer modules are pulled in via dynamic import inside the tests.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-ops-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmpDir, "test.db");
const repoRoot = path.join(__dirname, "..");

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mods() {
  const ops = await import("../lib/pokemon-ops/db");
  const importer = await import("../lib/pokemon-ops/import-observations");
  const metrics = await import("../lib/pokemon-ops/metrics");
  const db = await import("../db");
  return { ops, importer, metrics, db };
}

let machineId = 0;
async function testMachine(): Promise<number> {
  const { ops } = await mods();
  if (!machineId) {
    machineId = ops.ensureMachine({
      name: "Test Machine",
      location: "Testville",
      status: "placing",
      note: "test fixture",
    });
  }
  return machineId;
}

test("migration seeds pk_config with confirmed values", async () => {
  const { ops, db } = await mods();
  db.getDb();
  assert.equal(ops.getConfigInt("refill_cycle_days"), 30);
  assert.equal(ops.getConfigInt("budget_cents"), 120000);
  assert.equal(ops.getConfigInt("alert_threshold_pct"), 15);
  assert.equal(ops.getConfigInt("min_margin_cents"), 1000);
  ops.setConfig("test_key", 7);
  assert.equal(ops.getConfigInt("test_key"), 7);
});

test("purchase lots can be corrected while landed cost and benchmark delta stay derived", async () => {
  const { ops } = await mods();
  const productId = ops.ensureProduct({
    set_name: "ZZ Editable Lot Set",
    form: "booster",
    tier: "mid",
  });
  const observationWrite = ops.insertPriceObservation({
    observed_date: "2026-01-20",
    source: "tcgplayer",
    product_id: productId,
    price_per_pack_cents: 1500,
    listing_ref: "editable-lot-benchmark",
  });
  assert.ok(observationWrite.id);
  const observationId = observationWrite.id;
  const lotId = ops.insertPurchaseLot({
    purchase_date: "2026-01-21",
    source: "other",
    product_id: productId,
    pack_count: 40,
    total_cost_cents: 54634,
    observation_id: observationId,
    status: "received",
    notes: "original allocation",
  });
  ops.insertPriceObservation({
    observed_date: "2026-01-21",
    source: "tcgplayer",
    product_id: productId,
    price_per_pack_cents: 1600,
    listing_ref: "later-backdated-market-observation",
  });

  const corrected = ops.updatePurchaseLotFields(lotId, {
    pack_count: 40,
    total_cost_cents: 56000,
    status: "received",
    notes: "corrected to $14 per pack",
  });

  assert.equal(corrected.total_cost_cents, 56000);
  assert.equal(corrected.landed_cost_per_pack_cents, 1400);
  assert.equal(corrected.benchmark_price_cents, 1500);
  assert.equal(corrected.benchmark_delta_cents, -100);
  assert.equal(corrected.notes, "corrected to $14 per pack");
  assert.equal(corrected.observation_id, observationId);

  const reclassified = ops.updatePurchaseLotFields(lotId, { source: "target" });
  assert.equal(reclassified.observation_id, null);
});

test("purchase lot structural edits cannot rewrite FIFO history after sales", async () => {
  const { ops } = await mods();
  const mId = await testMachine();
  const productId = ops.ensureProduct({ set_name: "ZZZ Historical Guard Set", form: "booster", tier: "mid" });
  const otherProductId = ops.ensureProduct({ set_name: "ZZZ Historical Guard Destination", form: "booster", tier: "mid" });
  const lotId = ops.insertPurchaseLot({
    purchase_date: "2025-01-01",
    source: "other",
    product_id: productId,
    pack_count: 10,
    total_cost_cents: 10000,
    status: "received",
  });
  ops.insertSale({
    machine_id: mId,
    slot_number: 9,
    product_id: productId,
    qty: 2,
    unit_price_cents: 1500,
    sold_at: "2025-01-02T00:00:00.000Z",
    source: "manual",
  });

  assert.throws(() => ops.updatePurchaseLotFields(lotId, { product_id: otherProductId }), /sales history exists/);
  assert.throws(() => ops.updatePurchaseLotFields(lotId, { pack_count: 9 }), /sales history exists/);
  assert.throws(() => ops.updatePurchaseLotFields(lotId, { purchase_date: "2025-01-03" }), /sales history exists/);
  assert.throws(() => ops.updatePurchaseLotFields(lotId, { status: "in_transit" }), /sales history exists/);
  const accountingCorrection = ops.updatePurchaseLotFields(lotId, { total_cost_cents: 11000, notes: "basis corrected" });
  assert.equal(accountingCorrection.landed_cost_per_pack_cents, 1100);
});

test("0012 backfills legacy lot snapshots with date-eligible external benchmarks", () => {
  const migrationDbPath = path.join(tmpDir, "external-benchmark-migration.db");
  const raw = new Database(migrationDbPath);
  try {
    raw.exec(fs.readFileSync(path.join(repoRoot, "db/migrations/0011_pokemon_ops.sql"), "utf8"));
    raw.exec(`
      INSERT INTO pk_products (set_name, display_name) VALUES ('Legacy Set', 'Legacy Set');
      INSERT INTO pk_price_observations
        (observed_date, source, product_id, price_per_pack_cents, listing_ref)
      VALUES
        ('2026-07-01', 'carddistro', 1, 1000, 'mentor'),
        ('2026-07-02', 'ebay_sold', 1, 900, 'sold-old'),
        ('2026-07-04', 'tcgplayer', 1, 1100, 'tcg-old'),
        ('2026-07-09', 'ebay_sold', 1, 700, 'sold-new'),
        ('2026-07-10', 'tcgplayer', 1, 1300, 'tcg-new');
      INSERT INTO pk_purchase_lots
        (purchase_date, source, product_id, pack_count, total_cost_cents,
         landed_cost_per_pack_cents, benchmark_price_cents, benchmark_delta_cents)
      VALUES
        ('2026-06-30', 'target', 1, 2, 1600, 800, 1000, -200),
        ('2026-07-03', 'target', 1, 2, 1600, 800, 1000, -200),
        ('2026-07-05', 'target', 1, 2, 2000, 1000, 1000, 0);
    `);

    raw.exec(fs.readFileSync(path.join(repoRoot, "db/migrations/0012_pokemon_ops_external_benchmark.sql"), "utf8"));

    assert.deepEqual(
      raw.prepare(
        `SELECT purchase_date, benchmark_price_cents, benchmark_delta_cents
         FROM pk_purchase_lots ORDER BY purchase_date`
      ).all(),
      [
        { purchase_date: "2026-06-30", benchmark_price_cents: null, benchmark_delta_cents: null },
        { purchase_date: "2026-07-03", benchmark_price_cents: 900, benchmark_delta_cents: -100 },
        { purchase_date: "2026-07-05", benchmark_price_cents: 1100, benchmark_delta_cents: -100 },
      ]
    );
    assert.deepEqual(
      raw.prepare(`SELECT source, price_per_pack_cents FROM pk_v_benchmark_current`).get(),
      { source: "tcgplayer", price_per_pack_cents: 1300 }
    );
  } finally {
    raw.close();
  }
});

test("round-trip inserts on every table", async () => {
  const { ops } = await mods();
  const mId = await testMachine();

  const productId = ops.insertProduct({
    set_name: "RT Set",
    form: "booster",
    tier: "mid",
    reprint_status: "announced",
    release_date: "2026-08-01",
  });
  const product = ops.getProductBySetName("RT Set");
  assert.ok(product);
  assert.equal(product.id, productId);
  assert.equal(product.display_name, "RT Set");
  assert.equal(product.tier, "mid");
  assert.equal(product.reprint_status, "announced");
  assert.equal(product.active, 1);
  assert.equal(ops.ensureProduct({ set_name: "RT Set", form: "booster", tier: "mid" }), productId);

  const obs = ops.insertPriceObservation({
    observed_date: "2026-07-01",
    source: "carddistro",
    product_id: productId,
    price_per_pack_cents: 1000,
    lot_size: 10,
    total_cost_cents: 10000,
    includes_shipping: 1,
    includes_tax: 0,
    listing_ref: "https://example.test/lot",
    quantity_available: 3,
    notes: "round trip",
  });
  assert.equal(obs.inserted, true);
  const obsRow = ops.listObservationsForProduct(productId)[0];
  assert.equal(obsRow.price_per_pack_cents, 1000);
  assert.equal(obsRow.listing_ref, "https://example.test/lot");
  assert.equal(obsRow.includes_shipping, 1);
  assert.equal(obsRow.includes_tax, 0);

  ops.insertPriceObservation({
    observed_date: "2026-07-03",
    source: "tcgplayer",
    product_id: productId,
    price_per_pack_cents: 1200,
    listing_ref: "tcg-market-roundtrip",
  });

  const lotId = ops.insertPurchaseLot({
    purchase_date: "2026-07-05",
    source: "ebay_sold",
    product_id: productId,
    pack_count: 4,
    total_cost_cents: 3600,
    observation_id: obs.id,
    status: "received",
    notes: "lot round trip",
  });
  const lot = ops.getPurchaseLot(lotId);
  assert.ok(lot);
  assert.equal(lot.landed_cost_per_pack_cents, 900);
  assert.equal(lot.benchmark_price_cents, 1200);
  assert.equal(lot.benchmark_delta_cents, -300);
  assert.equal(lot.status, "received");
  assert.equal(ops.listPurchaseLots()[0].set_name, "RT Set");

  const assignmentId = ops.insertSkuAssignment({
    machine_id: mId,
    slot_number: 1,
    product_id: productId,
    price_cents: 1500,
    capacity: 15,
    note: "cycle one",
  });
  assert.equal(ops.listActiveAssignments(mId).length, 1);
  ops.endSkuAssignment(assignmentId);
  assert.equal(ops.listActiveAssignments(mId).length, 0);
  assert.throws(() => ops.endSkuAssignment(assignmentId), /already ended/);

  const eventId = ops.insertStockEvent({
    machine_id: mId,
    slot_number: 1,
    event: "refill",
    qty_delta: 15,
    lot_id: lotId,
    at: "2026-07-06T00:00:00.000Z",
    note: "initial fill",
  });
  const events = ops.listStockEvents(mId, 1);
  assert.equal(events[events.length - 1].id, eventId);
  assert.equal(events[events.length - 1].lot_id, lotId);

  const sale = ops.insertSale({
    machine_id: mId,
    slot_number: 1,
    product_id: productId,
    qty: 1,
    unit_price_cents: 1500,
    sold_at: "2026-07-07T00:00:00.000Z",
    source: "manual",
  });
  assert.equal(sale.inserted, true);
  assert.equal(ops.listRecentSales(1)[0].external_txn_id, "");

  const recId = ops.insertRecommendation({
    rule: "price_raise",
    machine_id: mId,
    slot_number: 1,
    payload: { to_cents: 1700 },
    severity: "action",
  });
  const rec = ops.listOpenRecommendations().find((r) => r.id === recId);
  assert.ok(rec);
  assert.equal(rec.status, "open");
  assert.deepEqual(JSON.parse(rec.payload_json), { to_cents: 1700 });

  const receipt = ops.insertImportReceipt({
    sha256: "a".repeat(64),
    filename: "roundtrip.csv",
    kind: "carddistro",
    row_count: 2,
  });
  assert.equal(receipt.row_count, 2);
  assert.equal(ops.getImportReceipt("a".repeat(64))!.filename, "roundtrip.csv");
});

test("stock math: audit_count resets the baseline, deltas and sales apply after it", async () => {
  const { ops } = await mods();
  const mId = await testMachine();
  const productId = ops.ensureProduct({ set_name: "Stock Set", form: "booster", tier: "entry" });
  const slot = 2;
  const sell = (qty: number, soldAt: string) =>
    ops.insertSale({
      machine_id: mId,
      slot_number: slot,
      product_id: productId,
      qty,
      unit_price_cents: 1200,
      sold_at: soldAt,
      source: "manual",
    });

  // Pre-audit noise: must be superseded by the audit baseline.
  ops.insertStockEvent({ machine_id: mId, slot_number: slot, event: "refill", qty_delta: 50, at: "2026-07-01T00:00:00.000Z" });
  sell(2, "2026-07-02T00:00:00.000Z");
  // Audit carries the absolute count in qty_delta and resets the baseline.
  ops.insertStockEvent({ machine_id: mId, slot_number: slot, event: "audit_count", qty_delta: 120, at: "2026-07-03T00:00:00.000Z" });
  ops.insertStockEvent({ machine_id: mId, slot_number: slot, event: "refill", qty_delta: 30, at: "2026-07-04T00:00:00.000Z" });
  ops.insertStockEvent({ machine_id: mId, slot_number: slot, event: "shrink_adjust", qty_delta: -2, at: "2026-07-05T00:00:00.000Z" });
  sell(5, "2026-07-06T00:00:00.000Z");
  assert.equal(ops.currentStockForSlot(mId, slot), 120 + 30 - 2 - 5);

  // A newer audit resets again.
  ops.insertStockEvent({ machine_id: mId, slot_number: slot, event: "audit_count", qty_delta: 100, at: "2026-07-07T00:00:00.000Z" });
  assert.equal(ops.currentStockForSlot(mId, slot), 100);

  // No audit yet: baseline 0 over full history.
  ops.insertStockEvent({ machine_id: mId, slot_number: 3, event: "refill", qty_delta: 15, at: "2026-07-01T00:00:00.000Z" });
  ops.insertSale({
    machine_id: mId,
    slot_number: 3,
    product_id: productId,
    qty: 4,
    unit_price_cents: 1200,
    sold_at: "2026-07-02T00:00:00.000Z",
    source: "manual",
  });
  assert.equal(ops.currentStockForSlot(mId, 3), 11);
});

test("external benchmark prefers latest TCGplayer market, then falls back to eBay sold", async () => {
  const { ops, metrics } = await mods();
  const productId = ops.ensureProduct({ set_name: "Bench Set", form: "booster", tier: "premium" });
  ops.insertPriceObservation({ observed_date: "2026-07-01", source: "carddistro", product_id: productId, price_per_pack_cents: 111 });
  ops.insertPriceObservation({ observed_date: "2026-07-02", source: "ebay_sold", product_id: productId, price_per_pack_cents: 222 });
  // Actionable offers and supplier quotes never define the benchmark.
  ops.insertPriceObservation({ observed_date: "2026-07-12", source: "ebay_active", product_id: productId, price_per_pack_cents: 999 });
  let benchmark = ops.latestBenchmarkForProduct(productId);
  assert.ok(benchmark);
  assert.equal(benchmark.price_per_pack_cents, 222);
  assert.equal(benchmark.source, "ebay_sold");

  // Once any TCGplayer market observation exists, it is primary even when an
  // eBay sold observation is newer. Same-date TCGplayer ties use highest id.
  ops.insertPriceObservation({ observed_date: "2026-07-03", source: "tcgplayer", product_id: productId, price_per_pack_cents: 333 });
  ops.insertPriceObservation({ observed_date: "2026-07-10", source: "ebay_sold", product_id: productId, price_per_pack_cents: 444, listing_ref: "sold-newer" });
  ops.insertPriceObservation({ observed_date: "2026-07-03", source: "tcgplayer", product_id: productId, price_per_pack_cents: 555, listing_ref: "tcg-tie" });
  benchmark = ops.latestBenchmarkForProduct(productId);
  assert.equal(benchmark!.price_per_pack_cents, 555);
  assert.equal(benchmark!.source, "tcgplayer");
  assert.equal(ops.listBenchmarks().filter((b) => b.product_id === productId).length, 1);

  const series = metrics.benchmarkDeltaSeries(productId);
  const ebayFallbackPoint = series.find((p) => p.source === "ebay_sold" && p.observed_date === "2026-07-02")!;
  assert.equal(ebayFallbackPoint.benchmark_price_cents, 222);
  const latestOfferPoint = series.find((p) => p.source === "ebay_active")!;
  assert.equal(latestOfferPoint.benchmark_price_cents, 555);
  assert.equal(latestOfferPoint.benchmark_delta_cents, 444);
});

test("purchase snapshots use the eligible external benchmark at or before purchase date", async () => {
  const { ops } = await mods();
  const productId = ops.ensureProduct({ set_name: "Dated Bench Set", form: "booster", tier: "mid" });
  ops.insertPriceObservation({ observed_date: "2026-07-01", source: "ebay_sold", product_id: productId, price_per_pack_cents: 900 });
  ops.insertPriceObservation({ observed_date: "2026-07-04", source: "tcgplayer", product_id: productId, price_per_pack_cents: 1100 });
  ops.insertPriceObservation({ observed_date: "2026-07-10", source: "tcgplayer", product_id: productId, price_per_pack_cents: 1300, listing_ref: "future" });

  const fallbackLot = ops.getPurchaseLot(ops.insertPurchaseLot({
    purchase_date: "2026-07-03", source: "target", product_id: productId,
    pack_count: 2, total_cost_cents: 1600,
  }))!;
  assert.equal(fallbackLot.benchmark_price_cents, 900);
  assert.equal(fallbackLot.benchmark_delta_cents, -100);

  const tcgLot = ops.getPurchaseLot(ops.insertPurchaseLot({
    purchase_date: "2026-07-05", source: "target", product_id: productId,
    pack_count: 2, total_cost_cents: 2000,
  }))!;
  assert.equal(tcgLot.benchmark_price_cents, 1100);
  assert.equal(tcgLot.benchmark_delta_cents, -100);
});

test("market indicators and carddistro quotes are not actionable sourcing offers", async () => {
  const { ops } = await mods();
  const productId = ops.ensureProduct({ set_name: "Offer Separation Set", form: "booster", tier: "entry" });
  ops.insertPriceObservation({ observed_date: "2026-07-15", source: "tcgplayer", product_id: productId, price_per_pack_cents: 1000 });
  ops.insertPriceObservation({ observed_date: "2026-07-16", source: "ebay_sold", product_id: productId, price_per_pack_cents: 500 });
  ops.insertPriceObservation({ observed_date: "2026-07-16", source: "carddistro", product_id: productId, price_per_pack_cents: 400 });
  ops.insertPriceObservation({ observed_date: "2026-07-16", source: "target", product_id: productId, price_per_pack_cents: 800 });

  const offers = ops.listBestFreshOffers("2026-07-17T00:00:00.000Z", 30);
  assert.equal(offers.find((o) => o.product_id === productId)?.source, "target");
  assert.deepEqual(
    ops.listPendingSourcingAlerts(15).filter((o) => o.product_id === productId).map((o) => o.source),
    ["target"]
  );
});

test("observation dedupe: '' listing_ref dedupes; NULL would silently not (regression demo)", async () => {
  const { ops, db } = await mods();
  const productId = ops.ensureProduct({ set_name: "Dedupe Set", form: "booster", tier: "mid" });
  const input = {
    observed_date: "2026-07-15",
    source: "carddistro" as const,
    product_id: productId,
    price_per_pack_cents: 500,
  };
  assert.equal(ops.insertPriceObservation(input).inserted, true);
  assert.equal(ops.insertPriceObservation(input).inserted, false);
  const immutableCorrection = ops.insertPriceObservation({ ...input, price_per_pack_cents: 400 });
  assert.equal(immutableCorrection.updated, false);
  assert.equal(ops.listObservationsForProduct(productId).length, 1);
  assert.equal(ops.listObservationsForProduct(productId)[0].price_per_pack_cents, 500);

  const today = new Date().toISOString().slice(0, 10);
  const currentInput = {
    observed_date: today,
    source: "tcgplayer" as const,
    product_id: productId,
    price_per_pack_cents: 1000,
    listing_ref: "https://example.test/stable-market",
  };
  const currentFirst = ops.insertPriceObservation(currentInput);
  assert.equal(currentFirst.inserted, true);
  assert.equal(currentFirst.updated, false);
  assert.ok(currentFirst.id);
  const currentCorrection = ops.insertPriceObservation({ ...currentInput, price_per_pack_cents: 800 });
  assert.equal(currentCorrection.inserted, false);
  assert.equal(currentCorrection.updated, true);
  assert.equal(ops.insertPriceObservation({ ...currentInput, price_per_pack_cents: 800 }).updated, false);
  const currentRows = ops.listObservationsForProduct(productId).filter(
    (row) => row.observed_date === today && row.source === "tcgplayer",
  );
  assert.equal(currentRows.length, 1);
  assert.equal(currentRows[0].price_per_pack_cents, 800);

  // Why listing_ref is NOT NULL DEFAULT '': with a nullable column, SQLite treats
  // NULLs as distinct in UNIQUE — two identical rows both land and dedupe is dead.
  const raw = db.getDb();
  raw.exec(
    `CREATE TABLE IF NOT EXISTS null_unique_demo (
       source TEXT, listing_ref TEXT, observed_date TEXT, product_id INTEGER,
       UNIQUE(source, listing_ref, observed_date, product_id)
     )`
  );
  const insert = raw.prepare(
    `INSERT INTO null_unique_demo (source, listing_ref, observed_date, product_id) VALUES (?, NULL, ?, ?)`
  );
  insert.run("carddistro", "2026-07-15", productId);
  insert.run("carddistro", "2026-07-15", productId);
  const demoCount = raw
    .prepare(`SELECT COUNT(*) AS c FROM null_unique_demo`)
    .get() as { c: number };
  assert.equal(demoCount.c, 2);
});

test("sales dedupe: partial index catches lynx/sqs; manual '' rows never collide", async () => {
  const { ops } = await mods();
  const mId = await testMachine();
  const productId = ops.ensureProduct({ set_name: "Sales Set", form: "booster", tier: "entry" });
  const base = {
    machine_id: mId,
    slot_number: 4,
    product_id: productId,
    qty: 1,
    unit_price_cents: 1300,
  };
  assert.equal(
    ops.insertSale({ ...base, sold_at: "2026-07-10T10:00:00.000Z", source: "lynx", external_txn_id: "TX-1" }).inserted,
    true
  );
  assert.equal(
    ops.insertSale({ ...base, sold_at: "2026-07-10T10:00:00.000Z", source: "lynx", external_txn_id: "TX-1" }).inserted,
    false
  );
  // Manual rows carry '' — outside the partial index, so repeats are allowed.
  assert.equal(ops.insertSale({ ...base, sold_at: "2026-07-11T10:00:00.000Z", source: "manual" }).inserted, true);
  assert.equal(ops.insertSale({ ...base, sold_at: "2026-07-11T10:00:00.000Z", source: "manual" }).inserted, true);
  const rows = ops.listRecentSales(100).filter((s) => s.product_id === productId);
  assert.equal(rows.length, 3);
});

test("importer: exact USD→cents, receipt provenance, same-day A→B→A, and unknown-set rejection", async () => {
  const { ops, importer, db } = await mods();
  ops.ensureProduct({ set_name: "Importer Set", form: "booster", tier: "mid" });
  const header =
    "observed_date,source,set_name,form,price_per_pack_usd,lot_size,includes_shipping,includes_tax,listing_ref,notes";
  const csvPath = path.join(tmpDir, "importer.csv");
  fs.writeFileSync(
    csvPath,
    `${header}\n2026-07-16,carddistro,Importer Set,booster,12.41,,,,,unit test\n`
  );

  const first = importer.importCarddistroCsv(csvPath);
  assert.equal(first.imported, 1);
  assert.equal(first.updated, 0);
  assert.equal(first.skipped, 0);
  assert.equal(first.receipt.kind, "carddistro");
  assert.equal(first.receipt.row_count, 1);
  const productId = ops.getProductBySetName("Importer Set")!.id;
  assert.equal(ops.listObservationsForProduct(productId)[0].price_per_pack_cents, 1241);

  // Same bytes again dedupe at row level; the original provenance receipt is returned.
  const second = importer.importCarddistroCsv(csvPath);
  assert.equal(second.imported, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.receipt.sha256, first.receipt.sha256);
  assert.equal(second.receipt.imported_at, first.receipt.imported_at);
  assert.equal(ops.listObservationsForProduct(productId).length, 1);

  const today = new Date().toISOString().slice(0, 10);
  const currentPath = path.join(tmpDir, "importer-current.csv");
  fs.writeFileSync(
    currentPath,
    `${header}\n${today},carddistro,Importer Set,booster,13.00,,,,https://example.test/stable-supplier,current\n`
  );
  const currentFirst = importer.importCarddistroCsv(currentPath);
  assert.deepEqual(
    { imported: currentFirst.imported, updated: currentFirst.updated, skipped: currentFirst.skipped },
    { imported: 1, updated: 0, skipped: 0 },
  );
  fs.writeFileSync(
    currentPath,
    `${header}\n${today},carddistro,Importer Set,booster,10.00,,,,https://example.test/stable-supplier,current\n`
  );
  const currentChanged = importer.importCarddistroCsv(currentPath);
  assert.deepEqual(
    { imported: currentChanged.imported, updated: currentChanged.updated, skipped: currentChanged.skipped },
    { imported: 0, updated: 1, skipped: 0 },
  );
  const currentRows = ops.listObservationsForProduct(productId).filter(
    (row) => row.observed_date === today && row.source === "carddistro",
  );
  assert.equal(currentRows.length, 1);
  assert.equal(currentRows[0].price_per_pack_cents, 1000);

  // A genuine same-day return to the original payload must not be blocked just
  // because that payload's SHA receipt already exists (A→B→A regression).
  fs.writeFileSync(
    currentPath,
    `${header}\n${today},carddistro,Importer Set,booster,13.00,,,,https://example.test/stable-supplier,current\n`
  );
  const currentReverted = importer.importCarddistroCsv(currentPath);
  assert.deepEqual(
    { imported: currentReverted.imported, updated: currentReverted.updated, skipped: currentReverted.skipped },
    { imported: 0, updated: 1, skipped: 0 },
  );
  assert.equal(
    ops.listObservationsForProduct(productId).find(
      (row) => row.observed_date === today && row.source === "carddistro",
    )?.price_per_pack_cents,
    1300,
  );
  const { validateImportedBenchmarkRows } = await import("@/scripts/pokemon-benchmark-coverage");
  const revertedRows = importer.parseCarddistroCsv(fs.readFileSync(currentPath, "utf8"));
  assert.doesNotThrow(() => validateImportedBenchmarkRows(revertedRows, {
    source: "carddistro",
    observedDate: today,
    requireComplete: false,
  }));
  db.getDb().prepare(
    `UPDATE pk_price_observations SET includes_shipping=1
      WHERE product_id=? AND source='carddistro' AND observed_date=? AND listing_ref=?`,
  ).run(productId, today, "https://example.test/stable-supplier");
  assert.throws(
    () => validateImportedBenchmarkRows(revertedRows, {
      source: "carddistro",
      observedDate: today,
      requireComplete: false,
    }),
    /do not match collected CSV/,
  );
  db.getDb().prepare(
    `UPDATE pk_price_observations SET includes_shipping=NULL
      WHERE product_id=? AND source='carddistro' AND observed_date=? AND listing_ref=?`,
  ).run(productId, today, "https://example.test/stable-supplier");

  const badPath = path.join(tmpDir, "importer-bad.csv");
  fs.writeFileSync(
    badPath,
    `${header}\n2026-07-16,carddistro,Not A Real Set,booster,9.99,,,,,unit test\n`
  );
  assert.throws(() => importer.importCarddistroCsv(badPath), /unknown set name "Not A Real Set"/);
  assert.throws(() => importer.importCarddistroCsv(badPath), /valid set names: .*Importer Set/);

  assert.equal(importer.usdToCents("12.41"), 1241);
  assert.equal(importer.usdToCents("30.90"), 3090);
  assert.equal(importer.usdToCents("7.08"), 708);
  assert.throws(() => importer.usdToCents("abc"), /bad USD price/);
});

test("seed is idempotent: two runs leave identical row counts", () => {
  const seedDbPath = path.join(tmpDir, "seed.db");
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

  const counts = () => {
    const db = new Database(seedDbPath, { readonly: true });
    try {
      const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
      return {
        machines: one(`SELECT COUNT(*) AS c FROM machines WHERE name = 'Venue Alpha'`),
        products: one(`SELECT COUNT(*) AS c FROM pk_products`),
        observations: one(`SELECT COUNT(*) AS c FROM pk_price_observations`),
        receipts: one(`SELECT COUNT(*) AS c FROM pk_import_receipts`),
      };
    } finally {
      db.close();
    }
  };

  const runSeed = () =>
    spawnSync(tsxBin, ["scripts/pokemon-ops-seed.ts"], {
      cwd: repoRoot,
      env: { ...process.env, RATHWORKSPACE_DB: seedDbPath },
      encoding: "utf8",
    });

  const first = runSeed();
  assert.equal(first.status, 0, `first seed run failed: ${first.stderr}`);
  const afterFirst = counts();
  assert.deepEqual(afterFirst, { machines: 1, products: 16, observations: 15, receipts: 1 });

  const second = runSeed();
  assert.equal(second.status, 0, `second seed run failed: ${second.stderr}`);
  assert.deepEqual(counts(), afterFirst);
});

test("active inventory provenance uses only the latest post-assignment event and exact product lot", async () => {
  const {ops}=await mods(); const {pokemonOpsSnapshot}=await import("../lib/pokemon-ops/snapshot"); const machine=await testMachine();
  const productA=ops.ensureProduct({set_name:"Provenance A",display_name:"Provenance A",form:"booster",tier:"mid",reprint_status:"none"}); const productB=ops.ensureProduct({set_name:"Provenance B",display_name:"Provenance B",form:"booster",tier:"mid",reprint_status:"none"});
  const lotA=ops.insertPurchaseLot({purchase_date:"2026-07-01",source:"target",product_id:productA,pack_count:10,total_cost_cents:10000,status:"received"});
  ops.reassignSku({machine_id:machine,slot_number:987,product_id:productA,price_cents:2000,capacity:20,assigned_at:"2026-07-10T00:00:00Z"});
  ops.insertStockEvent({machine_id:machine,slot_number:987,event:"refill",qty_delta:10,lot_id:lotA,at:"2026-07-11T00:00:00Z"});
  ops.insertStockEvent({machine_id:machine,slot_number:987,event:"audit_count",qty_delta:9,at:"2026-07-12T00:00:00Z"});
  let slot=pokemonOpsSnapshot("2026-07-13T00:00:00Z").slots.find(s=>s.slot_number===987)!; assert.equal(slot.source_lot_id,null); assert.equal(slot.landed_cost_per_pack_cents,null);
  ops.reassignSku({machine_id:machine,slot_number:987,product_id:productB,price_cents:2200,capacity:20,assigned_at:"2026-07-14T00:00:00Z"});
  slot=pokemonOpsSnapshot("2026-07-15T00:00:00Z").slots.find(s=>s.slot_number===987)!; assert.equal(slot.product_id,productB); assert.equal(slot.source_lot_id,null);
});

test("general inventory reports unassigned on-hand units and honest cost and market values", async () => {
  const { ops } = await mods();
  const { pokemonOpsSnapshot } = await import("../lib/pokemon-ops/snapshot");
  const machine = await testMachine();
  const productId = ops.ensureProduct({
    set_name: "Warehouse Set",
    display_name: "Warehouse Set",
    form: "booster",
    tier: "mid",
    reprint_status: "none",
  });
  ops.insertPriceObservation({
    observed_date: "2026-07-18",
    source: "tcgplayer",
    product_id: productId,
    price_per_pack_cents: 900,
    listing_ref: "warehouse-market",
  });
  const receivedLot = ops.insertPurchaseLot({
    purchase_date: "2026-07-18",
    source: "target",
    product_id: productId,
    pack_count: 10,
    total_cost_cents: 5000,
    status: "received",
  });
  ops.insertPurchaseLot({
    purchase_date: "2026-07-19",
    source: "target",
    product_id: productId,
    pack_count: 5,
    total_cost_cents: 3000,
    status: "in_transit",
  });
  ops.insertPurchaseLot({
    purchase_date: "2026-07-17",
    source: "target",
    product_id: productId,
    pack_count: 4,
    total_cost_cents: 1600,
    status: "depleted",
  });
  ops.reassignSku({
    machine_id: machine,
    slot_number: 986,
    product_id: productId,
    price_cents: 1500,
    capacity: 20,
    assigned_at: "2026-07-18T00:00:00Z",
  });
  ops.insertStockEvent({
    machine_id: machine,
    slot_number: 986,
    event: "refill",
    qty_delta: 3,
    lot_id: receivedLot,
    at: "2026-07-19T00:00:00Z",
  });

  const snapshot = pokemonOpsSnapshot("2026-07-20T00:00:00Z");
  const row = snapshot.general_inventory.find((item) => item.product_id === productId)!;
  assert.deepEqual(row, {
    product_id: productId,
    set_name: "Warehouse Set",
    on_hand_units: 7,
    cost_value_cents: 3500,
    estimated_market_value_cents: 6300,
    market_price_per_pack_cents: 900,
    market_source: "tcgplayer",
    market_observed_date: "2026-07-18",
    in_transit_units: 5,
    in_transit_cost_cents: 3000,
  });
  assert.ok(snapshot.kpis.general_inventory_units >= 7);
  assert.ok(snapshot.kpis.general_inventory_cost_cents >= 3500);
  assert.ok(snapshot.kpis.in_transit_units >= 5);
});
