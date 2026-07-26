// Phase 2 ingest-layer unit tests: bulk lots/sales importers + quick-bulk day
// attribution math. Same temp-DB isolation pattern as tests/pokemon-ops.test.ts:
// RATHWORKSPACE_DB is set BEFORE the db module loads, so data-layer modules are
// pulled in via dynamic import inside the tests.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-ops-ingest-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmpDir, "test.db");

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mods() {
  const ops = await import("../lib/pokemon-ops/db");
  const importers = await import("../lib/pokemon-ops/importers");
  const db = await import("../db");
  return { ops, importers, db };
}

let machineId = 0;
async function testMachine(): Promise<number> {
  const { ops } = await mods();
  if (!machineId) {
    machineId = ops.ensureMachine({
      name: "Ingest Test Machine",
      location: "Testville",
      status: "placing",
      note: "test fixture",
    });
  }
  return machineId;
}

test("bulk lots importer: USD->cents, receipt-gated rerun, unknown set name is a hard error", async () => {
  const { ops, importers } = await mods();
  ops.ensureProduct({ set_name: "Lots Import Set", form: "booster", tier: "mid" });
  const header = "purchase_date,source,set_name,pack_count,total_cost_usd,observation_ref,status,notes";
  const csvPath = path.join(tmpDir, "lots.csv");
  fs.writeFileSync(
    csvPath,
    `${header}\n2026-07-05,ebay_sold,Lots Import Set,4,36.00,,received,lot import test\n`
  );

  const first = importers.importBulkLotsCsv(csvPath);
  assert.equal(first.imported, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.receipt.kind, "lots");
  assert.equal(first.receipt.row_count, 1);
  const productId = ops.getProductBySetName("Lots Import Set")!.id;
  const lots = ops.listPurchaseLots().filter((l) => l.product_id === productId);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].total_cost_cents, 3600);
  assert.equal(lots[0].landed_cost_per_pack_cents, 900);
  assert.equal(lots[0].status, "received");

  // Identical bytes again -> whole file skipped, prior receipt returned, no new lot.
  const second = importers.importBulkLotsCsv(csvPath);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.receipt.sha256, first.receipt.sha256);
  assert.equal(second.receipt.imported_at, first.receipt.imported_at);
  assert.equal(ops.listPurchaseLots().filter((l) => l.product_id === productId).length, 1);

  const badPath = path.join(tmpDir, "lots-bad.csv");
  fs.writeFileSync(badPath, `${header}\n2026-07-05,ebay_sold,Not A Real Set,4,36.00,,received,x\n`);
  assert.throws(() => importers.importBulkLotsCsv(badPath), /unknown set name "Not A Real Set"/);

  assert.equal(importers.usdToCents("36.00"), 3600);
  assert.equal(importers.usdToCents("9.99"), 999);
  assert.throws(() => importers.usdToCents("nope"), /bad USD amount/);
});

test("bulk sales importer: dedupe by (source, external_txn_id) for lynx/sqs rows", async () => {
  const { ops, importers } = await mods();
  const mId = await testMachine();
  ops.ensureProduct({ set_name: "Sales Import Set", form: "booster", tier: "entry" });
  const header = "sold_at,machine,slot_number,set_name,qty,unit_price_usd,source,external_txn_id";
  const row = "2026-07-10T10:00:00.000Z,Ingest Test Machine,5,Sales Import Set,1,13.00,lynx,TX-DUP-1";
  const csvPath = path.join(tmpDir, "sales.csv");
  // Two rows in the SAME file share an external_txn_id: only the first inserts.
  fs.writeFileSync(csvPath, `${header}\n${row}\n${row}\n`);

  const first = importers.importBulkSalesCsv(csvPath);
  assert.equal(first.imported, 1);
  assert.equal(first.skipped, 1);
  assert.equal(first.receipt.kind, "sales");
  assert.equal(first.receipt.row_count, 2);

  const productId = ops.getProductBySetName("Sales Import Set")!.id;
  const sales = ops.listRecentSales(100).filter((s) => s.product_id === productId);
  assert.equal(sales.length, 1);
  assert.equal(sales[0].unit_price_cents, 1300);
  assert.equal(sales[0].external_txn_id, "TX-DUP-1");

  // Whole-file rerun: receipt hit, no new/duplicate rows.
  const second = importers.importBulkSalesCsv(csvPath);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 2);
  assert.equal(second.receipt.sha256, first.receipt.sha256);
  assert.equal(ops.listRecentSales(100).filter((s) => s.product_id === productId).length, 1);

  const badPath = path.join(tmpDir, "sales-bad.csv");
  fs.writeFileSync(
    badPath,
    `${header}\n2026-07-10T10:00:00.000Z,Not A Real Machine,1,Sales Import Set,1,13.00,manual,\n`
  );
  assert.throws(() => importers.importBulkSalesCsv(badPath), /unknown machine "Not A Real Machine"/);
  void mId;
});

test("quick_bulk day attribution: even split, remainder to most recent day, same-day case", async () => {
  const { ops } = await mods();

  // 3 days, qty 10 -> base 3/day, remainder 1 goes to the last (most recent) day.
  let days = ops.computeDayAttribution(10, "2026-07-01T08:00:00.000Z", "2026-07-03T20:00:00.000Z");
  assert.deepEqual(days, [
    { date: "2026-07-01", qty: 3 },
    { date: "2026-07-02", qty: 3 },
    { date: "2026-07-03", qty: 4 },
  ]);

  // Same-day case collapses to a single day carrying the full qty.
  days = ops.computeDayAttribution(7, "2026-07-05T03:00:00.000Z", "2026-07-05T22:00:00.000Z");
  assert.deepEqual(days, [{ date: "2026-07-05", qty: 7 }]);

  // qty smaller than day count: early days get 0, remainder lands on the last day.
  days = ops.computeDayAttribution(2, "2026-07-01T00:00:00.000Z", "2026-07-05T00:00:00.000Z");
  assert.deepEqual(days, [
    { date: "2026-07-01", qty: 0 },
    { date: "2026-07-02", qty: 0 },
    { date: "2026-07-03", qty: 0 },
    { date: "2026-07-04", qty: 0 },
    { date: "2026-07-05", qty: 2 },
  ]);

  assert.throws(
    () => ops.computeDayAttribution(5, "2026-07-05T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
    /is after now/
  );
  assert.throws(() => ops.computeDayAttribution(0, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"), /positive integer/);
});

test("quickBulkSale: writes one pk_sales row per nonzero day, priced from the active assignment", async () => {
  const { ops } = await mods();
  const mId = await testMachine();
  const productId = ops.ensureProduct({ set_name: "Quick Bulk Set", form: "booster", tier: "mid" });
  const slot = 6;
  ops.reassignSku({ machine_id: mId, slot_number: slot, product_id: productId, price_cents: 1400, capacity: 15 });

  const result = ops.quickBulkSale({
    machine_id: mId,
    slot_number: slot,
    qty: 2,
    since_ts: "2026-07-01T00:00:00.000Z",
    now: "2026-07-05T00:00:00.000Z",
  });
  // 5-day window, qty 2 -> only the last day (remainder) yields a nonzero row.
  assert.equal(result.product_id, productId);
  assert.equal(result.unit_price_cents, 1400);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].qty, 2);
  assert.equal(result.rows[0].sold_at, "2026-07-05T12:00:00.000Z");

  assert.throws(
    () =>
      ops.quickBulkSale({
        machine_id: mId,
        slot_number: 99,
        qty: 1,
        since_ts: "2026-07-01T00:00:00.000Z",
        now: "2026-07-01T00:00:00.000Z",
      }),
    /no active sku assignment/
  );
});
