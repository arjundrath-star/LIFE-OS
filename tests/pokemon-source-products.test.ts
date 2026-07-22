import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { classifySourceProduct, computeSourceProductTargets, refreshSourceProducts } from "@/lib/pokemon-ops/source-products";

const repoRoot = path.join(__dirname, "..");

test("known exact sealed formats map to verified pack counts", () => {
  const cases: Array<[string, string, number, string]> = [
    ["Prismatic Evolutions", "Prismatic Evolutions Booster Bundle", 6, "booster_bundle"],
    ["Prismatic Evolutions", "Prismatic Evolutions Booster Bundle Display", 60, "booster_bundle_display"],
    ["Mega Evolution", "Mega Evolution Booster Box", 36, "booster_box"],
    ["Mega Evolution", "Mega Evolution Build & Battle Box Display", 40, "build_battle_display"],
    ["White Flare", "White Flare Binder Collection", 5, "binder_collection"],
    ["151", "151 Binder Collection", 4, "binder_collection"],
    ["Ascended Heroes", "Premium Poster Collection: Mega Lucario", 10, "premium_poster_collection"],
    ["Paldean Fates", "Paldean Fates Premium Collection [Meowscarada ex]", 8, "premium_collection"],
    ["Perfect Order", "Perfect Order 3 Pack Blister [Chikorita]", 3, "three_pack_blister"],
    ["Perfect Order", "Perfect Order Booster Box Case", 216, "booster_box_case"],
    ["Perfect Order", "Perfect Order Booster Bundle Case", 150, "booster_bundle_case"],
    ["Perfect Order", "Perfect Order Pokemon Center Elite Trainer Box Case", 44, "pokemon_center_etb_case"],
    ["Ascended Heroes", "Ascended Heroes Mini Tin Display", 20, "mini_tin_display"],
  ];
  for (const [setName, name, packCount, form] of cases) {
    const classified = classifySourceProduct(setName, name);
    assert.equal(classified?.packCount, packCount, name);
    assert.equal(classified?.form, form, name);
  }
});

test("an exact TCGplayer product description can verify a same-set collection", () => {
  const classified = classifySourceProduct(
    "Ascended Heroes",
    "Ascended Heroes Mega Meganium ex Box",
    "This box includes four booster packs from the Mega Evolution—Ascended Heroes expansion.",
  );
  assert.equal(classified?.packCount, 4);
  assert.equal(classified?.form, "described_sealed_product");
});

test("digital code cards and mixed-set products are excluded", () => {
  assert.equal(classifySourceProduct("151", "Code Card - 151 Elite Trainer Box"), null);
  assert.equal(classifySourceProduct("Black Bolt", "Unova Victini Illustration Collection"), null);
  assert.equal(classifySourceProduct("White Flare", "White Flare Binder & Unova Poster Collection (Sam's Club)"), null);
  assert.equal(classifySourceProduct("Black Bolt", "Unova Mini Tin [Garbodor & Amoonguss]"), null);
});

test("live current TCGCSV prices cannot be mislabeled as a historical snapshot", async () => {
  await assert.rejects(
    refreshSourceProducts({ observedDate: "2020-01-01" }),
    /live TCGCSV prices can only be recorded for UTC today/,
  );
});

test("low medium high totals use the lower benchmark and remain strictly below both", () => {
  assert.deepEqual(computeSourceProductTargets(6, 1463, 1566), {
    benchmarkPppCents: 1463,
    lowTotalCents: 6583,
    mediumTotalCents: 7022,
    highTotalCents: 7461,
  });
  const targets = computeSourceProductTargets(9, 1663, 1523);
  assert.deepEqual(targets, {
    benchmarkPppCents: 1523,
    lowTotalCents: 10280,
    mediumTotalCents: 10965,
    highTotalCents: 11650,
  });
  assert.ok(targets.highTotalCents < 9 * 1663);
  assert.ok(targets.highTotalCents < 9 * 1523);
});

test("migration enforces append-only date uniqueness and strict high-tier ceilings", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE pk_products (id INTEGER PRIMARY KEY, set_name TEXT NOT NULL)");
  db.exec(fs.readFileSync(path.join(repoRoot, "db/migrations/0015_pokemon_source_products.sql"), "utf8"));
  db.prepare("INSERT INTO pk_products(id,set_name) VALUES(1,'Test Set')").run();
  const sourceId = Number(db.prepare(`INSERT INTO pk_source_products
    (pack_product_id,tcgplayer_product_id,name,form,pack_count,tcgplayer_url,pack_count_source_url,pack_count_note)
    VALUES(1,123,'Test Bundle','booster_bundle',6,'https://example.com/p','https://example.com/p','verified')`).run().lastInsertRowid);
  const insert = db.prepare(`INSERT INTO pk_source_product_values
    (source_product_id,observed_date,pack_count,tcg_market_cents,pack_tcg_cents,carddistro_cents,
     benchmark_ppp_cents,low_total_cents,medium_total_cents,high_total_cents,methodology)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(sourceId, "2026-07-22", 6, 8000, 1500, 1600, 1500, 6500, 7000, 7650, "test");
  db.prepare("UPDATE pk_source_products SET pack_count=12 WHERE id=?").run(sourceId);
  const current = db.prepare("SELECT pack_count, low_ppp_cents FROM pk_v_source_product_current WHERE source_product_id=?")
    .get(sourceId) as { pack_count: number; low_ppp_cents: number };
  assert.equal(current.pack_count, 6, "dated view must use the immutable snapshot pack count");
  assert.equal(current.low_ppp_cents, 6500 / 6);
  assert.throws(() => insert.run(sourceId, "2026-07-22", 6, 8000, 1500, 1600, 1500, 6500, 7000, 7650, "duplicate"), /UNIQUE/);
  assert.throws(() => insert.run(sourceId, "2026-07-23", 6, 8000, 1500, 1600, 1500, 6500, 7000, 9000, "bad ceiling"), /CHECK/);
  db.close();
});
