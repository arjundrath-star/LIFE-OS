import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createInventoryRound,
  inventoryRoundsSnapshot,
  replaceInventoryRoundLots,
  updateInventoryRound,
} from "../lib/pokemon-ops/inventory-rounds";

const ROOT = path.resolve(import.meta.dirname, "..");

function fixture() {
  const file = path.join(os.tmpdir(), `inventory-rounds-${process.pid}-${Math.random()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY, applied_at TEXT)");
  for (const name of fs.readdirSync(path.join(ROOT, "db/migrations")).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(ROOT, "db/migrations", name), "utf8"));
    db.prepare("INSERT INTO _migrations(name, applied_at) VALUES(?, 'fixture')").run(name);
  }
  const machineId = Number(db.prepare("INSERT INTO machines(name, location) VALUES('Fixture machine', 'Test')").run().lastInsertRowid);
  const boosterId = Number(db.prepare("INSERT INTO pk_products(set_name, form, display_name, tier) VALUES('Pitch Black', 'booster', 'Pitch Black booster', 'premium')").run().lastInsertRowid);
  const slabId = Number(db.prepare("INSERT INTO pk_products(set_name, form, display_name, tier) VALUES('Fixture slab', 'slab', 'Fixture graded card', 'slab')").run().lastInsertRowid);
  const lot = (date:string, productId:number, units:number, cost:number) => Number(db.prepare(`INSERT INTO pk_purchase_lots
    (purchase_date, source, product_id, pack_count, total_cost_cents, landed_cost_per_pack_cents, status)
    VALUES(?, 'other', ?, ?, ?, ?, 'received')`).run(date, productId, units, cost, Math.round(cost / units)).lastInsertRowid);
  const earlyLot = lot("2026-08-01", boosterId, 8, 800);
  const pitchBlackLot = lot("2026-08-26", boosterId, 8, 1200);
  const slabLot = lot("2026-08-26", slabId, 1, 10000);
  const close = () => { db.close(); for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force:true }); };
  return { db, machineId, boosterId, slabId, earlyLot, pitchBlackLot, slabLot, close };
}

test("inventory rounds map canonical lots and attribute mixed refills/sales FIFO across every product form", () => {
  const f = fixture();
  try {
    const round1 = createInventoryRound({ name:"Round 1", starts_on:"2026-01-01", ends_on:"2026-08-25" }, f.db);
    const round2 = createInventoryRound({ name:"Round 2", starts_on:"2026-08-26" }, f.db);
    replaceInventoryRoundLots(round1, [f.earlyLot], f.db);
    replaceInventoryRoundLots(round2, [f.pitchBlackLot, f.slabLot], f.db);
    const refill = f.db.prepare("INSERT INTO pk_stock_events(machine_id, slot_number, event, qty_delta, lot_id, at) VALUES(?, ?, 'refill', ?, ?, ?)");
    refill.run(f.machineId, 1, 5, f.earlyLot, "2026-08-20T10:00:00Z");
    refill.run(f.machineId, 1, 4, f.pitchBlackLot, "2026-08-27T10:00:00Z");
    refill.run(f.machineId, 2, 1, f.slabLot, "2026-08-27T10:00:00Z");
    const sale = f.db.prepare("INSERT INTO pk_sales(machine_id, slot_number, product_id, qty, unit_price_cents, sold_at, source) VALUES(?, ?, ?, ?, 500, ?, 'manual')");
    sale.run(f.machineId, 1, f.boosterId, 6, "2026-08-28T10:00:00Z");
    sale.run(f.machineId, 2, f.slabId, 1, "2026-08-28T10:00:00Z");

    const result = inventoryRoundsSnapshot(f.db);
    assert.equal(result.rounds.length, 2);
    assert.deepEqual(result.rounds[0].totals, {
      purchased_units:8, total_cost_cents:800, known_cost_cents:800, known_cost_units:8,
      pending_cost_lot_count:0, pending_cost_units:0,
      machine:{units:0, percent:0}, stockroom:{units:3, percent:37.5}, sold:{units:5, percent:62.5},
      unresolved:{units:0, percent:0},
    });
    assert.deepEqual(result.rounds[1].totals, {
      purchased_units:9, total_cost_cents:11200, known_cost_cents:11200, known_cost_units:9,
      pending_cost_lot_count:0, pending_cost_units:0,
      machine:{units:3, percent:33.3}, stockroom:{units:4, percent:44.4}, sold:{units:2, percent:22.2},
      unresolved:{units:0, percent:0},
    });
    assert.equal(result.rounds[1].products.find(row => row.form === "slab")?.sold.units, 1);
    assert.equal(result.traceability.unknown_sold_units, 0);
  } finally { f.close(); }
});

test("attribution caps each lot at purchased units and surfaces unlinked or excess quantities", () => {
  const f = fixture();
  try {
    const round = createInventoryRound({ name:"Round 2", starts_on:"2026-08-26" }, f.db);
    replaceInventoryRoundLots(round, [f.pitchBlackLot], f.db);
    f.db.prepare("INSERT INTO pk_stock_events(machine_id, slot_number, event, qty_delta, lot_id, at) VALUES(?, 1, 'refill', 12, ?, '2026-08-27T10:00:00Z')").run(f.machineId, f.pitchBlackLot);
    f.db.prepare("INSERT INTO pk_stock_events(machine_id, slot_number, event, qty_delta, lot_id, at) VALUES(?, 1, 'refill', 3, NULL, '2026-08-27T11:00:00Z')").run(f.machineId);
    f.db.prepare("INSERT INTO pk_sales(machine_id, slot_number, product_id, qty, unit_price_cents, sold_at, source) VALUES(?, 1, ?, 10, 500, '2026-08-28T10:00:00Z', 'manual')").run(f.machineId, f.boosterId);

    const result = inventoryRoundsSnapshot(f.db);
    const totals = result.rounds[0].totals;
    assert.equal(totals.purchased_units, 8);
    assert.equal(totals.sold.units, 8);
    assert.equal(totals.machine.units, 0);
    assert.equal(totals.stockroom.units, 0);
    assert.ok(totals.machine.units + totals.stockroom.units + totals.sold.units + totals.unresolved.units <= totals.purchased_units);
    assert.equal(result.traceability.over_allocated_refill_units, 4);
    assert.equal(result.traceability.unlinked_refill_units, 3);
    assert.equal(result.traceability.unknown_sold_units, 2);
    assert.equal(result.traceability.unknown_machine_units, 1);
  } finally { f.close(); }
});

test("round membership is dated by purchase, unique, and carries no fabricated cost field", () => {
  const f = fixture();
  try {
    const round = createInventoryRound({ name:"Round 2", starts_on:"2026-08-26", notes:"Cost can be confirmed later on the canonical lot." }, f.db);
    assert.throws(() => replaceInventoryRoundLots(round, [f.earlyLot], f.db), /outside Round 2/);
    replaceInventoryRoundLots(round, [f.pitchBlackLot], f.db);
    const columns = f.db.prepare("PRAGMA table_info(pk_inventory_round_lots)").all() as Array<{name:string}>;
    assert.deepEqual(columns.map(column => column.name), ["round_id", "lot_id", "added_at"]);
    const other = createInventoryRound({ name:"Other", starts_on:"2026-08-26" }, f.db);
    assert.throws(() => replaceInventoryRoundLots(other, [f.pitchBlackLot], f.db), /already belongs/);
  } finally { f.close(); }
});

test("pending purchase cost stays unknown instead of appearing as zero", () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE pk_purchase_lots SET total_cost_cents=0, landed_cost_per_pack_cents=0, cost_confirmed=0 WHERE id=?").run(f.pitchBlackLot);
    const round = createInventoryRound({ name:"Round 2", starts_on:"2026-08-26" }, f.db);
    replaceInventoryRoundLots(round, [f.pitchBlackLot], f.db);
    const totals = inventoryRoundsSnapshot(f.db).rounds[0].totals;
    assert.equal(totals.total_cost_cents, null);
    assert.equal(totals.known_cost_cents, 0);
    assert.equal(totals.known_cost_units, 0);
    assert.equal(totals.pending_cost_lot_count, 1);
    assert.equal(totals.pending_cost_units, 8);
  } finally { f.close(); }
});

test("slot reassignment prevents stale inventory from leaking into the next assignment", () => {
  const f = fixture();
  try {
    const round = createInventoryRound({ name:"Round 2", starts_on:"2026-08-26" }, f.db);
    replaceInventoryRoundLots(round, [f.pitchBlackLot], f.db);
    f.db.prepare("INSERT INTO pk_stock_events(machine_id,slot_number,event,qty_delta,lot_id,at) VALUES(?,1,'refill',4,?,'2026-08-27T10:00:00Z')").run(f.machineId,f.pitchBlackLot);
    f.db.prepare("INSERT INTO pk_sku_assignments(machine_id,slot_number,product_id,price_cents,capacity,assigned_at) VALUES(?,1,?,500,12,'2026-08-27T11:00:00Z')").run(f.machineId,f.slabId);
    const result = inventoryRoundsSnapshot(f.db);
    assert.equal(result.rounds[0].totals.machine.units, 0);
    assert.equal(result.rounds[0].totals.unresolved.units, 4);
  } finally { f.close(); }
});
