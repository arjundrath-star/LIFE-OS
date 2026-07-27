import fs from "node:fs";
import { getDb } from "../db";
import { parseCarddistroCsv, type CarddistroRow } from "../lib/pokemon-ops/import-observations";
import { SET_NAME_TO_TCG_GROUP } from "../lib/pokemon-ops/source-products";

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

export function validateSourceProductValuationCoverage(observedDate: string) {
  const db = getDb();
  const expected = db.prepare(
    `SELECT sp.id, p.set_name
       FROM pk_source_products sp
       JOIN pk_products p ON p.id=sp.pack_product_id
      WHERE sp.active=1
        AND p.form='booster'
        AND p.active=1
        AND EXISTS (
          SELECT 1 FROM pk_price_observations o
           WHERE o.product_id=p.id AND o.source='carddistro' AND o.observed_date<=?
        )
      ORDER BY p.set_name, sp.id`,
  ).all(observedDate) as Array<{ id: number; set_name: string }>;
  if (expected.length === 0) throw new Error("source-product valuation coverage has no active expected products");
  const valuedIds = new Set((db.prepare(
    `SELECT source_product_id FROM pk_source_product_values WHERE observed_date=?`,
  ).all(observedDate) as Array<{ source_product_id: number }>).map((row) => row.source_product_id));
  const missing = expected.filter((row) => !valuedIds.has(row.id));
  if (missing.length) {
    const sets = [...new Set(missing.map((row) => row.set_name))].sort();
    throw new Error(`source-product valuation coverage mismatch; missing=${missing.length}/${expected.length}, sets=[${sets.join(", ")}]`);
  }
  return { source: "source_product_values", observedDate, rowCount: expected.length, missing: 0 };
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
    console.log(JSON.stringify(validateImportedTcgplayerCoverage(observedDate), null, 2));
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
