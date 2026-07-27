import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const repoRoot = path.join(__dirname, "..");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-source-products-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmpDir, "test.db");

function sourceProducts() {
  return import("@/lib/pokemon-ops/source-products");
}

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test("known exact sealed formats map to verified pack counts", async () => {
  const { classifySourceProduct } = await sourceProducts();
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

test("an exact TCGplayer product description can verify a same-set collection", async () => {
  const { classifySourceProduct } = await sourceProducts();
  const classified = classifySourceProduct(
    "Ascended Heroes",
    "Ascended Heroes Mega Meganium ex Box",
    "This box includes four booster packs from the Mega Evolution—Ascended Heroes expansion.",
  );
  assert.equal(classified?.packCount, 4);
  assert.equal(classified?.form, "described_sealed_product");
});

test("digital code cards and mixed-set products are excluded", async () => {
  const { classifySourceProduct } = await sourceProducts();
  assert.equal(classifySourceProduct("151", "Code Card - 151 Elite Trainer Box"), null);
  assert.equal(classifySourceProduct("Black Bolt", "Unova Victini Illustration Collection"), null);
  assert.equal(classifySourceProduct("White Flare", "White Flare Binder & Unova Poster Collection (Sam's Club)"), null);
  assert.equal(classifySourceProduct("Black Bolt", "Unova Mini Tin [Garbodor & Amoonguss]"), null);
});

test("live current TCGCSV prices cannot be mislabeled as a historical snapshot", async () => {
  const { refreshSourceProducts } = await sourceProducts();
  await assert.rejects(
    refreshSourceProducts({ observedDate: "2020-01-01" }),
    /live TCGCSV prices can only be recorded for UTC today/,
  );
});

test("low medium high totals use the lower benchmark and remain strictly below both", async () => {
  const { computeSourceProductTargets } = await sourceProducts();
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

test("a later mapped-set TCGCSV failure leaves all catalog and value rows unchanged", async () => {
  const { refreshSourceProducts } = await sourceProducts();
  const { getDb } = await import("@/db");
  const db = getDb();
  const fixtureDir = path.join(tmpDir, "late-failure-fixtures");
  fs.mkdirSync(fixtureDir);

  const insertProduct = db.prepare(
    `INSERT INTO pk_products (set_name, display_name) VALUES (?, ?)`
  );
  const firstPackId = Number(insertProduct.run("151", "151 Booster").lastInsertRowid);
  const laterPackId = Number(insertProduct.run("Mega Evolution", "Mega Evolution Booster").lastInsertRowid);
  const insertObservation = db.prepare(
    `INSERT INTO pk_price_observations
       (observed_date, source, product_id, price_per_pack_cents, listing_ref)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const [productId, label] of [[firstPackId, "first"], [laterPackId, "later"]] as const) {
    insertObservation.run("2026-07-21", "tcgplayer", productId, 1000, `${label}-tcg`);
    insertObservation.run("2026-07-21", "carddistro", productId, 1100, `${label}-carddistro`);
  }

  const insertSource = db.prepare(
    `INSERT INTO pk_source_products
       (pack_product_id, tcgplayer_product_id, name, form, pack_count,
        tcgplayer_url, pack_count_source_url, pack_count_note)
     VALUES (?, ?, ?, 'booster_bundle', 6, ?, ?, 'baseline')`
  );
  const firstSourceId = Number(insertSource.run(
    firstPackId,
    8001,
    "Existing 151 Bundle",
    "https://example.com/8001",
    "https://example.com/8001",
  ).lastInsertRowid);
  const laterSourceId = Number(insertSource.run(
    laterPackId,
    8002,
    "Existing Mega Evolution Bundle",
    "https://example.com/8002",
    "https://example.com/8002",
  ).lastInsertRowid);
  const insertValue = db.prepare(
    `INSERT INTO pk_source_product_values
       (source_product_id, observed_date, pack_count, tcg_market_cents,
        tcg_low_cents, tcg_high_cents, pack_tcg_cents, carddistro_cents,
        benchmark_ppp_cents, low_total_cents, medium_total_cents,
        high_total_cents, methodology)
     VALUES (?, '2026-07-20', 6, 6500, 6000, 7000, 1000, 1100,
             1000, 4500, 4800, 5100, 'baseline')`
  );
  insertValue.run(firstSourceId);
  insertValue.run(laterSourceId);

  fs.writeFileSync(path.join(fixtureDir, "23237_products.json"), JSON.stringify({
    results: [{
      productId: 8101,
      name: "151 Booster Bundle",
      url: "https://example.com/8101",
    }],
  }));
  fs.writeFileSync(path.join(fixtureDir, "23237_prices.json"), JSON.stringify({
    results: [
      { productId: 8101, subTypeName: "Reverse Holofoil", lowPrice: 1, highPrice: 2, marketPrice: 1.5 },
      { productId: 8101, subTypeName: "Normal", lowPrice: 55, highPrice: 75, marketPrice: 65 },
    ],
  }));
  fs.writeFileSync(path.join(fixtureDir, "24380_products.json"), JSON.stringify({
    results: [{
      productId: 8201,
      name: "Mega Evolution Booster Box",
      url: "https://example.com/8201",
    }],
  }));
  fs.writeFileSync(path.join(fixtureDir, "24380_prices.json"), JSON.stringify({ results: null }));

  const snapshot = () => ({
    catalog: db.prepare(
      `SELECT * FROM pk_source_products
       WHERE pack_product_id IN (?, ?) ORDER BY id`
    ).all(firstPackId, laterPackId),
    values: db.prepare(
      `SELECT v.* FROM pk_source_product_values v
       JOIN pk_source_products sp ON sp.id = v.source_product_id
       WHERE sp.pack_product_id IN (?, ?) ORDER BY v.id`
    ).all(firstPackId, laterPackId),
  });
  const before = snapshot();

  await assert.rejects(
    refreshSourceProducts({ observedDate: "2026-07-22", fixtureDir }),
    /TCGCSV prices group 24380 returned an invalid envelope/,
  );

  assert.deepEqual(snapshot(), before);
  assert.equal(before.catalog.length, 2);
  assert.equal(before.values.length, 2);
});

test("duplicate or non-positive TCGCSV product IDs are rejected before coverage and leave the DB unchanged", async () => {
  const { refreshSourceProducts } = await sourceProducts();
  const { getDb } = await import("@/db");
  const db = getDb();
  const fixtureDir = path.join(tmpDir, "duplicate-id-fixtures");
  fs.mkdirSync(fixtureDir);

  db.exec(`
    DELETE FROM pk_source_product_values;
    DELETE FROM pk_source_products;
    DELETE FROM pk_price_observations;
    DELETE FROM pk_products;
  `);
  const packId = Number(db.prepare(
    `INSERT INTO pk_products (set_name, display_name) VALUES ('Journey Together', 'Journey Together Booster')`
  ).run().lastInsertRowid);
  const insertObservation = db.prepare(
    `INSERT INTO pk_price_observations
       (observed_date, source, product_id, price_per_pack_cents, listing_ref)
     VALUES ('2026-07-22', ?, ?, ?, ?)`
  );
  insertObservation.run("tcgplayer", packId, 1000, "duplicate-id-tcg");
  insertObservation.run("carddistro", packId, 1100, "duplicate-id-carddistro");
  const insertSource = db.prepare(
    `INSERT INTO pk_source_products
       (pack_product_id, tcgplayer_product_id, name, form, pack_count,
        tcgplayer_url, pack_count_source_url, pack_count_note)
     VALUES (?, ?, ?, 'booster_bundle', 6, ?, ?, 'baseline')`
  );
  for (const productId of [9101, 9102]) {
    const url = `https://example.com/${productId}`;
    insertSource.run(packId, productId, `Existing Bundle ${productId}`, url, url);
  }

  const productsFile = path.join(fixtureDir, "24073_products.json");
  fs.writeFileSync(productsFile, JSON.stringify({
    results: [
      { productId: 9201, name: "Journey Together Booster Bundle", url: "https://example.com/9201-a" },
      { productId: 9201, name: "Journey Together Booster Bundle", url: "https://example.com/9201-b" },
    ],
  }));
  fs.writeFileSync(path.join(fixtureDir, "24073_prices.json"), JSON.stringify({
    results: [{ productId: 9201, lowPrice: 50, highPrice: 70, marketPrice: 60 }],
  }));

  const snapshot = () => ({
    catalog: db.prepare(`SELECT * FROM pk_source_products ORDER BY id`).all(),
    values: db.prepare(`SELECT * FROM pk_source_product_values ORDER BY id`).all(),
  });
  const before = snapshot();
  await assert.rejects(
    refreshSourceProducts({ observedDate: "2026-07-22", fixtureDir }),
    /TCGCSV products group 24073 returned duplicate productId 9201/,
  );
  assert.deepEqual(snapshot(), before);
  assert.equal(before.catalog.length, 2, "regression requires two active catalog rows");

  fs.writeFileSync(productsFile, JSON.stringify({
    results: [{ productId: 0, name: "Journey Together Booster Bundle", url: "https://example.com/invalid" }],
  }));
  await assert.rejects(
    refreshSourceProducts({ observedDate: "2026-07-22", fixtureDir }),
    /TCGCSV products group 24073 returned an invalid envelope/,
  );
  assert.deepEqual(snapshot(), before);
});

test("same-day source price changes reprice buy levels while prior dated snapshots remain unchanged", async () => {
  const { refreshSourceProducts } = await sourceProducts();
  const { getDb } = await import("@/db");
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const previousDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const fixtureDir = path.join(tmpDir, "same-day-repricing-fixtures");
  fs.mkdirSync(fixtureDir);

  db.exec(`
    DELETE FROM pk_source_product_values;
    DELETE FROM pk_source_products;
    DELETE FROM pk_price_observations;
    DELETE FROM pk_products;
  `);
  const packId = Number(db.prepare(
    `INSERT INTO pk_products (set_name, display_name) VALUES ('Journey Together', 'Journey Together Booster')`
  ).run().lastInsertRowid);
  const insertObservation = db.prepare(
    `INSERT INTO pk_price_observations
       (observed_date, source, product_id, price_per_pack_cents, listing_ref)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertObservation.run(previousDate, "tcgplayer", packId, 1000, "tcg-prior");
  insertObservation.run(previousDate, "carddistro", packId, 1100, "card-prior");

  fs.writeFileSync(path.join(fixtureDir, "24073_products.json"), JSON.stringify({
    results: [{
      productId: 9301,
      name: "Journey Together Booster Bundle",
      url: "https://example.com/9301",
    }],
  }));
  fs.writeFileSync(path.join(fixtureDir, "24073_prices.json"), JSON.stringify({
    results: [{ productId: 9301, lowPrice: 50, highPrice: 70, marketPrice: 60 }],
  }));

  const first = await refreshSourceProducts({ observedDate: previousDate, fixtureDir });
  assert.equal(first.valueInserts, 1);

  insertObservation.run(today, "tcgplayer", packId, 900, "tcg-today-stable");
  insertObservation.run(today, "carddistro", packId, 1050, "card-today");
  const expectedTcgCsv = path.join(fixtureDir, "expected-tcg.csv");
  const writeExpectedTcg = (price: string) => fs.writeFileSync(expectedTcgCsv, [
    "observed_date,source,set_name,form,price_per_pack_usd,lot_size,includes_shipping,includes_tax,listing_ref,notes",
    `${today},tcgplayer,Journey Together,booster,${price},,,,tcg-today-stable,`,
    "",
  ].join("\n"));
  writeExpectedTcg("9.00");
  const nextDay = await refreshSourceProducts({
    observedDate: today,
    fixtureDir,
    expectedBenchmarkCsv: { tcgplayer: expectedTcgCsv },
  });
  assert.equal(nextDay.valueInserts, 1);
  const { validateSourceProductValuationCoverage } = await import("@/scripts/pokemon-benchmark-coverage");
  assert.doesNotThrow(() => validateSourceProductValuationCoverage(today));

  const { insertPriceObservation } = await import("@/lib/pokemon-ops/db");
  const benchmarkCorrection = insertPriceObservation({
    observed_date: today,
    source: "tcgplayer",
    product_id: packId,
    price_per_pack_cents: 800,
    listing_ref: "tcg-today-stable",
  });
  assert.deepEqual(
    { inserted: benchmarkCorrection.inserted, updated: benchmarkCorrection.updated },
    { inserted: false, updated: true },
  );
  assert.throws(
    () => validateSourceProductValuationCoverage(today),
    /source-product valuation values are stale/,
  );
  await assert.rejects(
    refreshSourceProducts({
      observedDate: today,
      fixtureDir,
      expectedBenchmarkCsv: { tcgplayer: expectedTcgCsv },
    }),
    /benchmark changed after import verification/,
  );
  writeExpectedTcg("8.00");
  const repriced = await refreshSourceProducts({
    observedDate: today,
    fixtureDir,
    expectedBenchmarkCsv: { tcgplayer: expectedTcgCsv },
  });
  assert.equal(repriced.valueInserts, 0);
  assert.equal((repriced as { valueUpdates?: number }).valueUpdates, 1);
  assert.doesNotThrow(() => validateSourceProductValuationCoverage(today));

  const benchmarkReversion = insertPriceObservation({
    observed_date: today,
    source: "tcgplayer",
    product_id: packId,
    price_per_pack_cents: 900,
    listing_ref: "tcg-today-stable",
  });
  assert.equal(benchmarkReversion.updated, true);
  assert.throws(
    () => validateSourceProductValuationCoverage(today),
    /source-product valuation values are stale/,
  );
  await assert.rejects(
    refreshSourceProducts({
      observedDate: today,
      fixtureDir,
      expectedBenchmarkCsv: { tcgplayer: expectedTcgCsv },
    }),
    /benchmark changed after import verification/,
  );
  writeExpectedTcg("9.00");
  const reverted = await refreshSourceProducts({
    observedDate: today,
    fixtureDir,
    expectedBenchmarkCsv: { tcgplayer: expectedTcgCsv },
  });
  assert.equal(reverted.valueUpdates, 1);
  assert.doesNotThrow(() => validateSourceProductValuationCoverage(today));

  // Historical snapshots are immutable even when a newer backfilled observation
  // for that old date appears later.
  insertObservation.run(previousDate, "tcgplayer", packId, 700, "tcg-prior-late");
  const historicalRerun = await refreshSourceProducts({ observedDate: previousDate, fixtureDir });
  assert.equal(historicalRerun.valueInserts, 0);
  assert.equal((historicalRerun as { valueUpdates?: number }).valueUpdates, 0);

  const rows = db.prepare(
    `SELECT observed_date, pack_tcg_cents, carddistro_cents, benchmark_ppp_cents,
            low_total_cents, medium_total_cents, high_total_cents
       FROM pk_source_product_values
      ORDER BY observed_date`
  ).all() as Array<{
    observed_date: string;
    pack_tcg_cents: number;
    carddistro_cents: number;
    benchmark_ppp_cents: number;
    low_total_cents: number;
    medium_total_cents: number;
    high_total_cents: number;
  }>;
  assert.deepEqual(rows, [
    {
      observed_date: previousDate,
      pack_tcg_cents: 1000,
      carddistro_cents: 1100,
      benchmark_ppp_cents: 1000,
      low_total_cents: 4500,
      medium_total_cents: 4800,
      high_total_cents: 5100,
    },
    {
      observed_date: today,
      pack_tcg_cents: 900,
      carddistro_cents: 1050,
      benchmark_ppp_cents: 900,
      low_total_cents: 4050,
      medium_total_cents: 4320,
      high_total_cents: 4590,
    },
  ]);
});

test("TCGCSV fetch timeout configuration must be a bounded positive integer", async () => {
  const { refreshSourceProducts } = await sourceProducts();
  await assert.rejects(
    refreshSourceProducts({ observedDate: "2026-07-22", fixtureDir: tmpDir, fetchTimeoutMs: 0 }),
    /TCGCSV fetch timeout must be a positive integer/,
  );
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
