import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  NayaxLynxAdapter,
  NAYAX_LYNX_BASE_URL,
  syncNayax,
  vendingIntegrationsSnapshot,
  VendingIntegrationError,
} from "../lib/vending-integrations";
import type {
  FetchLike,
  NormalizedProviderSale,
  NormalizedProviderSlot,
  ReadOnlyProviderAdapter,
} from "../lib/vending-integrations/types";

const root = path.resolve(import.meta.dirname, "..");
const NOW = "2026-08-26T12:00:00.000Z";
const TOKEN = "nayax-token-MUST-NEVER-PERSIST";
const CARD = "card-number-MUST-NEVER-PERSIST";
const CLI = "cli-MUST-NEVER-PERSIST";
const ARBITRARY = "provider-arbitrary-message-MUST-NEVER-PERSIST";
const RAW_FINGERPRINT = "raw-fingerprint-MUST-NEVER-EXPOSE";

function fixture() {
  const file = path.join(os.tmpdir(), `vending-nayax-${process.pid}-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT)");
  for (const name of fs.readdirSync(path.join(root, "db/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(root, "db/migrations", name), "utf8"));
    db.prepare("INSERT INTO _migrations VALUES(?,?)").run(name, NOW);
  }
  return {
    db,
    close() {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function isCode(code: string) {
  return (error: unknown) => error instanceof VendingIntegrationError && error.code === code;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) count FROM "${table}"`).get() as { count: number }).count;
}

function allDatabaseText(db: Database.Database): string {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  const values: unknown[] = [];
  for (const { name } of tables) {
    const columns = (db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{ name: string; type: string }>)
      .filter((column) => column.type.toUpperCase().includes("TEXT"));
    if (columns.length === 0) continue;
    const projection = columns.map((column) => `"${column.name.replaceAll('"', '""')}"`).join(",");
    for (const row of db.prepare(`SELECT ${projection} FROM "${name.replaceAll('"', '""')}"`).all() as Record<string, unknown>[]) {
      values.push(...Object.values(row));
    }
  }
  return JSON.stringify(values);
}

function slot(overrides: Partial<NormalizedProviderSlot> = {}): NormalizedProviderSlot {
  return {
    machineExternalId: "M-1",
    slotExternalId: "A1",
    machineProductExternalId: "MP-1",
    productExternalId: "P-1",
    operatorButtonCode: "A1",
    mdbCode: "001",
    dexProductName: "Booster One",
    productName: "Booster One",
    cashPriceCents: 425,
    creditCardPriceCents: 475,
    machinePriceCents: 450,
    priceCents: 475,
    quantity: null,
    par: 12,
    missingStockByMdb: 3,
    missingStockByDex: 2,
    selectionVendOutBit: true,
    providerLastUpdatedAt: "2026-08-25T12:34:56.000Z",
    observedAt: NOW,
    ...overrides,
  };
}

function sale(overrides: Partial<NormalizedProviderSale> = {}): NormalizedProviderSale {
  return {
    externalSaleId: "TX-1",
    machineExternalId: "M-1",
    machineName: null,
    providerAccountLabel: null,
    slotExternalId: null,
    productExternalId: null,
    productName: "Booster One",
    quantity: 2,
    unitPriceCents: 475,
    totalCents: 950,
    authorizationCents: 1000,
    settlementCents: 950,
    costPriceCents: null,
    retailPriceCents: null,
    currency: "USD",
    authorizationAt: "2026-08-25T12:40:00.000Z",
    machineAuthorizationAt: "2026-08-25T12:39:59.000Z",
    settlementAt: "2026-08-25T12:45:00.000Z",
    soldAt: "2026-08-25T12:45:00.000Z",
    orderStatus: null,
    ...overrides,
  };
}

function adapter(options: {
  products?: () => Promise<NormalizedProviderSlot[]>;
  sales?: () => Promise<NormalizedProviderSale[]>;
  machines?: () => Promise<Array<{ externalId: string; name: string | null }>>;
} = {}): ReadOnlyProviderAdapter {
  return {
    provider: "nayax",
    mode: "api",
    listMachines: options.machines || (async () => [{ externalId: "M-1", name: "Atrium Nayax" }]),
    listMachineProducts: options.products || (async () => [slot()]),
    listMachineSales: options.sales || (async () => [sale()]),
  };
}

function officialPayloads(saleOverrides: Record<string, unknown> = {}) {
  return {
    machines: { Machines: [{ MachineID: 91001, MachineName: "Atrium Nayax", Ignored: ARBITRARY }] },
    products: {
      MachineProducts: [{
        MachineID: 91001,
        MachineProductID: "mp-11",
        NayaxProductID: "np-42",
        MDBCode: "007",
        OperatorButtonCode: "A1",
        DEXProductName: "Moon Booster",
        CashPrice: "4.25",
        CreditCardPrice: "4.75",
        MachinePrice: 4.5,
        PAR: "12",
        MissingStockByMDB: 3,
        MissingStockByDEX: "2",
        SelectionVendOutBit: true,
        LastUpdated: "2026-08-25 12:34:56",
        RawProviderNote: ARBITRARY,
      }],
    },
    sales: {
      LastSales: [{
        TransactionID: "tx-official-1",
        AuthorizationValue: "10.00",
        SettlementValue: "9.50",
        CurrencyCode: "usd",
        ProductName: "Moon Booster",
        Quantity: 2,
        AuthorizationDateTimeGMT: "2026-08-25T12:40:00",
        MachineAuthorizationTime: "2026-08-25 12:39:59",
        SettlementDateTimeGMT: "2026-08-25T12:45:00Z",
        CardNumber: CARD,
        CLI,
        RawProviderNote: ARBITRARY,
        ...saleOverrides,
      }],
    },
  };
}

function officialRequest(payloads = officialPayloads(), calls: Array<{ url: string; init?: RequestInit }> = []): FetchLike {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    let payload: unknown;
    if (url.endsWith("/v1/machines")) payload = payloads.machines;
    else if (url.endsWith("/machineProducts")) payload = payloads.products;
    else if (url.endsWith("/lastSales")) payload = payloads.sales;
    else return new Response(JSON.stringify({ message: ARBITRARY }), { status: 404 });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("missing Nayax token blocks before network and is reflected by run, state, and status snapshot", async () => {
  const f = fixture();
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, "NAYAX_LYNX_TOKEN");
  const priorEnv = process.env.NAYAX_LYNX_TOKEN;
  let networkCalls = 0;
  process.env.NAYAX_LYNX_TOKEN = "";
  try {
    let returned: VendingIntegrationError | undefined;
    await assert.rejects(
      syncNayax({ token: "", db: f.db, request: async () => { networkCalls++; throw new Error("network must not run"); }, now: () => NOW }),
      (error: unknown) => {
        returned = error as VendingIntegrationError;
        return isCode("NAYAX_TOKEN_MISSING")(error);
      },
    );
    assert.equal(networkCalls, 0);
    assert.deepEqual(
      f.db.prepare("SELECT status,error_code FROM vending_provider_sync_runs").get(),
      { status: "blocked", error_code: "NAYAX_TOKEN_MISSING" },
    );
    assert.deepEqual(
      f.db.prepare("SELECT last_status,last_error_code FROM vending_provider_sync_state").get(),
      { last_status: "blocked", last_error_code: "NAYAX_TOKEN_MISSING" },
    );
    assert.equal(count(f.db, "vending_provider_machine_mappings"), 0);
    assert.equal(count(f.db, "vending_provider_slot_snapshots"), 0);
    assert.equal(count(f.db, "vending_provider_sales"), 0);
    const snapshot = vendingIntegrationsSnapshot(f.db).providers.nayax;
    assert.equal(snapshot.connection.configured, false);
    assert.equal(snapshot.connection.status, "blocked");
    assert.ok(snapshot.blockers.includes("NAYAX_TOKEN_MISSING"));
    assert.doesNotMatch(JSON.stringify({ returned, snapshot }), /Bearer|nayax-token/i);
  } finally {
    if (hadEnv) process.env.NAYAX_LYNX_TOKEN = priorEnv;
    else delete process.env.NAYAX_LYNX_TOKEN;
    f.close();
  }
});

test("official Lynx GET shapes normalize exactly and never persist card, CLI, token, raw fields, or arbitrary messages", async () => {
  const f = fixture();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    const result = await syncNayax({ token: TOKEN, db: f.db, request: officialRequest(officialPayloads(), calls), now: () => NOW });
    assert.deepEqual(calls.map((call) => call.url), [
      `${NAYAX_LYNX_BASE_URL}/v1/machines`,
      `${NAYAX_LYNX_BASE_URL}/v1/machines/91001/machineProducts`,
      `${NAYAX_LYNX_BASE_URL}/v1/machines/91001/lastSales`,
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(call.init?.method, "GET");
      assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
      assert.equal(headers.get("accept"), "application/json");
      assert.equal(call.init?.body, undefined);
      assert.equal(call.init?.cache, "no-store");
    }
    assert.deepEqual(result, {
      provider: "nayax",
      mode: "read_only",
      machinesSeen: 1,
      slotsSeen: 1,
      salesSeen: 1,
      salesChanged: 1,
      unmappedRecords: 3,
      completedAt: NOW,
    });

    assert.deepEqual(f.db.prepare(`SELECT provider_machine_external_id,provider_slot_external_id,
      machine_product_external_id,provider_product_external_id,operator_button_code,mdb_code,dex_product_name,
      product_name,cash_price_cents,credit_card_price_cents,machine_price_cents,price_cents,quantity,par,
      missing_stock_by_mdb,missing_stock_by_dex,selection_vend_out_bit,provider_last_updated_at,snapshot_at
      FROM vending_provider_slot_snapshots`).get(), {
      provider_machine_external_id: "91001",
      provider_slot_external_id: "A1",
      machine_product_external_id: "mp-11",
      provider_product_external_id: "np-42",
      operator_button_code: "A1",
      mdb_code: "007",
      dex_product_name: "Moon Booster",
      product_name: "Moon Booster",
      cash_price_cents: 425,
      credit_card_price_cents: 475,
      machine_price_cents: 450,
      price_cents: 475,
      quantity: null,
      par: 12,
      missing_stock_by_mdb: 3,
      missing_stock_by_dex: 2,
      selection_vend_out_bit: 1,
      provider_last_updated_at: "2026-08-25T12:34:56.000Z",
      snapshot_at: NOW,
    });
    assert.deepEqual(f.db.prepare(`SELECT external_sale_id,provider_machine_external_id,provider_slot_external_id,
      provider_product_external_id,product_name,quantity,unit_price_cents,total_cents,authorization_cents,
      settlement_cents,currency,authorization_at,machine_authorization_at,settlement_at,sold_at,source_import_sha256
      FROM vending_provider_sales`).get(), {
      external_sale_id: "tx-official-1",
      provider_machine_external_id: "91001",
      provider_slot_external_id: null,
      provider_product_external_id: null,
      product_name: "Moon Booster",
      quantity: 2,
      unit_price_cents: 475,
      total_cents: 950,
      authorization_cents: 1000,
      settlement_cents: 950,
      currency: "USD",
      authorization_at: "2026-08-25T12:40:00.000Z",
      machine_authorization_at: "2026-08-25T12:39:59.000Z",
      settlement_at: "2026-08-25T12:45:00.000Z",
      sold_at: "2026-08-25T12:45:00.000Z",
      source_import_sha256: null,
    });

    const storedText = allDatabaseText(f.db);
    for (const forbidden of [TOKEN, CARD, CLI, ARBITRARY]) assert.equal(storedText.includes(forbidden), false);

    const snapshot = vendingIntegrationsSnapshot(f.db).providers.nayax;
    assert.equal(snapshot.unmappedRecords.slots.length, 1);
    assert.equal(snapshot.unmappedRecords.sales.length, 1);
    assert.equal(snapshot.unmappedRecords.slots[0].quantity, null);
    assert.equal(snapshot.unmappedRecords.sales[0].totalCents, 950);
    assert.equal(snapshot.unmappedRecords.sales[0].settlementCents, 950);
    const publicJson = JSON.stringify({ result, snapshot });
    for (const forbidden of [TOKEN, CARD, CLI, ARBITRARY]) assert.equal(publicJson.includes(forbidden), false);
    assert.doesNotMatch(publicJson, /CardNumber|"CLI"|source_import_sha256|sourceImportSha|fingerprint/i);

    f.db.prepare("UPDATE vending_provider_sales SET source_import_sha256=?").run(RAW_FINGERPRINT);
    const apiSnapshotJson = JSON.stringify(vendingIntegrationsSnapshot(f.db));
    assert.equal(apiSnapshotJson.includes(RAW_FINGERPRINT), false);
    assert.doesNotMatch(apiSnapshotJson, /source_import_sha256|sourceImportSha|fingerprint/i);
  } finally {
    f.close();
  }
});

test("Nayax HTTP failures discard provider response bodies and return only sanitized diagnostics", async () => {
  const f = fixture();
  try {
    const providerBody = `${ARBITRARY} ${CARD} ${CLI} ${TOKEN}`;
    let returned: VendingIntegrationError | undefined;
    await assert.rejects(
      syncNayax({
        token: TOKEN,
        db: f.db,
        now: () => NOW,
        request: async () => new Response(JSON.stringify({ message: providerBody }), { status: 500 }),
      }),
      (error: unknown) => {
        returned = error as VendingIntegrationError;
        return isCode("NAYAX_REQUEST_FAILED")(error);
      },
    );
    assert.equal(count(f.db, "vending_provider_machine_mappings"), 0);
    assert.equal(count(f.db, "vending_provider_slot_snapshots"), 0);
    assert.equal(count(f.db, "vending_provider_sales"), 0);
    const diagnostics = JSON.stringify({ returned, snapshot: vendingIntegrationsSnapshot(f.db), text: allDatabaseText(f.db) });
    for (const forbidden of [TOKEN, CARD, CLI, ARBITRARY]) assert.equal(diagnostics.includes(forbidden), false);
    assert.match(returned?.message || "", /^Nayax read request failed$/);
  } finally {
    f.close();
  }
});

test("repeated sync is idempotent and a complete later sync reconciles stale slots and products", async () => {
  const f = fixture();
  let products = [slot()];
  const injected = adapter({ products: async () => products });
  try {
    const first = await syncNayax({ adapter: injected, db: f.db, now: () => NOW });
    const repeated = await syncNayax({ adapter: injected, db: f.db, now: () => NOW });
    assert.equal(first.salesChanged, 1);
    assert.equal(repeated.salesChanged, 0);
    assert.equal(count(f.db, "vending_provider_sales"), 1);
    assert.equal(count(f.db, "vending_provider_slot_snapshots"), 1);
    assert.equal(count(f.db, "vending_provider_products"), 1);

    products = [slot({
      slotExternalId: "B2",
      machineProductExternalId: "MP-2",
      productExternalId: "P-2",
      operatorButtonCode: "B2",
      mdbCode: "002",
      dexProductName: "Booster Two",
      productName: "Booster Two",
      observedAt: "2026-08-26T13:00:00.000Z",
    })];
    await syncNayax({ adapter: injected, db: f.db, now: () => "2026-08-26T13:00:00.000Z" });
    assert.deepEqual(
      f.db.prepare("SELECT provider_slot_external_id,active,inactive_at FROM vending_provider_slot_snapshots ORDER BY provider_slot_external_id").all(),
      [
        { provider_slot_external_id: "A1", active: 0, inactive_at: "2026-08-26T13:00:00.000Z" },
        { provider_slot_external_id: "B2", active: 1, inactive_at: null },
      ],
    );
    assert.deepEqual(
      f.db.prepare("SELECT provider_product_external_id,active,inactive_at FROM vending_provider_products ORDER BY provider_product_external_id").all(),
      [
        { provider_product_external_id: "P-1", active: 0, inactive_at: "2026-08-26T13:00:00.000Z" },
        { provider_product_external_id: "P-2", active: 1, inactive_at: null },
      ],
    );
  } finally {
    f.close();
  }
});

test("a failed partial sync does not write staged records or reconcile the last complete snapshot", async () => {
  const f = fixture();
  try {
    await syncNayax({ adapter: adapter(), db: f.db, now: () => NOW });
    const failing = adapter({
      products: async () => [slot({ slotExternalId: "C3", productExternalId: "P-3", machineProductExternalId: "MP-3" })],
      sales: async () => { throw new Error(`${ARBITRARY} ${CARD}`); },
    });
    let returned: VendingIntegrationError | undefined;
    await assert.rejects(
      syncNayax({ adapter: failing, db: f.db, now: () => "2026-08-26T14:00:00.000Z" }),
      (error: unknown) => {
        returned = error as VendingIntegrationError;
        return isCode("NAYAX_SYNC_FAILED")(error);
      },
    );
    assert.deepEqual(
      f.db.prepare("SELECT provider_slot_external_id,active,inactive_at FROM vending_provider_slot_snapshots").all(),
      [{ provider_slot_external_id: "A1", active: 1, inactive_at: null }],
    );
    assert.deepEqual(
      f.db.prepare("SELECT provider_product_external_id,active,inactive_at FROM vending_provider_products").all(),
      [{ provider_product_external_id: "P-1", active: 1, inactive_at: null }],
    );
    assert.equal(count(f.db, "vending_provider_sales"), 1);
    assert.deepEqual(
      f.db.prepare("SELECT status,error_code FROM vending_provider_sync_runs ORDER BY id DESC LIMIT 1").get(),
      { status: "failed", error_code: "NAYAX_SYNC_FAILED" },
    );
    const diagnostics = JSON.stringify({ returned, snapshot: vendingIntegrationsSnapshot(f.db), text: allDatabaseText(f.db) });
    for (const forbidden of [ARBITRARY, CARD]) assert.equal(diagnostics.includes(forbidden), false);
  } finally {
    f.close();
  }
});

test("production Nayax base URL is locked to the official HTTPS operational host", () => {
  assert.doesNotThrow(() => new NayaxLynxAdapter({ token: TOKEN, baseUrl: NAYAX_LYNX_BASE_URL }));
  assert.doesNotThrow(() => new NayaxLynxAdapter({ token: TOKEN, baseUrl: `${NAYAX_LYNX_BASE_URL}/` }));
  for (const unsafe of [
    "http://lynx.nayax.com/operational",
    "https://evil.example/operational",
    "https://lynx.nayax.com/operational/v1",
    "https://lynx.nayax.com/operational?redirect=https://evil.example",
    "https://user:pass@lynx.nayax.com/operational",
  ]) {
    assert.throws(() => new NayaxLynxAdapter({ token: TOKEN, baseUrl: unsafe }), isCode("UNSAFE_NAYAX_BASE_URL"));
  }
  const serialized = JSON.stringify(new NayaxLynxAdapter({ token: TOKEN }));
  assert.equal(serialized.includes(TOKEN), false);
});

test("an unsafe Nayax base URL is rejected before acquiring a sync lease", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      syncNayax({ token: TOKEN, baseUrl: "http://lynx.nayax.com/operational", db: f.db, now: () => NOW }),
      isCode("UNSAFE_NAYAX_BASE_URL"),
    );
    assert.deepEqual(
      f.db.prepare("SELECT lease_token,lease_expires_at,last_status FROM vending_provider_sync_state").get(),
      { lease_token: null, lease_expires_at: null, last_status: "never" },
    );
    const corrected = await syncNayax({ adapter: adapter({ machines: async () => [] }), db: f.db, now: () => NOW });
    assert.equal(corrected.machinesSeen, 0);
  } finally {
    f.close();
  }
});

test("invalid currency and fractional Quantity fail with sanitized diagnostics and no normalized writes", async (t) => {
  for (const scenario of [
    { name: "invalid currency", override: { CurrencyCode: `US-${ARBITRARY}` }, code: "INVALID_CURRENCY" },
    { name: "fractional Quantity", override: { Quantity: 1.5 }, code: "INVALID_QUANTITY" },
  ]) {
    await t.test(scenario.name, async () => {
      const f = fixture();
      try {
        const payloads = officialPayloads(scenario.override);
        let returned: VendingIntegrationError | undefined;
        await assert.rejects(
          syncNayax({ token: TOKEN, db: f.db, request: officialRequest(payloads), now: () => NOW }),
          (error: unknown) => {
            returned = error as VendingIntegrationError;
            return isCode(scenario.code)(error);
          },
        );
        assert.equal(count(f.db, "vending_provider_machine_mappings"), 0);
        assert.equal(count(f.db, "vending_provider_slot_snapshots"), 0);
        assert.equal(count(f.db, "vending_provider_products"), 0);
        assert.equal(count(f.db, "vending_provider_sales"), 0);
        assert.deepEqual(
          f.db.prepare("SELECT status,error_code FROM vending_provider_sync_runs").get(),
          { status: "failed", error_code: scenario.code },
        );
        const diagnostics = JSON.stringify({ returned, snapshot: vendingIntegrationsSnapshot(f.db), text: allDatabaseText(f.db) });
        for (const forbidden of [TOKEN, CARD, CLI, ARBITRARY]) assert.equal(diagnostics.includes(forbidden), false);
      } finally {
        f.close();
      }
    });
  }
});

test("per-account lease rejects overlap and an expired lease can be recovered", async () => {
  const f = fixture();
  let releaseMachines!: (machines: Array<{ externalId: string; name: string | null }>) => void;
  const heldMachines = new Promise<Array<{ externalId: string; name: string | null }>>((resolve) => { releaseMachines = resolve; });
  const held = adapter({ machines: () => heldMachines });
  try {
    const first = syncNayax({ adapter: held, db: f.db, now: () => NOW, syncDeadlineMs: 30_000 });
    await assert.rejects(
      syncNayax({ adapter: adapter({ machines: async () => [] }), db: f.db, now: () => NOW }),
      isCode("NAYAX_SYNC_IN_PROGRESS"),
    );
    releaseMachines([]);
    await first;
    assert.equal(count(f.db, "vending_provider_sync_runs"), 1);

    const account = f.db.prepare("SELECT id FROM vending_provider_accounts WHERE provider='nayax'").get() as { id: number };
    f.db.prepare("UPDATE vending_provider_sync_state SET lease_token='stale',lease_expires_at='2026-08-26T11:59:59.000Z'").run();
    const recovered = await syncNayax({
      adapter: adapter({ machines: async () => [] }),
      db: f.db,
      now: () => "2026-08-26T12:00:01.000Z",
    });
    assert.equal(recovered.machinesSeen, 0);
    assert.deepEqual(
      f.db.prepare("SELECT lease_token,lease_expires_at,last_status FROM vending_provider_sync_state WHERE account_id=?").get(account.id),
      { lease_token: null, lease_expires_at: null, last_status: "success" },
    );
  } finally {
    releaseMachines([]);
    f.close();
  }
});

test("API snapshot exposes up to 50 recent actual unmapped slots and sales using an explicit safe allowlist", async () => {
  const f = fixture();
  const slots = Array.from({ length: 55 }, (_, i) => slot({
    slotExternalId: `S-${i}`,
    machineProductExternalId: `MP-${i}`,
    productExternalId: `P-${i}`,
    operatorButtonCode: `S-${i}`,
    observedAt: new Date(Date.parse(NOW) + i * 1000).toISOString(),
  }));
  const sales = Array.from({ length: 55 }, (_, i) => sale({
    externalSaleId: `TX-${i}`,
    soldAt: new Date(Date.parse("2026-08-25T00:00:00.000Z") + i * 60_000).toISOString(),
    settlementAt: new Date(Date.parse("2026-08-25T00:00:00.000Z") + i * 60_000).toISOString(),
  }));
  try {
    await syncNayax({ adapter: adapter({ products: async () => slots, sales: async () => sales }), db: f.db, now: () => NOW });
    f.db.prepare("UPDATE vending_provider_sales SET source_import_sha256=?").run(RAW_FINGERPRINT);
    const snapshot = vendingIntegrationsSnapshot(f.db).providers.nayax;
    assert.equal(snapshot.unmappedRecords.slots.length, 50);
    assert.equal(snapshot.unmappedRecords.sales.length, 50);
    assert.equal(snapshot.unmappedRecords.slots[0].providerSlotExternalId, "S-54");
    assert.equal(snapshot.unmappedRecords.sales[0].externalSaleId, "TX-54");
    assert.deepEqual(Object.keys(snapshot.unmappedRecords.slots[0]).sort(), [
      "active", "machineProductExternalId", "mdbCode", "missingStockByDex", "missingStockByMdb",
      "operatorButtonCode", "par", "priceCents", "productName", "providerLastUpdatedAt",
      "providerMachineExternalId", "providerProductExternalId", "providerSlotExternalId", "quantity",
      "selectionVendOutBit", "snapshotAt",
    ].sort());
    assert.deepEqual(Object.keys(snapshot.unmappedRecords.sales[0]).sort(), [
      "authorizationAt", "authorizationCents", "currency", "externalSaleId", "machineAuthorizationAt",
      "productName", "providerMachineExternalId", "providerProductExternalId", "providerSlotExternalId",
      "quantity", "settlementAt", "settlementCents", "soldAt", "totalCents", "unitPriceCents",
    ].sort());
    const json = JSON.stringify(snapshot);
    assert.equal(json.includes(RAW_FINGERPRINT), false);
    assert.doesNotMatch(json, /source_import_sha256|sourceImportSha|fingerprint|CardNumber|"CLI"/i);
  } finally {
    f.close();
  }
});
