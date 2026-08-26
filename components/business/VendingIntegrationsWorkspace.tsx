"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { BusinessSection, Fact, SourceStamp } from "./Page";

type Provider = "nayax" | "vtm";
type Mapping = {
  providerMachineExternalId: string;
  providerMachineName: string | null;
  localMachineId: number | null;
  mappingSource: string;
  mapped: boolean;
  lastSeenAt: string | null;
};
type ProviderSnapshot = {
  provider: Provider;
  connection: { configured: boolean; access: string; status: string };
  sync: { lastAttemptAt: string | null; lastSuccessAt: string | null; lastStatus: string; machinesSeen: number; slotsSeen: number; salesSeen: number };
  mappedMachines: Mapping[];
  unmappedRecords: { slots: any[]; sales: any[] };
  counts: { machineMappings: number; unmappedMachines: number; slotSnapshots: number; sales: number; syncRuns: number };
  lastRun: { mode: string; status: string; completedAt: string | null; machinesSeen: number; slotsSeen: number; salesSeen: number; unmappedRecords: number } | null;
  blockers: string[];
};
type IntegrationSnapshot = {
  generatedAt: string;
  providers: { nayax: ProviderSnapshot; vtm: ProviderSnapshot };
  surfaces: { moma: { companionOnly: boolean; separateApi: boolean; status: string; configured: boolean; note: string; blockers: string[] } };
};
type LocalSlot = { slot_number: number; display_name?: string | null; quantity?: number | null; capacity?: number | null; price_cents?: number | null; verifiedAt?: string | null };
export type VendingFleetMachine = {
  id: number;
  name: string;
  location?: string | null;
  asset_code?: string | null;
  status?: string | null;
  active_slot_count?: number;
  calculated_stock?: number | null;
  capacity?: number | null;
  slots?: LocalSlot[];
};

type Props = {
  localFleet?: VendingFleetMachine[] | null;
  localFleetLoading?: boolean;
  localFleetError?: string | null;
  onRefreshLocalFleet?: () => void;
};

const labels: Record<string, string> = {
  NAYAX_TOKEN_MISSING: "Lynx token missing",
  UNMAPPED_PROVIDER_MACHINES: "Machine mapping needed",
  VTM_API_UNDOCUMENTED_USE_ORDER_LIST_XLSX_IMPORT: "No supported public API proven",
  NAYAX_REQUEST_FAILED: "Last Lynx request failed",
  NAYAX_SYNC_BUSY: "Sync already running",
};
const known = (value: unknown) => value !== null && value !== undefined && value !== "";
const shown = (value: unknown) => known(value) ? String(value) : "Unknown";
const dateTime = (value: unknown) => known(value) && !Number.isNaN(Date.parse(String(value))) ? new Date(String(value)).toLocaleString() : "Unknown";
const money = (value: unknown, currency = "USD") => typeof value === "number"
  ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value / 100)
  : "Unknown";
const pct = (value: number, max: number) => max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
const statusTone = (status: string) => status === "success" ? "ok" : status === "failed" || status === "blocked" ? "warn" : "neutral";

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
  return payload;
}

export default function VendingIntegrationsWorkspace({
  localFleet,
  localFleetLoading = false,
  localFleetError = null,
  onRefreshLocalFleet,
}: Props) {
  const integrations = useApi<IntegrationSnapshot>("/api/vending/integrations");
  const standalone = localFleet === undefined;
  const [standaloneFleet, setStandaloneFleet] = useState<VendingFleetMachine[]>([]);
  const [standaloneLoading, setStandaloneLoading] = useState(standalone);
  const [standaloneError, setStandaloneError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapSelections, setMapSelections] = useState<Record<string, string>>({});

  const loadStandaloneFleet = useCallback(async () => {
    if (!standalone) return;
    setStandaloneLoading(true);
    setStandaloneError(null);
    try {
      const payload = await requestJson("/api/business/service");
      setStandaloneFleet(Array.isArray(payload?.machines) ? payload.machines : []);
    } catch (error) {
      setStandaloneError(error instanceof Error ? error.message : "Local fleet could not be loaded");
    } finally {
      setStandaloneLoading(false);
    }
  }, [standalone]);

  useEffect(() => { void loadStandaloneFleet(); }, [loadStandaloneFleet]);

  const fleet = standalone ? standaloneFleet : localFleet ?? [];
  const fleetLoading = standalone ? standaloneLoading : localFleetLoading;
  const fleetError = standalone ? standaloneError : localFleetError;
  const snapshot = integrations.data;
  const allMappings = useMemo(() => snapshot ? ([
    ...snapshot.providers.nayax.mappedMachines.map((item) => ({ ...item, provider: "nayax" as const })),
    ...snapshot.providers.vtm.mappedMachines.map((item) => ({ ...item, provider: "vtm" as const })),
  ]) : [], [snapshot]);

  const refreshAll = useCallback(() => {
    integrations.refetch();
    if (onRefreshLocalFleet) onRefreshLocalFleet();
    else void loadStandaloneFleet();
  }, [integrations.refetch, loadStandaloneFleet, onRefreshLocalFleet]);

  const runAction = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (working) return;
    setWorking(key);
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: "ok", text: success });
      refreshAll();
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Action failed" });
    } finally {
      setWorking(null);
    }
  };

  const syncNayax = () => runAction(
    "nayax-sync",
    () => requestJson("/api/vending/integrations/nayax/sync", { method: "POST" }),
    "Nayax Lynx sync finished. Fleet data was refreshed.",
  );
  const importVtm = () => runAction("vtm-import", async () => {
    if (!file) throw new Error("Choose an official VTM Order list .xlsx file first");
    const form = new FormData();
    form.set("file", file);
    return requestJson("/api/vending/integrations/vtm/import", { method: "POST", body: form });
  }, "VTM Order list import finished. Fleet data was refreshed.");
  const saveMapping = (provider: Provider, mapping: Mapping) => {
    const key = `${provider}:${mapping.providerMachineExternalId}`;
    const selected = mapSelections[key] ?? (mapping.localMachineId === null ? "" : String(mapping.localMachineId));
    return runAction(`map:${key}`, () => requestJson("/api/vending/integrations/mappings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        providerMachineExternalId: mapping.providerMachineExternalId,
        localMachineId: selected === "" ? null : Number(selected),
      }),
    }), selected === "" ? "Provider machine was manually left unmapped." : "Provider machine mapping saved.");
  };

  if (integrations.loading && !snapshot) return <BusinessSection title="Vending integration & fleet map" note={<SourceStamp>authenticated provider snapshot</SourceStamp>}><div className="vending-integration-state" role="status" aria-live="polite"><strong>Loading integration map…</strong><span>Reading local fleet, Nayax, MoMa, and VTM status.</span></div></BusinessSection>;
  if (integrations.error && !snapshot) return <BusinessSection title="Vending integration & fleet map"><div className="vending-integration-state error" role="alert"><strong>Could not load vending integrations</strong><span>{integrations.error}</span><button onClick={refreshAll}>Retry</button></div></BusinessSection>;
  if (!snapshot) return null;

  const nayax = snapshot.providers.nayax;
  const vtm = snapshot.providers.vtm;
  const discovered = nayax.counts.machineMappings + vtm.counts.machineMappings;
  const mapped = allMappings.filter((item) => item.mapped).length;
  const records = nayax.counts.slotSnapshots + nayax.counts.sales + vtm.counts.slotSnapshots + vtm.counts.sales;
  const unmapped = [
    ...nayax.unmappedRecords.slots.map((item) => ({ ...item, provider: "Nayax", kind: "slot", at: item.providerLastUpdatedAt || item.snapshotAt, price: item.priceCents })),
    ...nayax.unmappedRecords.sales.map((item) => ({ ...item, provider: "Nayax", kind: "sale", at: item.soldAt, price: item.unitPriceCents ?? item.totalCents })),
    ...vtm.unmappedRecords.slots.map((item) => ({ ...item, provider: "VTM", kind: "slot", at: item.providerLastUpdatedAt || item.snapshotAt, price: item.priceCents })),
    ...vtm.unmappedRecords.sales.map((item) => ({ ...item, provider: "VTM", kind: "sale", at: item.soldAt, price: item.unitPriceCents ?? item.totalCents })),
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 12);

  const ProviderHeader = ({ title, provider, subtitle }: { title: string; provider: ProviderSnapshot; subtitle: string }) => <div className="vending-provider-head"><div><span>{subtitle}</span><h3>{title}</h3></div><span className={`vending-status ${statusTone(provider.connection.status)}`}>{provider.connection.status}</span></div>;
  const Blockers = ({ items }: { items: string[] }) => <div className="vending-blockers">{items.length ? items.map((item) => <span key={item}>{labels[item] || item.replaceAll("_", " ").toLowerCase()}</span>) : <span className="clear">No blockers reported</span>}</div>;

  return <BusinessSection title="Vending integration & fleet map" className="vending-integrations-section" note={<SourceStamp>local inventory + safe provider projections</SourceStamp>}>
    <div className="vending-progress-facts business-facts">
      <Fact label="Local machines" value={fleetLoading ? "…" : fleet.length} detail={fleetError || "authenticated local fleet"} />
      <Fact label="Provider machines discovered" value={discovered} detail={`${nayax.counts.machineMappings} Nayax · ${vtm.counts.machineMappings} VTM`} />
      <Fact label="Mapped provider machines" value={`${mapped}/${discovered}`} detail={discovered ? `${pct(mapped, discovered)}% mapped` : "No provider machines discovered yet"} />
      <Fact label="Current provider records" value={records} detail={`${nayax.counts.slotSnapshots + vtm.counts.slotSnapshots} slots · ${nayax.counts.sales + vtm.counts.sales} sales`} />
    </div>
    <div className="vending-overall-progress" aria-label={`${mapped} of ${discovered} provider machines mapped`}><span style={{ width: `${pct(mapped, discovered)}%` }} /></div>

    {feedback && <div className={`vending-action-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite">{feedback.text}</div>}

    <div className="vending-provider-grid">
      <article className="vending-provider-card">
        <ProviderHeader title="Nayax Lynx" provider={nayax} subtitle="Official read-only API" />
        <p>Credential/config status: <strong>{nayax.connection.configured ? "Configured" : "Not configured"}</strong></p>
        <dl><div><dt>Last sync</dt><dd>{dateTime(nayax.sync.lastSuccessAt || nayax.sync.lastAttemptAt)}</dd></div><div><dt>Latest discovery</dt><dd>{nayax.sync.machinesSeen} machines · {nayax.sync.slotsSeen} slots · {nayax.sync.salesSeen} sales</dd></div></dl>
        <Blockers items={nayax.blockers} />
        <button className="business-primary-action" data-testid="nayax-sync" onClick={syncNayax} disabled={!nayax.connection.configured || working !== null} aria-busy={working === "nayax-sync"} aria-describedby="nayax-sync-help">{working === "nayax-sync" ? "Syncing…" : "Sync Now"}</button>
        <small id="nayax-sync-help">{nayax.connection.configured ? "Reads official Lynx machine, slot, and sales data; no write calls." : "Sync is disabled until the server-side NAYAX_LYNX_TOKEN is configured."}</small>
      </article>

      <article className="vending-provider-card moma">
        <div className="vending-provider-head"><div><span>Nayax companion view</span><h3>MoMa</h3></div><span className={`vending-status ${statusTone(snapshot.surfaces.moma.status)}`}>{snapshot.surfaces.moma.status}</span></div>
        <p>{snapshot.surfaces.moma.note}</p>
        <dl><div><dt>Data source</dt><dd>Nayax Lynx</dd></div><div><dt>Separate API / token</dt><dd>No</dd></div><div><dt>Credential status</dt><dd>{snapshot.surfaces.moma.configured ? "Shared Nayax credential configured" : "Shared Nayax credential missing"}</dd></div></dl>
        <Blockers items={snapshot.surfaces.moma.blockers} />
      </article>

      <article className="vending-provider-card">
        <ProviderHeader title="VTM" provider={vtm} subtitle="Official portal export" />
        <p>No supported public API is proven. Import the official portal <strong>Order list .xlsx</strong>.</p>
        <dl><div><dt>Last import</dt><dd>{dateTime(vtm.lastRun?.completedAt || vtm.sync.lastAttemptAt)}</dd></div><div><dt>Import status</dt><dd>{vtm.lastRun ? `${vtm.lastRun.status} · ${vtm.lastRun.mode}` : "Never imported"}</dd></div></dl>
        <Blockers items={vtm.blockers} />
        <label className="vending-upload">Order list file<input data-testid="vtm-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>Preferred: official .xlsx · Optional fallback: user-converted CSV</small></label>
        <button className="business-primary-action" data-testid="vtm-import" onClick={importVtm} disabled={!file || working !== null} aria-busy={working === "vtm-import"}>{working === "vtm-import" ? "Importing…" : "Import Order list"}</button>
      </article>
    </div>

    <section className="vending-subsection" aria-labelledby="local-fleet-map-title">
      <div className="vending-subsection-head"><div><span>Physical truth</span><h3 id="local-fleet-map-title">Local machine, aisle & provider map</h3></div><small>Unknown values stay unknown—not zero.</small></div>
      {fleetError ? <div className="vending-inline-error" role="alert">Local fleet unavailable: {fleetError} <button onClick={refreshAll}>Retry</button></div> : fleetLoading ? <p role="status">Loading local machine inventory…</p> : fleet.length === 0 ? <p>No local machines are recorded.</p> : <div className="vending-machine-grid">{fleet.map((machine) => {
        const machineMappings = allMappings.filter((item) => item.localMachineId === machine.id);
        const hasSlots = (machine.active_slot_count ?? machine.slots?.length ?? 0) > 0;
        const stockKnown = hasSlots && typeof machine.calculated_stock === "number" && typeof machine.capacity === "number";
        return <article className="vending-machine-map-card" key={machine.id}>
          <div className="vending-machine-title"><div><span>{shown(machine.asset_code)}</span><h4>{machine.name}</h4><p>{shown(machine.location)}</p></div><span>{shown(machine.status)}</span></div>
          <div className="vending-machine-summary"><div><span>Capacity</span><strong>{hasSlots ? shown(machine.capacity) : "Unknown"}</strong></div><div><span>Current stock</span><strong>{stockKnown ? machine.calculated_stock : "Unknown"}</strong></div><div><span>Provider links</span><strong>{machineMappings.length}</strong></div></div>
          <div className="vending-stock-progress" aria-label={stockKnown ? `${machine.calculated_stock} of ${machine.capacity} units stocked` : "Stock unknown"}><span style={{ width: stockKnown ? `${pct(machine.calculated_stock!, machine.capacity!)}%` : "0%" }} /></div>
          <div className="vending-machine-links">{machineMappings.length ? machineMappings.map((item) => <span key={`${item.provider}:${item.providerMachineExternalId}`}><b>{item.provider}</b> {item.providerMachineName || item.providerMachineExternalId}</span>) : <span className="needs-map">No provider machine mapped</span>}</div>
          <div className="vending-aisles"><strong>Current aisle / slot inventory</strong>{hasSlots ? <div>{(machine.slots || []).map((slot) => {
            const qtyKnown = typeof slot.quantity === "number";
            const capacityKnown = typeof slot.capacity === "number";
            return <div className="vending-slot" key={slot.slot_number}><div><span>Slot {slot.slot_number}</span><strong>{shown(slot.display_name)}</strong><small>{qtyKnown ? slot.quantity : "Unknown"} / {capacityKnown ? slot.capacity : "Unknown"} · {money(slot.price_cents)}</small></div><div className="vending-slot-progress"><span style={{ width: qtyKnown && capacityKnown ? `${pct(slot.quantity!, slot.capacity!)}%` : "0%" }} /></div></div>;
          })}</div> : <p>Slot inventory unknown — no active aisle assignments.</p>}</div>
        </article>;
      })}</div>}
    </section>

    <section className="vending-subsection" aria-labelledby="provider-mapping-title">
      <div className="vending-subsection-head"><div><span>Controlled link</span><h3 id="provider-mapping-title">Discovered provider machine mappings</h3></div><small>Only already-discovered provider machines can be mapped.</small></div>
      {allMappings.length === 0 ? <p>No provider machines discovered. Sync Nayax or import VTM first.</p> : <div className="vending-mapping-list">{allMappings.map((mapping) => {
        const key = `${mapping.provider}:${mapping.providerMachineExternalId}`;
        const selected = mapSelections[key] ?? (mapping.localMachineId === null ? "" : String(mapping.localMachineId));
        return <div className="vending-mapping-row" key={key}>
          <div><span>{mapping.provider}</span><strong>{mapping.providerMachineName || "Unnamed provider machine"}</strong><small>ID {mapping.providerMachineExternalId} · {mapping.mapped ? `${mapping.mappingSource} mapping` : "mapping needed"}</small></div>
          <label><span className="sr-only">Local machine for {mapping.providerMachineName || mapping.providerMachineExternalId}</span><select aria-label={`Local machine for ${mapping.providerMachineName || mapping.providerMachineExternalId}`} value={selected} onChange={(event) => setMapSelections((prior) => ({ ...prior, [key]: event.target.value }))}><option value="">Leave unmapped</option>{fleet.map((machine) => <option value={machine.id} key={machine.id}>{machine.name} · {machine.location || "Unknown location"}</option>)}</select></label>
          <button onClick={() => saveMapping(mapping.provider, mapping)} disabled={working !== null || fleetLoading} aria-busy={working === `map:${key}`}>{working === `map:${key}` ? "Saving…" : "Save mapping"}</button>
        </div>;
      })}</div>}
    </section>

    <section className="vending-subsection" aria-labelledby="unmapped-records-title">
      <div className="vending-subsection-head"><div><span>Reconciliation queue</span><h3 id="unmapped-records-title">Recent unmapped provider records</h3></div><small>{unmapped.length} recent records shown</small></div>
      {unmapped.length === 0 ? <div className="vending-clear-state"><strong>No mapping-needed provider records</strong><span>Sync or import data will appear here if its machine is not linked.</span></div> : <div className="vending-unmapped-list">{unmapped.map((item, index) => <article key={`${item.provider}:${item.kind}:${item.providerMachineExternalId}:${item.providerSlotExternalId || "unknown"}:${index}`}>
        <div><span>{item.provider} · {item.kind}</span><strong>{item.providerMachineExternalId || "Unknown machine"}</strong></div><div><span>Slot</span><strong>{shown(item.providerSlotExternalId)}</strong></div><div><span>Product</span><strong>{shown(item.productName || item.providerProductExternalId)}</strong></div><div><span>Price</span><strong>{money(item.price, item.currency || "USD")}</strong></div><div><span>Provider time</span><strong>{dateTime(item.at)}</strong></div><b>Mapping needed</b>
      </article>)}</div>}
    </section>
  </BusinessSection>;
}
