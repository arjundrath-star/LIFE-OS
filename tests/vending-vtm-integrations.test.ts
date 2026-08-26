import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import writeXlsxFile from "write-excel-file/node";
import {
  importVtmExport,
  validateVtmUpload,
  vendingIntegrationsSnapshot,
  VendingIntegrationError,
  VTM_MAX_EXPORT_BYTES,
} from "../lib/vending-integrations";
import {
  readBoundedVtmMultipartRequest,
  VTM_MULTIPART_OVERHEAD_ALLOWANCE,
} from "../lib/vending-integrations/vtm-upload";

const root = path.resolve(import.meta.dirname, "..");
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fixture() {
  const file = path.join(os.tmpdir(), `vending-vtm-${process.pid}-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT)");
  for (const name of fs.readdirSync(path.join(root, "db/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(root, "db/migrations", name), "utf8"));
    db.prepare("INSERT INTO _migrations VALUES(?,?)").run(name, new Date().toISOString());
  }
  return {
    db,
    close() {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

const officialHeadings = [
  "Transaction ID",
  "Transaction Date & Time",
  "Machine Number",
  "Machine Name",
  "Slot Number",
  "Product Name",
  "Cost Price",
  "Retail Price",
  "Order Status",
  "Account",
  "Currency",
  "Quantity",
  "Actual Payment Price",
];

async function workbookBytes(rows: unknown[][], headings: unknown[] = officialHeadings): Promise<Buffer> {
  return writeXlsxFile(
    [["VTM Real Time Transactions - Order list"], headings, ...rows] as Array<Array<string | number | Date | null | undefined>>,
    { sheet: "Order list", dateFormat: "mm/dd/yyyy hh:mm:ss" },
  ).toBuffer();
}

function officialRow(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const row: unknown[] = [
    "order-delivered-1",
    new Date("2026-08-25T14:03:04.000Z"),
    "VTM-0091",
    "Lobby VTM",
    "A07",
    "Scarlet & Violet Booster",
    1.23,
    4.5,
    "Delivered",
    "Downtown Account",
    "",
    1,
    4.25,
  ];
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value;
  return row;
}

function isCode(code: string) {
  return (error: unknown) => error instanceof VendingIntegrationError && error.code === code;
}

test("official VTM Order list XLSX ingests only Delivered rows with exact normalized fields", async () => {
  const f = fixture();
  try {
    const bytes = await workbookBytes([
      officialRow(),
      officialRow({ 0: "order-canceled", 8: "Canceled", 12: 99 }),
      officialRow({ 0: "order-expired", 8: "Expired", 12: 88 }),
    ]);
    const result = await importVtmExport(bytes, { filename: "Order list.xlsx", contentType: XLSX_TYPE, db: f.db });
    assert.deepEqual(
      { mode: result.mode, duplicate: result.duplicate, salesSeen: result.salesSeen, salesChanged: result.salesChanged, unmapped: result.unmappedRecords },
      { mode: "xlsx", duplicate: false, salesSeen: 1, salesChanged: 1, unmapped: 1 },
    );
    assert.equal("sha256" in result, false);

    const sale = f.db.prepare(`SELECT external_sale_id,provider_machine_external_id,provider_machine_name,
      provider_account_label,provider_slot_external_id,product_name,quantity,unit_price_cents,total_cents,
      cost_price_cents,retail_price_cents,currency,sold_at,order_status
      FROM vending_provider_sales`).get() as Record<string, unknown>;
    assert.deepEqual(sale, {
      external_sale_id: "order-delivered-1",
      provider_machine_external_id: "VTM-0091",
      provider_machine_name: "Lobby VTM",
      provider_account_label: "Downtown Account",
      provider_slot_external_id: "A07",
      product_name: "Scarlet & Violet Booster",
      quantity: 1,
      unit_price_cents: 425,
      total_cents: 425,
      cost_price_cents: 123,
      retail_price_cents: 450,
      currency: "USD",
      sold_at: "2026-08-25T14:03:04.000Z",
      order_status: "Delivered",
    });
    assert.equal((f.db.prepare("SELECT COUNT(*) count FROM vending_provider_sales").get() as { count: number }).count, 1);

    const snapshot = vendingIntegrationsSnapshot(f.db).providers.vtm;
    assert.equal(snapshot.connection.access, "official_order_list_xlsx_import");
    assert.equal(snapshot.lastRun?.mode, "xlsx");
    assert.equal(snapshot.lastRun?.unmappedRecords, 1);
    assert.equal(snapshot.counts.unmappedMachines, 1);
    assert.equal(snapshot.mappedMachines[0].mapped, false);
    assert.ok(snapshot.blockers.includes("UNMAPPED_PROVIDER_MACHINES"));
    assert.ok(snapshot.blockers.includes("VTM_API_UNDOCUMENTED_USE_ORDER_LIST_XLSX_IMPORT"));
  } finally {
    f.close();
  }
});

test("VTM import idempotency is bound to the SHA-256 of the raw XLSX bytes", async () => {
  const f = fixture();
  try {
    const bytes = await workbookBytes([officialRow()]);
    const first = await importVtmExport(bytes, { filename: "Order list.xlsx", contentType: XLSX_TYPE, db: f.db });
    const duplicate = await importVtmExport(Buffer.from(bytes), { filename: "Order list.xlsx", contentType: XLSX_TYPE, db: f.db });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.salesChanged, 0);
    assert.equal("sha256" in duplicate, false);
    const run = f.db.prepare("SELECT mode,source_sha256 FROM vending_provider_sync_runs").get() as { mode: string; source_sha256: string };
    assert.equal(run.mode, "xlsx");
    assert.equal(run.source_sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal((f.db.prepare("SELECT COUNT(*) count FROM vending_provider_sync_runs").get() as { count: number }).count, 1);
    assert.equal((f.db.prepare("SELECT COUNT(*) count FROM vending_provider_sales").get() as { count: number }).count, 1);
  } finally {
    f.close();
  }
});

test("VTM rejects invalid currency and unrelated generic transaction headings", async () => {
  const invalidCurrency = fixture();
  try {
    const bytes = await workbookBytes([officialRow({ 10: "US" })]);
    await assert.rejects(
      importVtmExport(bytes, { filename: "Order list.xlsx", contentType: XLSX_TYPE, db: invalidCurrency.db }),
      isCode("INVALID_CURRENCY"),
    );
    assert.equal((invalidCurrency.db.prepare("SELECT COUNT(*) count FROM vending_provider_sales").get() as { count: number }).count, 0);
  } finally {
    invalidCurrency.close();
  }

  const wrongHeadings = fixture();
  try {
    const bytes = await workbookBytes(
      [["2026-08-25", 4.25, "complete", "Lobby", "Booster"]],
      ["Date", "Amount", "Status", "Location", "Description"],
    );
    await assert.rejects(
      importVtmExport(bytes, { filename: "transactions.xlsx", contentType: XLSX_TYPE, db: wrongHeadings.db }),
      isCode("UNRECOGNIZED_VTM_HEADINGS"),
    );
  } finally {
    wrongHeadings.close();
  }
});

test("user-converted CSV remains a clearly labeled converted_csv fallback", async () => {
  const f = fixture();
  try {
    const csv = Buffer.from([
      "Transaction ID,Transaction Date & Time,Machine Number,Slot Number,Product Name,Cost Price,Retail Price,Order Status,Account,Currency,Actual Payment Price",
      "csv-1,08/25/2026 02:03:04 PM,VTM-CSV-1,B02,Booster,1.10,4.00,Delivered,CSV Account,USD,3.75",
    ].join("\n"));
    const result = await importVtmExport(csv, { filename: "Order list converted by user.csv", contentType: "text/csv", db: f.db });
    assert.equal(result.mode, "converted_csv");
    assert.equal(result.salesSeen, 1);
    assert.equal(vendingIntegrationsSnapshot(f.db).providers.vtm.lastRun?.mode, "converted_csv");
    assert.equal((f.db.prepare("SELECT total_cents FROM vending_provider_sales").get() as { total_cents: number }).total_cents, 375);
  } finally {
    f.close();
  }
});

test("VTM file and multipart total-request limits reject oversized uploads", async () => {
  const oversizedFile = Buffer.alloc(VTM_MAX_EXPORT_BYTES + 1);
  assert.throws(
    () => validateVtmUpload(oversizedFile, "Order list.xlsx", XLSX_TYPE),
    (error: unknown) => error instanceof VendingIntegrationError && error.code === "VTM_EXPORT_TOO_LARGE" && error.status === 413,
  );

  const totalLimit = VTM_MAX_EXPORT_BYTES + VTM_MULTIPART_OVERHEAD_ALLOWANCE;
  const declared = new Request("http://localhost/api/vending/integrations/vtm/import", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(totalLimit + 1) },
    body: "small",
  });
  await assert.rejects(readBoundedVtmMultipartRequest(declared), isCode("VTM_EXPORT_TOO_LARGE"));

  const streamed = new Request("http://localhost/api/vending/integrations/vtm/import", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: new Uint8Array(totalLimit + 1),
  });
  await assert.rejects(readBoundedVtmMultipartRequest(streamed), isCode("VTM_EXPORT_TOO_LARGE"));
});
