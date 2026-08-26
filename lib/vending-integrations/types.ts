import type Database from "better-sqlite3";

export type VendingProvider = "nayax" | "vtm";
export type ProviderMode = "api" | "xlsx" | "converted_csv";

export interface NormalizedProviderMachine {
  externalId: string;
  name: string | null;
}

export interface NormalizedProviderProduct {
  externalId: string;
  name: string | null;
  observedAt: string;
}

export interface NormalizedProviderSlot {
  machineExternalId: string;
  slotExternalId: string;
  machineProductExternalId: string | null;
  productExternalId: string | null;
  operatorButtonCode: string | null;
  mdbCode: string | null;
  dexProductName: string | null;
  productName: string | null;
  cashPriceCents: number | null;
  creditCardPriceCents: number | null;
  machinePriceCents: number | null;
  /** Canonical display price; card, machine, then cash. */
  priceCents: number | null;
  /** Only a real provider quantity belongs here. Nayax PAR/missing-stock are not quantity. */
  quantity: number | null;
  par: number | null;
  missingStockByMdb: number | null;
  missingStockByDex: number | null;
  selectionVendOutBit: boolean | null;
  providerLastUpdatedAt: string | null;
  observedAt: string;
}

export interface NormalizedProviderSale {
  externalSaleId: string;
  machineExternalId: string;
  machineName: string | null;
  providerAccountLabel: string | null;
  slotExternalId: string | null;
  productExternalId: string | null;
  productName: string | null;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  authorizationCents: number | null;
  settlementCents: number | null;
  costPriceCents: number | null;
  retailPriceCents: number | null;
  currency: string;
  authorizationAt: string | null;
  machineAuthorizationAt: string | null;
  settlementAt: string | null;
  soldAt: string;
  orderStatus: string | null;
}

export interface ReadOnlyProviderAdapter {
  readonly provider: VendingProvider;
  readonly mode: "api";
  listMachines(): Promise<NormalizedProviderMachine[]>;
  listMachineProducts(machineExternalId: string): Promise<NormalizedProviderSlot[]>;
  listMachineSales(machineExternalId: string): Promise<NormalizedProviderSale[]>;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface IntegrationDbOptions {
  db?: Database.Database;
  now?: () => string;
}

export class VendingIntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "VendingIntegrationError";
  }
}
