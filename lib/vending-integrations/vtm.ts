import "./server-only";
import type Database from "better-sqlite3";
import readXlsxFile from "read-excel-file/node";
import { canonicalLabel, parseCsv } from "./csv";
import { moneyToCents, positiveInteger, safeCurrency, sha256, text, utcIso } from "./normalize";
import {
  beginSyncRun,
  database,
  ensureProviderAccount,
  finishSyncRun,
  updateSyncState,
  upsertMachineMapping,
  upsertSale,
} from "./storage";
import type { NormalizedProviderSale, ProviderMode } from "./types";
import { VendingIntegrationError } from "./types";

export const VTM_MAX_EXPORT_BYTES = 1_000_000;
export const VTM_XLSX_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);
export const VTM_CONVERTED_CSV_CONTENT_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);
export const VTM_EXPORT_CONTENT_TYPES = new Set([
  ...VTM_XLSX_CONTENT_TYPES,
  ...VTM_CONVERTED_CSV_CONTENT_TYPES,
]);

// Compatibility aliases for callers that have not yet adopted export-neutral names.
export const VTM_MAX_CSV_BYTES = VTM_MAX_EXPORT_BYTES;
export const VTM_CSV_CONTENT_TYPES = VTM_CONVERTED_CSV_CONTENT_TYPES;

const LABELS = {
  saleId: ["transactionid", "ordernumber", "orderno", "orderid"],
  transactionDateTime: ["transactiondatetime", "transactiondateandtime", "orderdatetime", "orderdateandtime"],
  transactionDate: ["transactiondate", "orderdate"],
  transactionTime: ["transactiontime", "ordertime"],
  actualPaymentPrice: ["actualpaymentprice", "actualpaymentamount", "actualpaidprice"],
  orderStatus: ["orderstatus", "transactionstatus"],
  machineId: ["machinenumber", "machineno", "machineid", "machineidentifier", "vendingmachinenumber"],
  machineName: ["machinename", "vendingmachinename"],
  machineCombined: ["machinenumbername", "machineidname"],
  slot: ["slotnumber", "slotno", "slot"],
  productId: ["productid", "productcode", "itemid", "itemcode", "sku"],
  productName: ["productname", "itemname"],
  quantity: ["quantity", "qty"],
  costPrice: ["costprice", "productcostprice"],
  retailPrice: ["retailprice", "productretailprice"],
  account: ["account", "accountname", "accountlabel"],
  currency: ["currency", "currencycode"],
} as const;

type VtmField = keyof typeof LABELS;
type CellRecord = Partial<Record<VtmField, unknown>>;

interface ParsedExport {
  records: CellRecord[];
}

function mimeType(contentType: string): string {
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

export function validateVtmUpload(bytes: Buffer, filename: string, contentType: string): ProviderMode {
  const lowerName = filename.trim().toLowerCase();
  const mime = mimeType(contentType);
  let mode: ProviderMode;
  if (lowerName.endsWith(".xlsx")) {
    mode = "xlsx";
    if (!VTM_XLSX_CONTENT_TYPES.has(mime)) {
      throw new VendingIntegrationError(
        "INVALID_VTM_CONTENT_TYPE",
        "VTM Order list must use an XLSX content type",
        415,
      );
    }
  } else if (lowerName.endsWith(".csv")) {
    mode = "converted_csv";
    if (!VTM_CONVERTED_CSV_CONTENT_TYPES.has(mime)) {
      throw new VendingIntegrationError(
        "INVALID_VTM_CONTENT_TYPE",
        "User-converted VTM CSV fallback must use a CSV content type",
        415,
      );
    }
  } else {
    throw new VendingIntegrationError(
      "INVALID_VTM_FILE",
      "VTM upload must be an official Order list .xlsx or a user-converted .csv fallback",
    );
  }
  if (!bytes.length) throw new VendingIntegrationError("EMPTY_VTM_EXPORT", "VTM export is empty");
  if (bytes.length > VTM_MAX_EXPORT_BYTES) {
    throw new VendingIntegrationError("VTM_EXPORT_TOO_LARGE", "VTM export exceeds the 1 MB limit", 413);
  }
  return mode;
}

function firstIndex(header: string[], aliases: readonly string[]): number | undefined {
  for (const alias of aliases) {
    const index = header.indexOf(alias);
    if (index >= 0) return index;
  }
  return undefined;
}

function recognizeHeader(values: unknown[]): Partial<Record<VtmField, number>> | null {
  const header = values.map((item) => canonicalLabel(cellText(item) || ""));
  const populated = header.filter(Boolean);
  if (new Set(populated).size !== populated.length) return null;
  const fields: Partial<Record<VtmField, number>> = {};
  for (const field of Object.keys(LABELS) as VtmField[]) {
    const index = firstIndex(header, LABELS[field]);
    if (index !== undefined) fields[field] = index;
  }
  const hasDateTime = fields.transactionDateTime !== undefined
    || (fields.transactionDate !== undefined && fields.transactionTime !== undefined);
  const hasMachine = fields.machineId !== undefined
    || fields.machineName !== undefined
    || fields.machineCombined !== undefined;
  return hasDateTime
    && fields.actualPaymentPrice !== undefined
    && fields.orderStatus !== undefined
    && fields.slot !== undefined
    && fields.productName !== undefined
    && hasMachine
    ? fields
    : null;
}

function mapRecord(values: unknown[], fields: Partial<Record<VtmField, number>>): CellRecord {
  const record: CellRecord = {};
  for (const field of Object.keys(fields) as VtmField[]) {
    record[field] = values[fields[field] as number];
  }
  return record;
}

function cellText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") return text(value, 500);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    const cell = value as {
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: unknown }>;
      hyperlink?: unknown;
    };
    if (cell.result !== undefined) return cellText(cell.result);
    if (cell.text !== undefined) return cellText(cell.text);
    if (Array.isArray(cell.richText)) return text(cell.richText.map((part) => cellText(part.text) || "").join(""), 500);
    if (cell.hyperlink !== undefined) return cellText(cell.hyperlink);
  }
  return null;
}

function rawCellValue(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const cell = value as { result?: unknown; text?: unknown; richText?: unknown };
    if (cell.result !== undefined) return rawCellValue(cell.result);
    if (cell.text !== undefined || cell.richText !== undefined) return cellText(value);
  }
  return value;
}

function parseConvertedCsv(bytes: Buffer): ParsedExport {
  const rows = parseCsv(bytes);
  if (rows.length < 2) {
    throw new VendingIntegrationError(
      "INVALID_VTM_EXPORT",
      "User-converted VTM CSV must contain recognizable headings and at least one row",
    );
  }
  let headerRow = -1;
  let fields: Partial<Record<VtmField, number>> | null = null;
  for (let index = 0; index < Math.min(rows.length, 25); index++) {
    fields = recognizeHeader(rows[index]);
    if (fields) { headerRow = index; break; }
  }
  if (!fields) throwUnrecognizedHeadings();
  return {
    records: rows.slice(headerRow + 1)
      .filter((row) => row.some((value) => value.trim()))
      .map((row) => mapRecord(row, fields!)),
  };
}

async function parseOfficialXlsx(bytes: Buffer): Promise<ParsedExport> {
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(bytes);
  } catch {
    throw new VendingIntegrationError("INVALID_VTM_XLSX", "VTM Order list is not a valid XLSX workbook");
  }
  for (const sheet of sheets) {
    const rows = sheet.data;
    const scanLimit = Math.min(rows.length, 50);
    for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
      const fields = recognizeHeader(rows[rowIndex]);
      if (!fields) continue;
      const records = rows.slice(rowIndex + 1)
        .filter((row) => row.some((value) => cellText(value)))
        .map((row) => mapRecord(row, fields));
      return { records };
    }
  }
  throwUnrecognizedHeadings();
}

function throwUnrecognizedHeadings(): never {
  throw new VendingIntegrationError(
    "UNRECOGNIZED_VTM_HEADINGS",
    "VTM export must include transaction date and time, Actual Payment Price, Order Status, Slot Number, Product Name, and a machine number or name",
  );
}

function excelSerialIso(serial: number): string {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) {
    throw new VendingIntegrationError("INVALID_TIMESTAMP", "VTM export contains an invalid transaction date");
  }
  return new Date(Math.round((serial - 25_569) * 86_400_000)).toISOString();
}

function transactionDate(record: CellRecord): string {
  const combined = rawCellValue(record.transactionDateTime);
  if (combined !== undefined && combined !== null && combined !== "") {
    if (combined instanceof Date) {
      return new Date(Math.round(combined.getTime() / 1000) * 1000).toISOString();
    }
    return typeof combined === "number" ? excelSerialIso(combined) : utcIso(combined);
  }
  const dateValue = rawCellValue(record.transactionDate);
  const timeValue = rawCellValue(record.transactionTime);
  let datePart: string;
  if (dateValue instanceof Date) datePart = dateValue.toISOString().slice(0, 10);
  else if (typeof dateValue === "number") datePart = excelSerialIso(dateValue).slice(0, 10);
  else datePart = cellText(dateValue) || "";

  let timePart: string;
  if (timeValue instanceof Date) timePart = timeValue.toISOString().slice(11, 19);
  else if (typeof timeValue === "number") {
    if (!Number.isFinite(timeValue)) timePart = "";
    else {
      const dayFraction = ((timeValue % 1) + 1) % 1;
      timePart = new Date(Math.round(dayFraction * 86_400_000)).toISOString().slice(11, 19);
    }
  } else timePart = cellText(timeValue) || "";
  return utcIso(`${datePart} ${timePart}`.trim());
}

function optionalMoney(value: unknown): number | null {
  const raw = rawCellValue(value);
  return raw === undefined || raw === null || cellText(raw) === null ? null : moneyToCents(raw);
}

function normalizeVtmSale(record: CellRecord, fingerprint: string, rowIndex: number): NormalizedProviderSale | null {
  const status = cellText(record.orderStatus);
  // Official exports include non-sales such as canceled and expired orders. Only completed vends are sales.
  if (canonicalLabel(status || "") !== "delivered") return null;

  const combinedMachine = cellText(record.machineCombined);
  const machineName = text(cellText(record.machineName) || combinedMachine);
  const suppliedMachineId = text(cellText(record.machineId) || combinedMachine, 200);
  const machineExternalId = suppliedMachineId
    || (machineName ? `name:${sha256(machineName.toLowerCase()).slice(0, 24)}` : null);
  if (!machineExternalId) {
    throw new VendingIntegrationError("INVALID_VTM_MACHINE", "VTM export contains a delivered row without a machine identifier or name");
  }

  const quantity = positiveInteger(rawCellValue(record.quantity));
  const totalCents = moneyToCents(rawCellValue(record.actualPaymentPrice));
  const unitPriceCents = Math.round(totalCents / quantity);
  return {
    externalSaleId: text(cellText(record.saleId), 200) || `vtm:${fingerprint}:${rowIndex + 1}`,
    machineExternalId,
    machineName,
    providerAccountLabel: text(cellText(record.account)),
    slotExternalId: text(cellText(record.slot)),
    productExternalId: text(cellText(record.productId)),
    productName: text(cellText(record.productName)),
    quantity,
    unitPriceCents,
    totalCents,
    authorizationCents: null,
    settlementCents: null,
    costPriceCents: optionalMoney(record.costPrice),
    retailPriceCents: optionalMoney(record.retailPrice),
    currency: safeCurrency(cellText(record.currency)),
    authorizationAt: null,
    machineAuthorizationAt: null,
    settlementAt: null,
    soldAt: transactionDate(record),
    orderStatus: status,
  };
}

function safeInputError(error: VendingIntegrationError): VendingIntegrationError {
  if (error.status < 500) return error;
  const messages: Record<string, string> = {
    INVALID_CURRENCY: "VTM export contains an invalid currency code",
    INVALID_MONEY: "VTM export contains an invalid monetary value",
    INVALID_QUANTITY: "VTM export contains an invalid quantity",
    INVALID_TIMESTAMP: "VTM export contains an invalid transaction date and time",
  };
  return new VendingIntegrationError(error.code, messages[error.code] || "VTM export contains an invalid delivered row");
}

export interface VtmImportOptions {
  filename: string;
  contentType: string;
  db?: Database.Database;
  now?: () => string;
}

export async function importVtmExport(bytes: Buffer, options: VtmImportOptions) {
  const mode = validateVtmUpload(bytes, options.filename, options.contentType);
  const db = database(options.db);
  const now = options.now || (() => new Date().toISOString());
  const accountId = ensureProviderAccount("vtm", db);
  const fingerprint = sha256(bytes);
  const prior = db.prepare(`SELECT id,status,completed_at,machines_seen,sales_seen,sales_changed,unmapped_records
    FROM vending_provider_sync_runs WHERE account_id=? AND mode=? AND source_sha256=?`).get(accountId, mode, fingerprint) as any;
  if (prior?.status === "success") {
    return {
      provider: "vtm" as const,
      mode,
      duplicate: true,
      machinesSeen: prior.machines_seen,
      salesSeen: prior.sales_seen,
      salesChanged: 0,
      unmappedRecords: prior.unmapped_records,
      completedAt: prior.completed_at,
    };
  }

  const startedAt = now();
  let runId: number;
  if (prior) {
    runId = prior.id;
    db.prepare(`UPDATE vending_provider_sync_runs SET status='running',started_at=?,completed_at=NULL,machines_seen=0,
      sales_seen=0,sales_changed=0,unmapped_records=0,error_code=NULL WHERE id=?`).run(startedAt, runId);
  } else {
    runId = beginSyncRun(accountId, mode, startedAt, fingerprint, db);
  }
  updateSyncState(accountId, "running", { at: startedAt }, db);

  try {
    const parsed = mode === "xlsx" ? await parseOfficialXlsx(bytes) : parseConvertedCsv(bytes);
    const sales = parsed.records
      .map((record, index) => normalizeVtmSale(record, fingerprint, index))
      .filter((sale): sale is NormalizedProviderSale => sale !== null);
    const completedAt = now();
    let salesChanged = 0;
    let unmappedRecords = 0;
    const machineIds = new Set<string>();
    db.transaction(() => {
      for (const sale of sales) {
        machineIds.add(sale.machineExternalId);
        const mapping = upsertMachineMapping(accountId, { externalId: sale.machineExternalId, name: sale.machineName }, completedAt, db);
        if (!mapping.local_machine_id) unmappedRecords++;
        if (upsertSale(accountId, mapping.id, sale, completedAt, fingerprint, db).inserted) salesChanged++;
      }
      finishSyncRun(runId, "success", {
        completedAt,
        machinesSeen: machineIds.size,
        salesSeen: sales.length,
        salesChanged,
        unmappedRecords,
      }, db);
      updateSyncState(accountId, "success", {
        at: completedAt,
        successful: true,
        machinesSeen: machineIds.size,
        salesSeen: sales.length,
      }, db);
    }).immediate();
    return {
      provider: "vtm" as const,
      mode,
      duplicate: false,
      machinesSeen: machineIds.size,
      salesSeen: sales.length,
      salesChanged,
      unmappedRecords,
      completedAt,
    };
  } catch (cause) {
    const completedAt = now();
    const error = cause instanceof VendingIntegrationError ? safeInputError(cause) : null;
    const code = error?.code || "VTM_IMPORT_FAILED";
    finishSyncRun(runId, "failed", { completedAt, errorCode: code }, db);
    updateSyncState(accountId, "failed", { at: completedAt, errorCode: code }, db);
    if (error) throw error;
    throw new VendingIntegrationError("VTM_IMPORT_FAILED", "VTM export import failed", 500);
  }
}

/** Compatibility entry point; CSV is a user-converted fallback and reports mode converted_csv. */
export async function importVtmCsv(bytes: Buffer, options: VtmImportOptions) {
  return importVtmExport(bytes, options);
}
