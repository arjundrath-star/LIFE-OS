import fs from "node:fs";
import { getDb } from "../db";
import {
  parseCarddistroCsv,
  parseFlag,
  parseOptionalInt,
  usdToCents,
  type CarddistroRow,
} from "../lib/pokemon-ops/import-observations";
import {
  computeSourceProductTargets,
  SET_NAME_TO_TCG_GROUP,
} from "../lib/pokemon-ops/source-products";

export const expectedTcgplayerSets = Object.entries(SET_NAME_TO_TCG_GROUP)
  .filter(([, groupId]) => groupId !== null)
  .map(([setName]) => setName)
  .sort();

function difference(expected: string[], observed: string[]): string[] {
  const seen = new Set(observed);
  return expected.filter((value) => !seen.has(value));
}

export function validateBenchmarkRows(
  rows: CarddistroRow[],
  input: { source: "tcgplayer" | "carddistro"; observedDate: string; requireComplete: boolean },
) {
  if (rows.length === 0) throw new Error(`${input.source} collector produced no observations`);
  const wrongSource = rows.filter((row) => row.source !== input.source);
  if (wrongSource.length) throw new Error(`${input.source} CSV contains ${wrongSource.length} rows for another source`);
  const wrongDate = rows.filter((row) => row.observed_date !== input.observedDate);
  if (wrongDate.length) throw new Error(`${input.source} CSV contains ${wrongDate.length} rows outside ${input.observedDate}`);
  const nonBooster = rows.filter((row) => row.form !== "booster");
  if (nonBooster.length) throw new Error(`${input.source} CSV contains ${nonBooster.length} non-booster rows`);
  // Validate every economic field before either import or DB comparison.
  for (const row of rows) {
    usdToCents(row.price_per_pack_usd);
    parseOptionalInt(row.lot_size, "lot_size");
    parseFlag(row.includes_shipping, "includes_shipping");
    parseFlag(row.includes_tax, "includes_tax");
  }

  const setNames = rows.map((row) => row.set_name);
  const duplicateSets = [...new Set(setNames.filter((setName, index) => setNames.indexOf(setName) !== index))].sort();
  if (duplicateSets.length) throw new Error(`${input.source} CSV contains duplicate set rows: ${duplicateSets.join(", ")}`);

  if (input.requireComplete) {
    const missing = difference(expectedTcgplayerSets, setNames);
    const unexpected = difference(setNames.sort(), expectedTcgplayerSets);
    if (missing.length || unexpected.length) {
      throw new Error(`TCGplayer coverage mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`);
    }
  }

  return { source: input.source, observedDate: input.observedDate, rowCount: rows.length, setNames: [...setNames].sort() };
}

export function validateBenchmarkCsv(
  filePath: string,
  input: { source: "tcgplayer" | "carddistro"; observedDate: string; requireComplete: boolean },
) {
  return validateBenchmarkRows(parseCarddistroCsv(fs.readFileSync(filePath, "utf8")), input);
}

export function validateImportedTcgplayerCoverage(observedDate: string) {
  const setNames = (getDb().prepare(
    `SELECT DISTINCT p.set_name
       FROM pk_price_observations o
       JOIN pk_products p ON p.id=o.product_id
      WHERE o.source='tcgplayer' AND o.observed_date=? AND p.form='booster' AND p.active=1
      ORDER BY p.set_name`,
  ).all(observedDate) as Array<{ set_name: string }>).map((row) => row.set_name);
  const missing = difference(expectedTcgplayerSets, setNames);
  const unexpected = difference(setNames, expectedTcgplayerSets);
  if (missing.length || unexpected.length) {
    throw new Error(`imported TCGplayer coverage mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`);
  }
  return { source: "tcgplayer", observedDate, rowCount: setNames.length, setNames };
}

export function validateImportedBenchmarkRows(
  rows: CarddistroRow[],
  input: { source: "tcgplayer" | "carddistro"; observedDate: string; requireComplete: boolean },
) {
  const validated = validateBenchmarkRows(rows, input);
  const db = getDb();
  const mismatches: string[] = [];
  for (const row of rows) {
    const listingRef = row.listing_ref.trim();
    const stored = db.prepare(
      `SELECT o.price_per_pack_cents, o.lot_size, o.total_cost_cents,
              o.includes_shipping, o.includes_tax, o.listing_ref,
              o.quantity_available, o.notes
         FROM pk_price_observations o
         JOIN pk_products p ON p.id=o.product_id
        WHERE p.set_name=? AND p.form='booster' AND p.active=1
          AND o.source=? AND o.observed_date=? AND o.listing_ref=?`,
    ).get(row.set_name, input.source, input.observedDate, listingRef) as {
      price_per_pack_cents: number;
      lot_size: number | null;
      total_cost_cents: number | null;
      includes_shipping: number | null;
      includes_tax: number | null;
      listing_ref: string;
      quantity_available: number | null;
      notes: string | null;
    } | undefined;
    if (
      !stored
      || stored.price_per_pack_cents !== usdToCents(row.price_per_pack_usd)
      || stored.lot_size !== parseOptionalInt(row.lot_size, "lot_size")
      || stored.total_cost_cents !== null
      || stored.includes_shipping !== parseFlag(row.includes_shipping, "includes_shipping")
      || stored.includes_tax !== parseFlag(row.includes_tax, "includes_tax")
      || stored.listing_ref !== listingRef
      || stored.quantity_available !== null
      || stored.notes !== (row.notes || null)
    ) {
      mismatches.push(row.set_name);
    }
  }
  if (mismatches.length) {
    throw new Error(
      `imported ${input.source} rows do not match collected CSV; mismatches=${mismatches.length}/${rows.length}, sets=[${mismatches.sort().join(", ")}]`,
    );
  }
  return { ...validated, mismatches: 0 };
}

export function validateSourceProductValuationCoverage(observedDate: string) {
  const db = getDb();
  const expected = db.prepare(
    `SELECT sp.id, p.set_name, sp.pack_count,
            (SELECT o.price_per_pack_cents
               FROM pk_price_observations o
              WHERE o.product_id=p.id AND o.source='tcgplayer' AND o.observed_date<=?
              ORDER BY o.observed_date DESC, o.id DESC LIMIT 1) AS latest_tcg_cents,
            (SELECT o.price_per_pack_cents
               FROM pk_price_observations o
              WHERE o.product_id=p.id AND o.source='carddistro' AND o.observed_date<=?
              ORDER BY o.observed_date DESC, o.id DESC LIMIT 1) AS latest_carddistro_cents,
            v.pack_count AS valued_pack_count,
            v.pack_tcg_cents,
            v.carddistro_cents,
            v.benchmark_ppp_cents,
            v.low_total_cents,
            v.medium_total_cents,
            v.high_total_cents
       FROM pk_source_products sp
       JOIN pk_products p ON p.id=sp.pack_product_id
       LEFT JOIN pk_source_product_values v
         ON v.source_product_id=sp.id AND v.observed_date=?
      WHERE sp.active=1
        AND p.form='booster'
        AND p.active=1
        AND EXISTS (
          SELECT 1 FROM pk_price_observations o
           WHERE o.product_id=p.id AND o.source='carddistro' AND o.observed_date<=?
        )
      ORDER BY p.set_name, sp.id`,
  ).all(observedDate, observedDate, observedDate, observedDate) as Array<{
    id: number;
    set_name: string;
    pack_count: number;
    latest_tcg_cents: number | null;
    latest_carddistro_cents: number | null;
    valued_pack_count: number | null;
    pack_tcg_cents: number | null;
    carddistro_cents: number | null;
    benchmark_ppp_cents: number | null;
    low_total_cents: number | null;
    medium_total_cents: number | null;
    high_total_cents: number | null;
  }>;
  if (expected.length === 0) throw new Error("source-product valuation coverage has no active expected products");

  const missing = expected.filter((row) => row.valued_pack_count === null);
  if (missing.length) {
    const sets = [...new Set(missing.map((row) => row.set_name))].sort();
    throw new Error(`source-product valuation coverage mismatch; missing=${missing.length}/${expected.length}, sets=[${sets.join(", ")}]`);
  }

  const stale = expected.filter((row) => {
    if (row.latest_tcg_cents === null || row.latest_carddistro_cents === null) return true;
    const targets = computeSourceProductTargets(
      row.pack_count,
      row.latest_tcg_cents,
      row.latest_carddistro_cents,
    );
    return row.valued_pack_count !== row.pack_count
      || row.pack_tcg_cents !== row.latest_tcg_cents
      || row.carddistro_cents !== row.latest_carddistro_cents
      || row.benchmark_ppp_cents !== targets.benchmarkPppCents
      || row.low_total_cents !== targets.lowTotalCents
      || row.medium_total_cents !== targets.mediumTotalCents
      || row.high_total_cents !== targets.highTotalCents;
  });
  if (stale.length) {
    const sets = [...new Set(stale.map((row) => row.set_name))].sort();
    throw new Error(`source-product valuation values are stale; stale=${stale.length}/${expected.length}, sets=[${sets.join(", ")}]`);
  }
  return { source: "source_product_values", observedDate, rowCount: expected.length, missing: 0, stale: 0 };
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const mode = valueAfter("--mode");
  const observedDate = valueAfter("--date");
  if (!observedDate || !/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) throw new Error("--date YYYY-MM-DD is required");

  if (mode === "db") {
    const file = valueAfter("--file");
    const source = valueAfter("--source");
    if (file || source) {
      if (!file) throw new Error("--file is required for database row validation");
      if (source !== "tcgplayer" && source !== "carddistro") throw new Error("--source must be tcgplayer or carddistro");
      console.log(JSON.stringify(validateImportedBenchmarkRows(
        parseCarddistroCsv(fs.readFileSync(file, "utf8")),
        { source, observedDate, requireComplete: source === "tcgplayer" },
      ), null, 2));
    } else {
      console.log(JSON.stringify(validateImportedTcgplayerCoverage(observedDate), null, 2));
    }
    return;
  }
  if (mode === "values") {
    console.log(JSON.stringify(validateSourceProductValuationCoverage(observedDate), null, 2));
    return;
  }
  if (mode !== "csv") throw new Error("--mode must be csv, db, or values");

  const file = valueAfter("--file");
  const source = valueAfter("--source");
  if (!file) throw new Error("--file is required for CSV validation");
  if (source !== "tcgplayer" && source !== "carddistro") throw new Error("--source must be tcgplayer or carddistro");
  console.log(JSON.stringify(validateBenchmarkCsv(file, {
    source,
    observedDate,
    requireComplete: source === "tcgplayer",
  }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
