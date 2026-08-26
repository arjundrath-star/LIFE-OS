import "./server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { secret } from "@/lib/secrets";
import {
  first, optionalBoolean, optionalMoneyToCents, optionalNonnegativeInteger, optionalUtcIso,
  positiveInteger, requireExternalId, safeCurrency, text,
} from "./normalize";
import {
  acquireSyncLease, beginCompleteSlotReconciliation, beginSyncRun, ensureProviderAccount, finishSyncRun,
  releaseSyncLease, updateSyncState, upsertMachineMapping, upsertSale, upsertSlot,
} from "./storage";
import type { FetchLike, NormalizedProviderMachine, NormalizedProviderSale, NormalizedProviderSlot, ReadOnlyProviderAdapter } from "./types";
import { VendingIntegrationError } from "./types";

export const NAYAX_LYNX_BASE_URL = "https://lynx.nayax.com/operational";
export const NAYAX_DEFAULT_SYNC_DEADLINE_MS = 120_000;
export const NAYAX_DEFAULT_LEASE_MS = 180_000;
const TOKENS = new globalThis.WeakMap<NayaxLynxAdapter, string>();

export interface NayaxAdapterOptions {
  token: string;
  baseUrl?: string;
  request?: FetchLike;
  timeoutMs?: number;
  now?: () => string;
  signal?: AbortSignal;
}

function safeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new VendingIntegrationError("UNSAFE_NAYAX_BASE_URL", "Nayax base URL is not allowed"); }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || normalized !== NAYAX_LYNX_BASE_URL) {
    throw new VendingIntegrationError("UNSAFE_NAYAX_BASE_URL", "Nayax base URL is not allowed");
  }
  return normalized;
}

function records(payload: unknown, labels: readonly string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  if (!payload || typeof payload !== "object") throw new VendingIntegrationError("NAYAX_INVALID_SCHEMA", "Nayax returned an invalid response", 502);
  const object = payload as Record<string, unknown>;
  for (const label of [...labels, "data", "Data", "items", "Items", "records", "Records"]) {
    if (Array.isArray(object[label])) return records(object[label], labels);
  }
  throw new VendingIntegrationError("NAYAX_INVALID_SCHEMA", "Nayax returned an invalid response", 502);
}

function deterministicSlotId(row: Record<string, unknown>): string {
  return requireExternalId(first(row, ["OperatorButtonCode", "MDBCode", "MachineProductID"]), "slot");
}

export class NayaxLynxAdapter implements ReadOnlyProviderAdapter {
  readonly provider = "nayax" as const;
  readonly mode = "api" as const;
  private readonly baseUrl: string;
  private readonly request: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => string;
  private readonly overallSignal?: AbortSignal;

  constructor(options: NayaxAdapterOptions) {
    if (!options.token.trim()) throw new VendingIntegrationError("NAYAX_TOKEN_MISSING", "Nayax Lynx token is not configured", 409);
    this.baseUrl = safeBaseUrl(options.baseUrl || NAYAX_LYNX_BASE_URL);
    this.request = options.request || fetch;
    this.timeoutMs = Math.max(100, Math.min(options.timeoutMs || 10_000, 30_000));
    this.now = options.now || (() => new Date().toISOString());
    this.overallSignal = options.signal;
    TOKENS.set(this, options.token.trim());
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const abortOverall = () => controller.abort();
    if (this.overallSignal?.aborted) controller.abort();
    else this.overallSignal?.addEventListener("abort", abortOverall, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${TOKENS.get(this)!}`, accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new VendingIntegrationError("NAYAX_REQUEST_FAILED", "Nayax read request failed", 502);
      try { return await response.json(); }
      catch { throw new VendingIntegrationError("NAYAX_INVALID_JSON", "Nayax returned an invalid response", 502); }
    } catch (error) {
      if (error instanceof VendingIntegrationError) throw error;
      if ((error as Error)?.name === "AbortError") {
        if (this.overallSignal?.aborted) throw new VendingIntegrationError("NAYAX_SYNC_DEADLINE", "Nayax sync exceeded its deadline", 504);
        throw new VendingIntegrationError("NAYAX_TIMEOUT", "Nayax read request timed out", 504);
      }
      throw new VendingIntegrationError("NAYAX_REQUEST_FAILED", "Nayax read request failed", 502);
    } finally {
      clearTimeout(timeout);
      this.overallSignal?.removeEventListener("abort", abortOverall);
    }
  }

  async listMachines(): Promise<NormalizedProviderMachine[]> {
    const payload = await this.get("/v1/machines");
    return records(payload, ["machines", "Machines"]).map((row) => ({
      externalId: requireExternalId(first(row, ["MachineID", "MachineId", "machineId", "machine_id", "ID", "id"]), "machine"),
      name: text(first(row, ["MachineName", "machineName", "Name", "name", "MachineNumber"])),
    }));
  }

  async listMachineProducts(machineExternalId: string): Promise<NormalizedProviderSlot[]> {
    const payload = await this.get(`/v1/machines/${encodeURIComponent(machineExternalId)}/machineProducts`);
    const observedAt = this.now();
    return records(payload, ["machineProducts", "MachineProducts", "products", "Products"]).map((row) => {
      const machineProductExternalId = text(first(row, ["MachineProductID"]));
      const productExternalId = text(first(row, ["NayaxProductID"])) || machineProductExternalId;
      const operatorButtonCode = text(first(row, ["OperatorButtonCode"]));
      const mdbCode = text(first(row, ["MDBCode"]));
      const dexProductName = text(first(row, ["DEXProductName"]));
      const cashPriceCents = optionalMoneyToCents(first(row, ["CashPrice"]));
      const creditCardPriceCents = optionalMoneyToCents(first(row, ["CreditCardPrice"]));
      const machinePriceCents = optionalMoneyToCents(first(row, ["MachinePrice"]));
      return {
        machineExternalId: text(first(row, ["MachineID"])) || machineExternalId,
        slotExternalId: deterministicSlotId(row),
        machineProductExternalId,
        productExternalId,
        operatorButtonCode,
        mdbCode,
        dexProductName,
        productName: dexProductName,
        cashPriceCents,
        creditCardPriceCents,
        machinePriceCents,
        priceCents: creditCardPriceCents ?? machinePriceCents ?? cashPriceCents,
        // Official machineProducts has PAR/missing-stock signals, not current on-hand quantity.
        quantity: null,
        par: optionalNonnegativeInteger(first(row, ["PAR"])),
        missingStockByMdb: optionalNonnegativeInteger(first(row, ["MissingStockByMDB"])),
        missingStockByDex: optionalNonnegativeInteger(first(row, ["MissingStockByDEX"])),
        selectionVendOutBit: optionalBoolean(first(row, ["SelectionVendOutBit"])),
        providerLastUpdatedAt: optionalUtcIso(first(row, ["LastUpdated"])),
        observedAt,
      };
    });
  }

  async listMachineSales(machineExternalId: string): Promise<NormalizedProviderSale[]> {
    const payload = await this.get(`/v1/machines/${encodeURIComponent(machineExternalId)}/lastSales`);
    return records(payload, ["lastSales", "LastSales", "sales", "Sales", "transactions", "Transactions"]).map((row) => {
      const quantity = positiveInteger(first(row, ["Quantity"]));
      const authorizationCents = optionalMoneyToCents(first(row, ["AuthorizationValue"]));
      const settlementCents = optionalMoneyToCents(first(row, ["SettlementValue"]));
      const totalCents = settlementCents ?? authorizationCents;
      if (totalCents === null) throw new VendingIntegrationError("INVALID_MONEY", "Nayax sale has no authorization or settlement value", 502);
      const authorizationAt = optionalUtcIso(first(row, ["AuthorizationDateTimeGMT"]));
      const machineAuthorizationAt = optionalUtcIso(first(row, ["MachineAuthorizationTime"]));
      const settlementAt = optionalUtcIso(first(row, ["SettlementDateTimeGMT"]));
      const soldAt = settlementAt ?? authorizationAt ?? machineAuthorizationAt;
      if (!soldAt) throw new VendingIntegrationError("INVALID_TIMESTAMP", "Nayax sale has no authorization or settlement timestamp", 502);
      return {
        externalSaleId: requireExternalId(first(row, ["TransactionID"]), "sale"),
        machineExternalId,
        machineName: null,
        providerAccountLabel: null,
        slotExternalId: null,
        productExternalId: null,
        productName: text(first(row, ["ProductName"])),
        quantity,
        unitPriceCents: totalCents % quantity === 0 ? totalCents / quantity : null,
        totalCents,
        authorizationCents,
        settlementCents,
        costPriceCents: null,
        retailPriceCents: null,
        currency: safeCurrency(first(row, ["CurrencyCode"])),
        authorizationAt,
        machineAuthorizationAt,
        settlementAt,
        soldAt,
        orderStatus: null,
      };
    });
  }
}

export interface NayaxSyncOptions {
  token?: string;
  adapter?: ReadOnlyProviderAdapter;
  db?: Database.Database;
  now?: () => string;
  request?: FetchLike;
  timeoutMs?: number;
  syncDeadlineMs?: number;
  leaseMs?: number;
  baseUrl?: string;
}

async function withinDeadline<T>(promise: Promise<T>, deadlineAt: number, controller: AbortController): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    controller.abort();
    throw new VendingIntegrationError("NAYAX_SYNC_DEADLINE", "Nayax sync exceeded its deadline", 504);
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new VendingIntegrationError("NAYAX_SYNC_DEADLINE", "Nayax sync exceeded its deadline", 504));
        }, remaining);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function syncNayax(options: NayaxSyncOptions = {}) {
  const db = options.db;
  const now = options.now || (() => new Date().toISOString());
  const accountId = ensureProviderAccount("nayax", db);
  const startedAt = now();
  const token = options.token ?? secret("NAYAX_LYNX_TOKEN");
  if (!options.adapter && !token) {
    const runId = beginSyncRun(accountId, "api", startedAt, null, db);
    finishSyncRun(runId, "blocked", { completedAt: startedAt, errorCode: "NAYAX_TOKEN_MISSING" }, db);
    updateSyncState(accountId, "blocked", { at: startedAt, errorCode: "NAYAX_TOKEN_MISSING" }, db);
    throw new VendingIntegrationError("NAYAX_TOKEN_MISSING", "Nayax Lynx token is not configured", 409);
  }

  const leaseMs = Math.max(30_000, Math.min(options.leaseMs || NAYAX_DEFAULT_LEASE_MS, 10 * 60_000));
  const syncDeadlineMs = Math.max(1_000, Math.min(options.syncDeadlineMs || NAYAX_DEFAULT_SYNC_DEADLINE_MS, leaseMs));
  const deadlineAt = Date.now() + syncDeadlineMs;
  const deadlineController = new AbortController();
  // Validate credentials/base URL before taking the account lease. Configuration errors
  // must not strand a lease and block later corrected sync attempts.
  const adapter = options.adapter || new NayaxLynxAdapter({
    token: token!, baseUrl: options.baseUrl, request: options.request, timeoutMs: options.timeoutMs,
    now, signal: deadlineController.signal,
  });
  const leaseToken = crypto.randomUUID();
  const leaseBase = Number.isFinite(Date.parse(startedAt)) ? Date.parse(startedAt) : Date.now();
  const leaseExpiresAt = new Date(leaseBase + leaseMs).toISOString();
  if (!acquireSyncLease(accountId, leaseToken, startedAt, leaseExpiresAt, db)) {
    deadlineController.abort();
    throw new VendingIntegrationError("NAYAX_SYNC_IN_PROGRESS", "A Nayax sync is already in progress", 409);
  }

  const runId = beginSyncRun(accountId, "api", startedAt, null, db);
  updateSyncState(accountId, "running", { at: startedAt }, db);
  try {
    const machines = await withinDeadline(adapter.listMachines(), deadlineAt, deadlineController);
    const collected: { machine: NormalizedProviderMachine; slots: NormalizedProviderSlot[]; sales: NormalizedProviderSale[] }[] = [];
    for (const machine of machines) {
      // Deliberately sequential: bounded provider load and deterministic reconciliation.
      const slots = await withinDeadline(adapter.listMachineProducts(machine.externalId), deadlineAt, deadlineController);
      const sales = await withinDeadline(adapter.listMachineSales(machine.externalId), deadlineAt, deadlineController);
      collected.push({ machine, slots, sales });
    }
    const completedAt = now();
    let slotsSeen = 0, salesSeen = 0, salesChanged = 0, unmappedRecords = 0;
    const targetDb = db || (await import("@/db")).getDb();
    targetDb.transaction(() => {
      // Safe only now: all machine and product requests completed successfully.
      beginCompleteSlotReconciliation(accountId, completedAt, targetDb);
      for (const collection of collected) {
        const mapping = upsertMachineMapping(accountId, collection.machine, completedAt, targetDb);
        if (!mapping.local_machine_id) unmappedRecords += 1 + collection.slots.length;
        for (const slot of collection.slots) { upsertSlot(accountId, mapping.id, slot, targetDb); slotsSeen++; }
        for (const sale of collection.sales) {
          const saleMachine = sale.machineExternalId === collection.machine.externalId
            ? mapping
            : upsertMachineMapping(accountId, { externalId: sale.machineExternalId, name: sale.machineName }, completedAt, targetDb);
          if (!saleMachine.local_machine_id) unmappedRecords++;
          if (upsertSale(accountId, saleMachine.id, sale, completedAt, null, targetDb).inserted) salesChanged++;
          salesSeen++;
        }
      }
      finishSyncRun(runId, "success", { completedAt, machinesSeen: machines.length, slotsSeen, salesSeen, salesChanged, unmappedRecords }, targetDb);
      updateSyncState(accountId, "success", { at: completedAt, successful: true, machinesSeen: machines.length, slotsSeen, salesSeen }, targetDb);
    }).immediate();
    return { provider: "nayax" as const, mode: "read_only" as const, machinesSeen: machines.length, slotsSeen, salesSeen, salesChanged, unmappedRecords, completedAt };
  } catch (error) {
    const completedAt = now();
    const code = error instanceof VendingIntegrationError ? error.code : "NAYAX_SYNC_FAILED";
    finishSyncRun(runId, "failed", { completedAt, errorCode: code }, db);
    updateSyncState(accountId, "failed", { at: completedAt, errorCode: code }, db);
    if (error instanceof VendingIntegrationError) throw error;
    throw new VendingIntegrationError("NAYAX_SYNC_FAILED", "Nayax sync failed", 502);
  } finally {
    deadlineController.abort();
    releaseSyncLease(accountId, leaseToken, now(), db);
  }
}
