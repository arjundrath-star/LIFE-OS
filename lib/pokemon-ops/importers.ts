// CSV importer cores for bulk purchase lots and bulk sales. Same idempotency shape
// as import-observations.ts (the carddistro supplier-quote importer):
// - file level: sha256 of the raw bytes gets a pk_import_receipts row in the same
//   IMMEDIATE transaction as the inserts; a known fingerprint skips the whole file
//   and returns the prior receipt (no-op rerun);
// - unknown set_name / machine name = hard error, listing the valid names.
// pk_purchase_lots has no natural per-row dedupe key (unlike observations/sales),
// so idempotency for lots is file-level only — a repeat import of the same bytes
// is a full no-op via the receipt gate.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import {
  getImportReceipt,
  getMachineByName,
  insertImportReceipt,
  insertPurchaseLot,
  insertSale,
  listProducts,
} from "./db";
import {
  LOT_STATUSES,
  OBSERVATION_SOURCES,
  SALE_SOURCES,
  type LotStatus,
  type ObservationSource,
  type PkImportReceipt,
  type SaleSource,
} from "./types";

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

export function usdToCents(usd: string): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad USD amount: "${usd}"`);
  return Math.round(n * 100);
}

function readFile(filePath: string): { abs: string; bytes: Buffer; sha256: string; rows: string[][] } {
  const abs = path.resolve(filePath);
  const bytes = fs.readFileSync(abs);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const rows = parseCsv(bytes.toString("utf8"));
  if (rows.length === 0) throw new Error("empty CSV");
  return { abs, bytes, sha256, rows };
}

function parseHeaderRows(rows: string[][], header: readonly string[]): Record<string, string>[] {
  const gotHeader = rows[0].map((h) => h.trim());
  if (gotHeader.join(",") !== header.join(",")) {
    throw new Error(`bad CSV header: expected "${header.join(",")}", got "${gotHeader.join(",")}"`);
  }
  return rows.slice(1).map(
    (r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])) as Record<string, string>
  );
}

// ---- bulk purchase lots ----

export const BULK_LOTS_HEADER = [
  "purchase_date",
  "source",
  "set_name",
  "pack_count",
  "total_cost_usd",
  "observation_ref",
  "status",
  "notes",
] as const;

export interface BulkLotsImportResult {
  imported: number;
  skipped: number;
  receipt: PkImportReceipt;
}

export function importBulkLotsCsv(filePath: string): BulkLotsImportResult {
  const { abs, sha256, rows } = readFile(filePath);
  const parsed = parseHeaderRows(rows, BULK_LOTS_HEADER);

  let imported = 0;
  let skipped = 0;
  let receipt: PkImportReceipt | undefined;
  const tx = getDb().transaction(() => {
    const prior = getImportReceipt(sha256);
    if (prior) {
      receipt = prior;
      skipped = parsed.length;
      return;
    }
    const products = new Map(listProducts().map((p) => [p.set_name, p.id]));
    for (const row of parsed) {
      const productId = products.get(row.set_name);
      if (productId === undefined) {
        throw new Error(
          `unknown set name "${row.set_name}" — valid set names: ${[...products.keys()].sort().join(", ")}`
        );
      }
      if (!(OBSERVATION_SOURCES as readonly string[]).includes(row.source)) {
        throw new Error(`bad lot source "${row.source}"`);
      }
      const packCount = parseInt(row.pack_count, 10);
      if (!Number.isInteger(packCount) || packCount <= 0) {
        throw new Error(`bad pack_count "${row.pack_count}"`);
      }
      let observationId: number | null = null;
      if (row.observation_ref) {
        observationId = parseInt(row.observation_ref, 10);
        if (!Number.isInteger(observationId)) {
          throw new Error(`bad observation_ref "${row.observation_ref}"`);
        }
      }
      let status: LotStatus | undefined;
      if (row.status) {
        if (!(LOT_STATUSES as readonly string[]).includes(row.status)) {
          throw new Error(`bad lot status "${row.status}"`);
        }
        status = row.status as LotStatus;
      }
      insertPurchaseLot({
        purchase_date: row.purchase_date,
        source: row.source as ObservationSource,
        product_id: productId,
        pack_count: packCount,
        total_cost_cents: usdToCents(row.total_cost_usd),
        observation_id: observationId,
        status,
        notes: row.notes || null,
      });
      imported++;
    }
    receipt = insertImportReceipt({
      sha256,
      filename: path.basename(abs),
      kind: "lots",
      row_count: parsed.length,
    });
  });
  tx.immediate();
  return { imported, skipped, receipt: receipt! };
}

// ---- bulk sales ----

export const BULK_SALES_HEADER = [
  "sold_at",
  "machine",
  "slot_number",
  "set_name",
  "qty",
  "unit_price_usd",
  "source",
  "external_txn_id",
] as const;

export interface BulkSalesImportResult {
  imported: number;
  skipped: number;
  receipt: PkImportReceipt;
}

export function importBulkSalesCsv(filePath: string): BulkSalesImportResult {
  const { abs, sha256, rows } = readFile(filePath);
  const parsed = parseHeaderRows(rows, BULK_SALES_HEADER);

  let imported = 0;
  let skipped = 0;
  let receipt: PkImportReceipt | undefined;
  const tx = getDb().transaction(() => {
    const prior = getImportReceipt(sha256);
    if (prior) {
      receipt = prior;
      skipped = parsed.length;
      return;
    }
    const products = new Map(listProducts().map((p) => [p.set_name, p.id]));
    const machineIds = new Map<string, number>();
    for (const row of parsed) {
      const productId = products.get(row.set_name);
      if (productId === undefined) {
        throw new Error(
          `unknown set name "${row.set_name}" — valid set names: ${[...products.keys()].sort().join(", ")}`
        );
      }
      let machineId = machineIds.get(row.machine);
      if (machineId === undefined) {
        const machine = getMachineByName(row.machine);
        if (!machine) throw new Error(`unknown machine "${row.machine}"`);
        machineId = machine.id;
        machineIds.set(row.machine, machineId);
      }
      if (!(SALE_SOURCES as readonly string[]).includes(row.source)) {
        throw new Error(`bad sale source "${row.source}"`);
      }
      const slotNumber = parseInt(row.slot_number, 10);
      if (!Number.isInteger(slotNumber) || slotNumber <= 0) {
        throw new Error(`bad slot_number "${row.slot_number}"`);
      }
      const qty = parseInt(row.qty, 10);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`bad qty "${row.qty}"`);
      }
      const res = insertSale({
        machine_id: machineId,
        slot_number: slotNumber,
        product_id: productId,
        qty,
        unit_price_cents: usdToCents(row.unit_price_usd),
        sold_at: row.sold_at,
        source: row.source as SaleSource,
        external_txn_id: row.external_txn_id,
      });
      if (res.inserted) imported++;
      else skipped++;
    }
    receipt = insertImportReceipt({
      sha256,
      filename: path.basename(abs),
      kind: "sales",
      row_count: parsed.length,
    });
  });
  tx.immediate();
  return { imported, skipped, receipt: receipt! };
}
