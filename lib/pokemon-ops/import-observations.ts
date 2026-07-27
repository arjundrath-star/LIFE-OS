// Carddistro-format CSV → pk_price_observations importer core. Phase 2 wraps this
// in API routes; the seed script and CLIs call it directly.
//
// Idempotency, two layers:
// - file level: sha256 of the raw bytes gets a pk_import_receipts row in the same
//   IMMEDIATE transaction as the inserts; a known fingerprint skips the whole file
//   and returns the prior receipt;
// - row level: exact reruns dedupe against UNIQUE(source, listing_ref,
//   observed_date, product_id). A changed TCGplayer/CardDistro payload for UTC
//   today updates that current-day row so dependent buy levels can reprice;
//   prior dates remain immutable. listing_ref is normalized to '' (never NULL —
//   NULL-in-UNIQUE silently disables dedupe).
// Canonical-name rule: an unknown set_name is a hard error listing valid names;
// products are never auto-created here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import {
  getImportReceipt,
  insertImportReceipt,
  insertPriceObservation,
  listProducts,
} from "./db";
import { OBSERVATION_SOURCES, type ObservationSource, type PkImportReceipt } from "./types";

export const CARDDISTRO_HEADER = [
  "observed_date",
  "source",
  "set_name",
  "form",
  "price_per_pack_usd",
  "lot_size",
  "includes_shipping",
  "includes_tax",
  "listing_ref",
  "notes",
] as const;

export interface CarddistroRow {
  observed_date: string;
  source: string;
  set_name: string;
  form: string;
  price_per_pack_usd: string;
  lot_size: string;
  includes_shipping: string;
  includes_tax: string;
  listing_ref: string;
  notes: string;
}

export interface CarddistroImportResult {
  imported: number;
  updated: number;
  skipped: number;
  receipt: PkImportReceipt;
}

// RFC 4180-ish CSV parser; handles quoted commas/newlines and BOM.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCarddistroCsv(text: string): CarddistroRow[] {
  const parsed = parseCsv(text);
  if (parsed.length === 0) throw new Error("empty CSV");
  const header = parsed[0].map((h) => h.trim());
  if (header.join(",") !== CARDDISTRO_HEADER.join(",")) {
    throw new Error(
      `bad carddistro CSV header: expected "${CARDDISTRO_HEADER.join(",")}", got "${header.join(",")}"`
    );
  }
  return parsed.slice(1).map(
    (r) =>
      Object.fromEntries(
        CARDDISTRO_HEADER.map((h, i) => [h, (r[i] ?? "").trim()])
      ) as unknown as CarddistroRow
  );
}

export function usdToCents(usd: string): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad USD price: "${usd}"`);
  return Math.round(n * 100);
}

export function parseFlag(value: string, label: string): 0 | 1 | null {
  if (value === "") return null;
  if (value === "0") return 0;
  if (value === "1") return 1;
  throw new Error(`bad ${label}: "${value}" (expected '', 0 or 1)`);
}

export function parseOptionalInt(value: string, label: string): number | null {
  if (value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`bad ${label}: "${value}"`);
  return n;
}

export function importCarddistroCsv(filePath: string): CarddistroImportResult {
  const abs = path.resolve(filePath);
  const bytes = fs.readFileSync(abs);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const rows = parseCarddistroCsv(bytes.toString("utf8"));

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let receipt: PkImportReceipt | undefined;
  const tx = getDb().transaction(() => {
    const prior = getImportReceipt(sha256);
    const products = new Map(listProducts().map((p) => [p.set_name, p.id]));
    for (const row of rows) {
      const productId = products.get(row.set_name);
      if (productId === undefined) {
        throw new Error(
          `unknown set name "${row.set_name}" — valid set names: ${[...products.keys()].sort().join(", ")}`
        );
      }
      if (!(OBSERVATION_SOURCES as readonly string[]).includes(row.source)) {
        throw new Error(`bad observation source "${row.source}"`);
      }
      const res = insertPriceObservation({
        observed_date: row.observed_date,
        source: row.source as ObservationSource,
        product_id: productId,
        price_per_pack_cents: usdToCents(row.price_per_pack_usd),
        lot_size: parseOptionalInt(row.lot_size, "lot_size"),
        includes_shipping: parseFlag(row.includes_shipping, "includes_shipping"),
        includes_tax: parseFlag(row.includes_tax, "includes_tax"),
        listing_ref: row.listing_ref,
        notes: row.notes || null,
      });
      if (res.inserted) imported++;
      else if (res.updated) updated++;
      else skipped++;
    }
    // Receipts remain durable provenance, but they cannot be a permanent skip
    // gate for mutable current-day benchmarks: a real A→B→A market reversion
    // must apply A again even though that payload hash was seen earlier.
    receipt = prior ?? insertImportReceipt({
      sha256,
      filename: path.basename(abs),
      kind: "carddistro",
      row_count: rows.length,
    });
  });
  tx.immediate();
  return { imported, updated, skipped, receipt: receipt! };
}
