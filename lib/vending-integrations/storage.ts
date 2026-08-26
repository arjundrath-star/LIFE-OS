import "./server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/db";
import { VendingIntegrationError, type NormalizedProviderMachine, type NormalizedProviderSale, type NormalizedProviderSlot, type ProviderMode, type VendingProvider } from "./types";

type MappingRow = {
  id: number;
  local_machine_id: number | null;
  mapping_source: "external_id" | "exact_name" | "manual" | "unmapped";
};

export function database(db?: Database.Database): Database.Database {
  return db || getDb();
}

export function ensureProviderAccount(provider: VendingProvider, dbArg?: Database.Database): number {
  const db = database(dbArg);
  const displayName = provider === "nayax" ? "Nayax Lynx" : "VTM Order list (.xlsx)";
  db.prepare(`INSERT INTO vending_provider_accounts(provider,external_account_id,display_name)
    VALUES (?,'default',?) ON CONFLICT(provider,external_account_id) DO UPDATE SET display_name=excluded.display_name`).run(provider, displayName);
  const row = db.prepare("SELECT id FROM vending_provider_accounts WHERE provider=? AND external_account_id='default'").get(provider) as { id: number };
  db.prepare("INSERT OR IGNORE INTO vending_provider_sync_state(account_id) VALUES (?)").run(row.id);
  return row.id;
}

function automaticLocalMachine(externalId: string, name: string | null, db: Database.Database): { id: number; source: "external_id" | "exact_name" } | null {
  const byAsset = db.prepare("SELECT id FROM machines WHERE asset_code IS NOT NULL AND lower(trim(asset_code))=lower(trim(?)) ORDER BY id").all(externalId) as { id: number }[];
  if (byAsset.length === 1) return { id: byAsset[0].id, source: "external_id" };
  if (!name) return null;
  const byName = db.prepare("SELECT id FROM machines WHERE lower(trim(name))=lower(trim(?)) ORDER BY id").all(name) as { id: number }[];
  return byName.length === 1 ? { id: byName[0].id, source: "exact_name" } : null;
}

export function upsertMachineMapping(accountId: number, machine: NormalizedProviderMachine, seenAt: string, dbArg?: Database.Database): MappingRow {
  const db = database(dbArg);
  const prior = db.prepare(`SELECT id,local_machine_id,mapping_source FROM vending_provider_machine_mappings
    WHERE account_id=? AND provider_machine_external_id=?`).get(accountId, machine.externalId) as MappingRow | undefined;
  // A manual unmap is intentional. Do not silently undo it on the next provider sync
  // just because the provider id/name happens to match a local machine again.
  const manuallyManaged = prior?.mapping_source === "manual";
  const automatic = prior?.local_machine_id || manuallyManaged ? null : automaticLocalMachine(machine.externalId, machine.name, db);
  const localId = manuallyManaged ? prior.local_machine_id : prior?.local_machine_id ?? automatic?.id ?? null;
  const source = manuallyManaged ? "manual" : prior?.local_machine_id ? prior.mapping_source : automatic?.source ?? "unmapped";

  db.prepare(`INSERT INTO vending_provider_machine_mappings
      (account_id,provider_machine_external_id,provider_machine_name,local_machine_id,mapping_source,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(account_id,provider_machine_external_id) DO UPDATE SET
      provider_machine_name=excluded.provider_machine_name,
      local_machine_id=CASE WHEN vending_provider_machine_mappings.local_machine_id IS NOT NULL
        THEN vending_provider_machine_mappings.local_machine_id ELSE excluded.local_machine_id END,
      mapping_source=CASE WHEN vending_provider_machine_mappings.local_machine_id IS NOT NULL
        THEN vending_provider_machine_mappings.mapping_source ELSE excluded.mapping_source END,
      last_seen_at=excluded.last_seen_at`).run(accountId, machine.externalId, machine.name, localId, source, seenAt, seenAt);
  return db.prepare(`SELECT id,local_machine_id,mapping_source FROM vending_provider_machine_mappings
    WHERE account_id=? AND provider_machine_external_id=?`).get(accountId, machine.externalId) as MappingRow;
}

export type ManualMachineMappingInput = {
  provider: unknown;
  providerMachineExternalId: unknown;
  localMachineId: unknown;
};

/** Map only a provider machine that ingestion has already discovered. */
export function setManualMachineMapping(input: ManualMachineMappingInput, dbArg?: Database.Database): MappingRow {
  const db = database(dbArg);
  if (input.provider !== "nayax" && input.provider !== "vtm") {
    throw new VendingIntegrationError("INVALID_PROVIDER", "Provider must be nayax or vtm", 400);
  }
  if (typeof input.providerMachineExternalId !== "string") {
    throw new VendingIntegrationError("INVALID_PROVIDER_MACHINE_ID", "Provider machine id is required", 400);
  }
  const externalId = input.providerMachineExternalId.trim();
  if (!externalId || externalId.length > 200) {
    throw new VendingIntegrationError("INVALID_PROVIDER_MACHINE_ID", "Provider machine id is invalid", 400);
  }
  if (input.localMachineId !== null && (!Number.isInteger(input.localMachineId) || Number(input.localMachineId) <= 0)) {
    throw new VendingIntegrationError("INVALID_LOCAL_MACHINE_ID", "Local machine id must be a positive integer or null", 400);
  }

  let result: MappingRow | undefined;
  db.transaction(() => {
    const account = db.prepare("SELECT id FROM vending_provider_accounts WHERE provider=? AND external_account_id='default'")
      .get(input.provider) as { id: number } | undefined;
    const mapping = account
      ? db.prepare(`SELECT id,local_machine_id,mapping_source FROM vending_provider_machine_mappings
          WHERE account_id=? AND provider_machine_external_id=?`).get(account.id, externalId) as MappingRow | undefined
      : undefined;
    if (!mapping) {
      throw new VendingIntegrationError("PROVIDER_MACHINE_NOT_FOUND", "Provider machine has not been discovered", 404);
    }
    if (input.localMachineId !== null) {
      const local = db.prepare("SELECT id FROM machines WHERE id=?").get(input.localMachineId) as { id: number } | undefined;
      if (!local) throw new VendingIntegrationError("LOCAL_MACHINE_NOT_FOUND", "Local machine was not found", 404);
    }
    db.prepare(`UPDATE vending_provider_machine_mappings
      SET local_machine_id=?,mapping_source='manual' WHERE id=?`).run(input.localMachineId, mapping.id);
    result = db.prepare(`SELECT id,local_machine_id,mapping_source FROM vending_provider_machine_mappings WHERE id=?`)
      .get(mapping.id) as MappingRow;
  }).immediate();
  return result!;
}

function upsertProduct(accountId: number, externalId: string, name: string | null, observedAt: string, db: Database.Database): number {
  db.prepare(`INSERT INTO vending_provider_products
      (account_id,provider_product_external_id,product_name,active,first_seen_at,last_seen_at,inactive_at)
    VALUES (?,?,?,1,?,?,NULL)
    ON CONFLICT(account_id,provider_product_external_id) DO UPDATE SET
      product_name=COALESCE(excluded.product_name,vending_provider_products.product_name),
      active=1,last_seen_at=excluded.last_seen_at,inactive_at=NULL`).run(accountId, externalId, name, observedAt, observedAt);
  return (db.prepare(`SELECT id FROM vending_provider_products WHERE account_id=? AND provider_product_external_id=?`).get(accountId, externalId) as { id: number }).id;
}

export function upsertSlot(accountId: number, mappingId: number | null, slot: NormalizedProviderSlot, dbArg?: Database.Database): void {
  const db = database(dbArg);
  const providerProductId = slot.productExternalId
    ? upsertProduct(accountId, slot.productExternalId, slot.productName || slot.dexProductName, slot.observedAt, db)
    : null;
  db.prepare(`INSERT INTO vending_provider_slot_snapshots
      (account_id,machine_mapping_id,provider_product_id,provider_machine_external_id,provider_slot_external_id,
       machine_product_external_id,provider_product_external_id,operator_button_code,mdb_code,dex_product_name,
       product_name,cash_price_cents,credit_card_price_cents,machine_price_cents,price_cents,quantity,par,
       missing_stock_by_mdb,missing_stock_by_dex,selection_vend_out_bit,provider_last_updated_at,active,inactive_at,
       snapshot_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,?)
    ON CONFLICT(account_id,provider_machine_external_id,provider_slot_external_id) DO UPDATE SET
      machine_mapping_id=excluded.machine_mapping_id,provider_product_id=excluded.provider_product_id,
      machine_product_external_id=excluded.machine_product_external_id,
      provider_product_external_id=excluded.provider_product_external_id,
      operator_button_code=excluded.operator_button_code,mdb_code=excluded.mdb_code,
      dex_product_name=excluded.dex_product_name,product_name=excluded.product_name,
      cash_price_cents=excluded.cash_price_cents,credit_card_price_cents=excluded.credit_card_price_cents,
      machine_price_cents=excluded.machine_price_cents,price_cents=excluded.price_cents,quantity=excluded.quantity,
      par=excluded.par,missing_stock_by_mdb=excluded.missing_stock_by_mdb,
      missing_stock_by_dex=excluded.missing_stock_by_dex,selection_vend_out_bit=excluded.selection_vend_out_bit,
      provider_last_updated_at=excluded.provider_last_updated_at,active=1,inactive_at=NULL,
      snapshot_at=excluded.snapshot_at,updated_at=excluded.updated_at`).run(
        accountId, mappingId, providerProductId, slot.machineExternalId, slot.slotExternalId,
        slot.machineProductExternalId, slot.productExternalId, slot.operatorButtonCode, slot.mdbCode,
        slot.dexProductName, slot.productName, slot.cashPriceCents, slot.creditCardPriceCents,
        slot.machinePriceCents, slot.priceCents, slot.quantity, slot.par, slot.missingStockByMdb,
        slot.missingStockByDex, slot.selectionVendOutBit === null ? null : slot.selectionVendOutBit ? 1 : 0,
        slot.providerLastUpdatedAt, slot.observedAt, slot.observedAt,
      );
}

/** Call only after every machine-products request in a sync completed successfully. */
export function beginCompleteSlotReconciliation(accountId: number, at: string, dbArg?: Database.Database): void {
  const db = database(dbArg);
  db.prepare(`UPDATE vending_provider_slot_snapshots SET active=0,inactive_at=?,updated_at=? WHERE account_id=? AND active=1`).run(at, at, accountId);
  db.prepare(`UPDATE vending_provider_products SET active=0,inactive_at=? WHERE account_id=? AND active=1`).run(at, accountId);
}

export function upsertSale(
  accountId: number,
  mappingId: number | null,
  sale: NormalizedProviderSale,
  now: string,
  sourceImportSha256: string | null,
  dbArg?: Database.Database,
): { inserted: boolean } {
  const db = database(dbArg);
  const prior = db.prepare("SELECT 1 FROM vending_provider_sales WHERE account_id=? AND external_sale_id=?").get(accountId, sale.externalSaleId);
  db.prepare(`INSERT INTO vending_provider_sales
      (account_id,machine_mapping_id,external_sale_id,provider_machine_external_id,provider_machine_name,
       provider_account_label,provider_slot_external_id,provider_product_external_id,product_name,quantity,unit_price_cents,total_cents,
       authorization_cents,settlement_cents,cost_price_cents,retail_price_cents,currency,authorization_at,
       machine_authorization_at,settlement_at,sold_at,order_status,source_import_sha256,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,external_sale_id) DO UPDATE SET
      machine_mapping_id=excluded.machine_mapping_id,provider_machine_external_id=excluded.provider_machine_external_id,
      provider_machine_name=excluded.provider_machine_name,provider_account_label=excluded.provider_account_label,
      provider_slot_external_id=excluded.provider_slot_external_id,
      provider_product_external_id=excluded.provider_product_external_id,product_name=excluded.product_name,
      quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,total_cents=excluded.total_cents,
      authorization_cents=excluded.authorization_cents,settlement_cents=excluded.settlement_cents,
      cost_price_cents=excluded.cost_price_cents,retail_price_cents=excluded.retail_price_cents,
      currency=excluded.currency,authorization_at=excluded.authorization_at,
      machine_authorization_at=excluded.machine_authorization_at,settlement_at=excluded.settlement_at,
      sold_at=excluded.sold_at,order_status=excluded.order_status,
      source_import_sha256=COALESCE(vending_provider_sales.source_import_sha256,excluded.source_import_sha256),
      updated_at=excluded.updated_at`).run(
        accountId, mappingId, sale.externalSaleId, sale.machineExternalId, sale.machineName, sale.providerAccountLabel,
        sale.slotExternalId, sale.productExternalId, sale.productName, sale.quantity, sale.unitPriceCents,
        sale.totalCents, sale.authorizationCents, sale.settlementCents, sale.costPriceCents,
        sale.retailPriceCents, sale.currency, sale.authorizationAt, sale.machineAuthorizationAt,
        sale.settlementAt, sale.soldAt, sale.orderStatus, sourceImportSha256, now, now,
      );
  return { inserted: !prior };
}

export function acquireSyncLease(accountId: number, token: string, acquiredAt: string, expiresAt: string, dbArg?: Database.Database): boolean {
  const db = database(dbArg);
  let acquired = false;
  db.transaction(() => {
    const result = db.prepare(`UPDATE vending_provider_sync_state SET lease_token=?,lease_expires_at=?,updated_at=?
      WHERE account_id=? AND (lease_token IS NULL OR lease_expires_at<=?)`).run(token, expiresAt, acquiredAt, accountId, acquiredAt);
    acquired = result.changes === 1;
  }).immediate();
  return acquired;
}

export function releaseSyncLease(accountId: number, token: string, at: string, dbArg?: Database.Database): void {
  database(dbArg).prepare(`UPDATE vending_provider_sync_state SET lease_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE account_id=? AND lease_token=?`).run(at, accountId, token);
}

export function beginSyncRun(accountId: number, mode: ProviderMode, now: string, sourceSha256: string | null, dbArg?: Database.Database): number {
  const result = database(dbArg).prepare(`INSERT INTO vending_provider_sync_runs(account_id,mode,source_sha256,status,started_at)
    VALUES (?,?,?,'running',?)`).run(accountId, mode, sourceSha256, now);
  return Number(result.lastInsertRowid);
}

export function finishSyncRun(runId: number, status: "success" | "failed" | "blocked", values: {
  completedAt: string;
  machinesSeen?: number;
  slotsSeen?: number;
  salesSeen?: number;
  salesChanged?: number;
  unmappedRecords?: number;
  errorCode?: string | null;
}, dbArg?: Database.Database): void {
  database(dbArg).prepare(`UPDATE vending_provider_sync_runs SET status=?,completed_at=?,machines_seen=?,slots_seen=?,sales_seen=?,sales_changed=?,unmapped_records=?,error_code=? WHERE id=?`).run(
    status, values.completedAt, values.machinesSeen || 0, values.slotsSeen || 0, values.salesSeen || 0,
    values.salesChanged || 0, values.unmappedRecords || 0, values.errorCode || null, runId,
  );
}

export function updateSyncState(accountId: number, status: "running" | "success" | "failed" | "blocked", values: {
  at: string;
  successful?: boolean;
  errorCode?: string | null;
  machinesSeen?: number;
  slotsSeen?: number;
  salesSeen?: number;
}, dbArg?: Database.Database): void {
  database(dbArg).prepare(`UPDATE vending_provider_sync_state SET
      last_attempt_at=?,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,
      last_status=?,last_error_code=?,machines_seen=?,slots_seen=?,sales_seen=?,updated_at=?
    WHERE account_id=?`).run(
      values.at, values.successful ? 1 : 0, values.at, status, values.errorCode || null,
      values.machinesSeen || 0, values.slotsSeen || 0, values.salesSeen || 0, values.at, accountId,
    );
}
