import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ensureProviderAccount,
  setManualMachineMapping,
  upsertMachineMapping,
} from "../lib/vending-integrations/storage";
import { vendingIntegrationsSnapshot, VendingIntegrationError } from "../lib/vending-integrations";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const NOW = "2026-08-26T18:00:00.000Z";

function fixture() {
  const file = path.join(os.tmpdir(), `vending-ui-${process.pid}-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT)");
  for (const name of fs.readdirSync(path.join(root, "db/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    db.exec(read(`db/migrations/${name}`));
    db.prepare("INSERT INTO _migrations VALUES(?,?)").run(name, NOW);
  }
  const first = Number(db.prepare("INSERT INTO machines(name,location,asset_code,status) VALUES(?,?,?,'live')").run("Pokemon One", "North Lobby", "NAYAX-1").lastInsertRowid);
  const second = Number(db.prepare("INSERT INTO machines(name,location,asset_code,status) VALUES(?,?,?,'live')").run("Pokemon Two", "South Lobby", "LOCAL-2").lastInsertRowid);
  return { db, first, second, close: () => { db.close(); fs.rmSync(file, { force: true }); } };
}

function code(expected: string) {
  return (error: unknown) => error instanceof VendingIntegrationError && error.code === expected;
}

test("vending integration UI exposes provider progress, safe controls, unknown states, and manual mapping", () => {
  const component = read("components/business/VendingIntegrationsWorkspace.tsx");
  for (const label of [
    "Provider machines discovered",
    "Mapped provider machines",
    "Current provider records",
    "Official read-only API",
    "Nayax Lynx",
    "MoMa",
    "Separate API / token",
    "No supported public API is proven",
    "Order list .xlsx",
    "Optional fallback: user-converted CSV",
    "Current aisle / slot inventory",
    "Recent unmapped provider records",
    "Mapping needed",
    "Unknown values stay unknown—not zero",
  ]) assert.match(component, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(component, /\/api\/vending\/integrations\/nayax\/sync/);
  assert.match(component, /\/api\/vending\/integrations\/vtm\/import/);
  assert.match(component, /\/api\/vending\/integrations\/mappings/);
  assert.match(component, /type="file"/);
  assert.match(component, /disabled=\{!nayax\.connection\.configured/);
  assert.match(component, /role=\{feedback\.tone === "error" \? "alert" : "status"\}/);
  assert.match(component, /aria-busy/);
  assert.doesNotMatch(component, /source_import_sha256|sourceImportSha|fingerprint|CardNumber|type="password"/i);
});

test("vending integration workspace is mounted on Integrations and below the Locations machine map without duplicate fleet fetch", () => {
  const integrationsPage = read("app/business/integrations/page.tsx");
  const locations = read("components/business/LocationsWorkspace.tsx");
  const component = read("components/business/VendingIntegrationsWorkspace.tsx");
  assert.match(integrationsPage, /<VendingIntegrationsWorkspace \/>/);
  assert.match(integrationsPage, /ConnectionsPanel expanded/);
  assert.match(locations, /Machine service priority[\s\S]*<VendingIntegrationsWorkspace[\s\S]*Placement board/);
  assert.match(locations, /localFleet=\{service\?\.machines \?\? null\}/);
  assert.match(component, /const standalone = localFleet === undefined/);
  assert.match(component, /if \(!standalone\) return/);
});

test("manual mapping route is authenticated, allowlists request fields, and returns a fresh safe snapshot", () => {
  const route = read("app/api/vending/integrations/mappings/route.ts");
  assert.match(route, /await requireUser\(\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /provider: body\.provider/);
  assert.match(route, /providerMachineExternalId: body\.providerMachineExternalId/);
  assert.match(route, /localMachineId: body\.localMachineId/);
  assert.match(route, /vendingIntegrationsSnapshot\(\)/);
  assert.match(route, /cache-control": "no-store"/);
  assert.doesNotMatch(route, /\.\.\.body/);
});

test("manual mapping storage rejects invented provider machines and nonexistent local machines", () => {
  const f = fixture();
  try {
    const account = ensureProviderAccount("nayax", f.db);
    upsertMachineMapping(account, { externalId: "DISCOVERED-1", name: "Provider One" }, NOW, f.db);

    assert.throws(() => setManualMachineMapping({ provider: "nayax", providerMachineExternalId: "INVENTED", localMachineId: f.first }, f.db), code("PROVIDER_MACHINE_NOT_FOUND"));
    assert.throws(() => setManualMachineMapping({ provider: "vtm", providerMachineExternalId: "DISCOVERED-1", localMachineId: f.first }, f.db), code("PROVIDER_MACHINE_NOT_FOUND"));
    assert.throws(() => setManualMachineMapping({ provider: "other", providerMachineExternalId: "DISCOVERED-1", localMachineId: f.first }, f.db), code("INVALID_PROVIDER"));
    assert.throws(() => setManualMachineMapping({ provider: "nayax", providerMachineExternalId: "DISCOVERED-1", localMachineId: 999999 }, f.db), code("LOCAL_MACHINE_NOT_FOUND"));
    assert.throws(() => setManualMachineMapping({ provider: "nayax", providerMachineExternalId: "DISCOVERED-1", localMachineId: "1" }, f.db), code("INVALID_LOCAL_MACHINE_ID"));

    const row = f.db.prepare("SELECT local_machine_id,mapping_source FROM vending_provider_machine_mappings WHERE provider_machine_external_id='DISCOVERED-1'").get();
    assert.deepEqual(row, { local_machine_id: null, mapping_source: "unmapped" });
  } finally {
    f.close();
  }
});

test("manual map and explicit manual unmap persist across later provider syncs", () => {
  const f = fixture();
  try {
    const account = ensureProviderAccount("nayax", f.db);
    const automatic = upsertMachineMapping(account, { externalId: "NAYAX-1", name: "Provider Auto Match" }, NOW, f.db);
    assert.deepEqual({ local: automatic.local_machine_id, source: automatic.mapping_source }, { local: f.first, source: "external_id" });

    const mapped = setManualMachineMapping({ provider: "nayax", providerMachineExternalId: "NAYAX-1", localMachineId: f.second }, f.db);
    assert.deepEqual({ local: mapped.local_machine_id, source: mapped.mapping_source }, { local: f.second, source: "manual" });
    assert.equal(vendingIntegrationsSnapshot(f.db).providers.nayax.mappedMachines[0].localMachineId, f.second);

    const unmapped = setManualMachineMapping({ provider: "nayax", providerMachineExternalId: "NAYAX-1", localMachineId: null }, f.db);
    assert.deepEqual({ local: unmapped.local_machine_id, source: unmapped.mapping_source }, { local: null, source: "manual" });

    const afterSync = upsertMachineMapping(account, { externalId: "NAYAX-1", name: "Provider Auto Match" }, "2026-08-26T19:00:00.000Z", f.db);
    assert.deepEqual({ local: afterSync.local_machine_id, source: afterSync.mapping_source }, { local: null, source: "manual" });
    const safe = JSON.stringify(vendingIntegrationsSnapshot(f.db));
    assert.doesNotMatch(safe, /source_import_sha256|sourceImportSha|fingerprint/i);
  } finally {
    f.close();
  }
});
