import "./server-only";
import type Database from "better-sqlite3";
import { hasSecret } from "@/lib/secrets";
import { database, ensureProviderAccount } from "./storage";

function diagnostic(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value) ? value : null;
}

function providerSnapshot(provider: "nayax" | "vtm", db: Database.Database) {
  const accountId = ensureProviderAccount(provider, db);
  const sync = db.prepare(`SELECT last_attempt_at,last_success_at,last_status,last_error_code,machines_seen,slots_seen,sales_seen
    FROM vending_provider_sync_state WHERE account_id=?`).get(accountId) as any;
  const mappings = db.prepare(`SELECT pm.provider_machine_external_id,pm.provider_machine_name,pm.local_machine_id,pm.mapping_source,
      pm.first_seen_at,pm.last_seen_at,m.name AS local_machine_name,m.location AS local_machine_location
    FROM vending_provider_machine_mappings pm LEFT JOIN machines m ON m.id=pm.local_machine_id
    WHERE pm.account_id=? ORDER BY pm.provider_machine_name,pm.provider_machine_external_id`).all(accountId) as any[];
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM vending_provider_machine_mappings WHERE account_id=?) machineMappings,
      (SELECT COUNT(*) FROM vending_provider_machine_mappings WHERE account_id=? AND local_machine_id IS NULL) unmappedMachines,
      (SELECT COUNT(*) FROM vending_provider_slot_snapshots WHERE account_id=?) slotSnapshots,
      (SELECT COUNT(*) FROM vending_provider_sales WHERE account_id=?) sales,
      (SELECT COUNT(*) FROM vending_provider_sync_runs WHERE account_id=?) syncRuns`).get(accountId, accountId, accountId, accountId, accountId) as any;
  const lastRun = db.prepare(`SELECT mode,status,started_at,completed_at,machines_seen,slots_seen,sales_seen,sales_changed,unmapped_records,error_code
    FROM vending_provider_sync_runs WHERE account_id=? ORDER BY id DESC LIMIT 1`).get(accountId) as any;
  // These are deliberately explicit projections. Never select or spread a provider row here:
  // snapshots are an API surface and must not grow to include raw imports, fingerprints, or PII.
  const unmappedSlots = db.prepare(`SELECT
      s.provider_machine_external_id,s.provider_slot_external_id,s.machine_product_external_id,
      s.provider_product_external_id,s.operator_button_code,s.mdb_code,s.product_name,
      s.price_cents,s.quantity,s.par,s.missing_stock_by_mdb,s.missing_stock_by_dex,
      s.selection_vend_out_bit,s.provider_last_updated_at,s.active,s.snapshot_at
    FROM vending_provider_slot_snapshots s
    LEFT JOIN vending_provider_machine_mappings pm ON pm.id=s.machine_mapping_id
    WHERE s.account_id=? AND (s.machine_mapping_id IS NULL OR pm.local_machine_id IS NULL)
    ORDER BY s.updated_at DESC,s.id DESC LIMIT 50`).all(accountId) as any[];
  const unmappedSales = db.prepare(`SELECT
      s.external_sale_id,s.provider_machine_external_id,s.provider_slot_external_id,
      s.provider_product_external_id,s.product_name,s.quantity,s.unit_price_cents,s.total_cents,
      s.authorization_cents,s.settlement_cents,s.currency,s.authorization_at,
      s.machine_authorization_at,s.settlement_at,s.sold_at
    FROM vending_provider_sales s
    LEFT JOIN vending_provider_machine_mappings pm ON pm.id=s.machine_mapping_id
    WHERE s.account_id=? AND (s.machine_mapping_id IS NULL OR pm.local_machine_id IS NULL)
    ORDER BY s.sold_at DESC,s.id DESC LIMIT 50`).all(accountId) as any[];
  const blockers: string[] = [];
  if (provider === "nayax" && !hasSecret("NAYAX_LYNX_TOKEN")) blockers.push("NAYAX_TOKEN_MISSING");
  if (provider === "vtm") blockers.push("VTM_API_UNDOCUMENTED_USE_ORDER_LIST_XLSX_IMPORT");
  if (sync?.last_status === "failed" && diagnostic(sync.last_error_code)) blockers.push(sync.last_error_code);
  if (counts.unmappedMachines > 0) blockers.push("UNMAPPED_PROVIDER_MACHINES");
  return {
    provider,
    connection: {
      configured: provider === "nayax" ? hasSecret("NAYAX_LYNX_TOKEN") : true,
      access: provider === "nayax" ? "official_read_only_api" : "official_order_list_xlsx_import",
      status: sync?.last_status || "never",
    },
    sync: {
      lastAttemptAt: sync?.last_attempt_at || null,
      lastSuccessAt: sync?.last_success_at || null,
      lastStatus: sync?.last_status || "never",
      lastErrorCode: diagnostic(sync?.last_error_code),
      machinesSeen: sync?.machines_seen || 0,
      slotsSeen: sync?.slots_seen || 0,
      salesSeen: sync?.sales_seen || 0,
    },
    mappedMachines: mappings.map((row) => ({
      providerMachineExternalId: row.provider_machine_external_id,
      providerMachineName: row.provider_machine_name,
      localMachineId: row.local_machine_id,
      localMachineName: row.local_machine_name || null,
      localMachineLocation: row.local_machine_location || null,
      mappingSource: row.mapping_source,
      mapped: row.local_machine_id !== null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    })),
    unmappedRecords: {
      slots: unmappedSlots.map((row) => ({
        providerMachineExternalId: row.provider_machine_external_id,
        providerSlotExternalId: row.provider_slot_external_id,
        machineProductExternalId: row.machine_product_external_id,
        providerProductExternalId: row.provider_product_external_id,
        operatorButtonCode: row.operator_button_code,
        mdbCode: row.mdb_code,
        productName: row.product_name,
        priceCents: row.price_cents,
        quantity: row.quantity,
        par: row.par,
        missingStockByMdb: row.missing_stock_by_mdb,
        missingStockByDex: row.missing_stock_by_dex,
        selectionVendOutBit: row.selection_vend_out_bit === null ? null : row.selection_vend_out_bit === 1,
        providerLastUpdatedAt: row.provider_last_updated_at,
        active: row.active === 1,
        snapshotAt: row.snapshot_at,
      })),
      sales: unmappedSales.map((row) => ({
        externalSaleId: row.external_sale_id,
        providerMachineExternalId: row.provider_machine_external_id,
        providerSlotExternalId: row.provider_slot_external_id,
        providerProductExternalId: row.provider_product_external_id,
        productName: row.product_name,
        quantity: row.quantity,
        unitPriceCents: row.unit_price_cents,
        totalCents: row.total_cents,
        authorizationCents: row.authorization_cents,
        settlementCents: row.settlement_cents,
        currency: row.currency,
        authorizationAt: row.authorization_at,
        machineAuthorizationAt: row.machine_authorization_at,
        settlementAt: row.settlement_at,
        soldAt: row.sold_at,
      })),
    },
    counts,
    lastRun: lastRun ? {
      mode: lastRun.mode,
      status: lastRun.status,
      startedAt: lastRun.started_at,
      completedAt: lastRun.completed_at,
      machinesSeen: lastRun.machines_seen,
      slotsSeen: lastRun.slots_seen,
      salesSeen: lastRun.sales_seen,
      salesChanged: lastRun.sales_changed,
      unmappedRecords: lastRun.unmapped_records,
      errorCode: diagnostic(lastRun.error_code),
    } : null,
    blockers: [...new Set(blockers)],
  };
}

export function vendingIntegrationsSnapshot(dbArg?: Database.Database) {
  const db = database(dbArg);
  const nayax = providerSnapshot("nayax", db);
  const vtm = providerSnapshot("vtm", db);
  return {
    generatedAt: new Date().toISOString(),
    providers: { nayax, vtm },
    surfaces: {
      moma: {
        provider: "nayax" as const,
        companionOnly: true,
        separateApi: false,
        status: nayax.connection.status,
        configured: nayax.connection.configured,
        note: "MoMa is a companion surface for the same Nayax platform/account; it is not synced as a separate API.",
        blockers: nayax.blockers,
      },
    },
  };
}

export { moneyToCents } from "./normalize";
export { NayaxLynxAdapter, NAYAX_LYNX_BASE_URL, syncNayax } from "./nayax";
export {
  importVtmCsv,
  importVtmExport,
  validateVtmUpload,
  VTM_CONVERTED_CSV_CONTENT_TYPES,
  VTM_CSV_CONTENT_TYPES,
  VTM_EXPORT_CONTENT_TYPES,
  VTM_MAX_CSV_BYTES,
  VTM_MAX_EXPORT_BYTES,
  VTM_XLSX_CONTENT_TYPES,
} from "./vtm";
export { readBoundedVtmMultipartRequest, VTM_MULTIPART_OVERHEAD_ALLOWANCE } from "./vtm-upload";
export { setManualMachineMapping } from "./storage";
export type { ManualMachineMappingInput } from "./storage";
export { VendingIntegrationError } from "./types";
export type { NormalizedProviderMachine, NormalizedProviderSale, NormalizedProviderSlot, ReadOnlyProviderAdapter, VendingProvider } from "./types";
