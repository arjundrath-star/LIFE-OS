"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi, apiPost } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { BusinessPage, BusinessSection, Fact, SourceStamp } from "./Page";
import { PokemonDataBoundary } from "./BusinessContext";

const STAGES = ["lead", "contacted", "verbal_yes", "placing", "live"];
const controlClass = "location-control";

export default function LocationsWorkspace() {
  const { data, loading, error, refetch } = useApi<any>("/api/vending");
  const { data: service, loading: serviceLoading, error: serviceError, refetch: refetchService } = useApi<any>("/api/business/service");
  const live = useLiveData<any>("vending");
  const snapshot = live || data;
  const [machine, setMachine] = useState("");
  const [location, setLocation] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [deal, setDeal] = useState("");
  const [dealLocation, setDealLocation] = useState("");
  const [dealNote, setDealNote] = useState("");
  const [editingDeal, setEditingDeal] = useState<number | null>(null);
  const [editDealName, setEditDealName] = useState("");
  const [editDealLocation, setEditDealLocation] = useState("");
  const [editDealNote, setEditDealNote] = useState("");
  const [machineError, setMachineError] = useState<string | null>(null);
  const [savingMachine, setSavingMachine] = useState(false);
  const post = async (body: any) => { await apiPost("/api/vending", body); refetch(); };

  const addMachine = async () => {
    if (!machine.trim() || !location.trim() || savingMachine) return;
    setSavingMachine(true);
    setMachineError(null);
    try {
      await apiPost("/api/vending", {
        action: "add_machine",
        name: machine.trim(),
        location: location.trim(),
        assetCode,
        accessNotes,
      });
      setMachine(""); setLocation(""); setAssetCode(""); setAccessNotes("");
      refetch();
      refetchService();
    } catch (cause) {
      setMachineError(cause instanceof Error ? cause.message : "Machine could not be added.");
    } finally {
      setSavingMachine(false);
    }
  };

  const addDeal = async () => {
    if (!deal.trim()) return;
    await post({ action: "add_deal", name: deal.trim(), location: dealLocation.trim() || null, note: dealNote.trim() || null });
    setDeal("");
    setDealLocation("");
    setDealNote("");
  };

  const beginDealEdit = (item: any) => {
    setEditingDeal(item.id);
    setEditDealName(item.name ?? "");
    setEditDealLocation(item.location ?? "");
    setEditDealNote(item.note ?? "");
  };

  const saveDeal = async () => {
    if (!editingDeal || !editDealName.trim()) return;
    await post({
      action: "update_deal",
      id: editingDeal,
      name: editDealName.trim(),
      location: editDealLocation.trim() || null,
      note: editDealNote.trim() || null,
    });
    setEditingDeal(null);
  };

  return <PokemonDataBoundary><BusinessPage
    title="Locations"
    description="Manage every machine, site, service state, and placement lead from one working view."
    actions={<SourceStamp>vending SQLite + live channel</SourceStamp>}
  >
    {error ? <div className="business-empty" role="alert" data-testid="vending-load-error"><h2>Could not load locations</h2><p>{error}</p><button className="min-h-11 px-4" onClick={refetch}>Retry</button></div> : loading && !snapshot ? <div className="business-empty" role="status"><h2>Loading locations</h2><p>Reading the authenticated vending snapshot.</p></div> : snapshot && <>
      <div className="location-hero">
        <div><span>Location desk</span><h2>Machines and placements</h2><p>Add a site, edit machine details, and see what needs attention without digging.</p></div>
        <div><a href="#add-machine" className="business-primary-action">Add a machine</a><a href="#placement-board">Add placement lead</a></div>
      </div>

      <div className="business-facts location-facts">
        <Fact label="Machines" value={service?.kpis.total ?? snapshot.machines?.length ?? 0} detail={`${service?.kpis.live ?? snapshot.liveMachines ?? 0} live`} />
        <Fact label="Needs service" value={service?.kpis.needsService ?? snapshot.needsRefill ?? 0} detail="service required or out of order" />
        <Fact label="Open issues" value={service?.kpis.openIssues ?? 0} detail="operator-recorded evidence" />
        <Fact label="Physical counts" value={service ? `${service.kpis.verified} verified · ${service.kpis.partial} partial · ${service.kpis.unknown} unknown` : "Unknown"} detail={service ? "active assignment coverage" : "loading service evidence"} />
        <Fact label="Placement opportunities" value={snapshot.deals?.length ?? 0} detail="real deal records" />
        <Fact label="Revenue connection" value={snapshot.revenueConnected ? "Connected" : "Not connected"} detail="Mercury source state" />
      </div>

      <BusinessSection title="Add a machine" className="location-add-section" note={<SourceStamp>required: name + site</SourceStamp>}>
        <div id="add-machine" className="location-form-grid">
          <label>Machine name<input data-testid="add-machine-name" aria-label="Machine name" placeholder="e.g. Pokemon Machine 1" value={machine} onChange={event => setMachine(event.target.value)} className={controlClass} /></label>
          <label>Site / location<input data-testid="add-machine-location" aria-label="Machine site or location" placeholder="Venue and city" value={location} onChange={event => setLocation(event.target.value)} className={controlClass} /></label>
          <label>Asset code<input data-testid="add-machine-asset-code" aria-label="Asset code" placeholder="Optional internal ID" value={assetCode} onChange={event => setAssetCode(event.target.value)} className={controlClass} /></label>
          <label>Access notes<input data-testid="add-machine-access-notes" aria-label="Access notes" placeholder="Hours, contact, door, parking" value={accessNotes} onChange={event => setAccessNotes(event.target.value)} className={controlClass} /></label>
          <button data-testid="add-machine-submit" disabled={!machine.trim() || !location.trim() || savingMachine} aria-busy={savingMachine} className="business-primary-action location-submit" onClick={addMachine}>{savingMachine ? "Saving machine…" : "Add machine"}</button>
          {machineError && <p data-testid="add-machine-error" className="location-form-error" role="alert" aria-live="assertive">{machineError}</p>}
        </div>
      </BusinessSection>

      <BusinessSection title="Machine service priority" note={<SourceStamp>stock, counts, issues, and next action</SourceStamp>}>
        {serviceError ? <div role="alert" data-testid="service-load-error"><p>Could not load service priorities: {serviceError}</p><button className="min-h-11 px-4" onClick={refetchService}>Retry</button></div> : serviceLoading ? <p role="status" className="text-sm text-txt-muted">Loading service priorities…</p> : (service?.machines ?? []).length === 0 ? <p className="text-sm text-txt-muted">No machines recorded yet.</p> : <div className="location-machine-grid">{service.machines.map((item: any) => <article key={item.id} data-testid={`machine-row-${item.id}`} className="fleet-row location-machine-card">
          <div className="location-machine-head"><div><span className={`machine-condition ${item.condition}`}>{item.condition.replaceAll("_", " ")}</span><strong>{item.name}{item.asset_code ? ` · ${item.asset_code}` : ""}</strong><p>{item.location || "Unplaced"}</p></div><span className="location-machine-status">{item.status}</span></div>
          <div className="location-machine-metrics">
            <div><span>Calculated stock</span><strong>{item.calculated_stock}/{item.capacity}</strong></div>
            <div><span>Verified slots</span><strong>{item.verified_slot_count}/{item.active_slot_count}</strong></div>
            <div><span>Open issues</span><strong>{item.open_issues.length}</strong></div>
          </div>
          <p className="location-machine-evidence">{item.complete_verified_at ? `Complete count ${new Date(item.complete_verified_at).toLocaleString()}` : item.verified_slot_count ? "Partial physical count" : "No physical count yet"} · {item.last_service ? `last service ${timeAgo(item.last_service.completed_at)}` : "no service visit"}</p>
          {item.access_notes && <p className="location-machine-notes">Access: {item.access_notes}</p>}
          <div className="fleet-actions"><Link data-testid={`machine-link-${item.id}`} href={`/business/locations/${item.id}`}>Edit machine</Link>{item.status === "live" && item.condition !== "retired" && item.active_slot_count > 0 ? <Link href={`/business/locations/${item.id}/service`}>Start service</Link> : <span>Setup required</span>}</div>
        </article>)}</div>}
      </BusinessSection>

      <BusinessSection title="Placement board" className="placement-section" note={<SourceStamp>add details now; advance stages as the deal moves</SourceStamp>}>
        <div id="placement-board" className="placement-add-bar">
          <label>Venue<input aria-label="New placement lead" placeholder="Venue name" value={deal} onChange={event => setDeal(event.target.value)} className={controlClass} /></label>
          <label>Area / address<input aria-label="Placement lead location" placeholder="Neighborhood, city, or address" value={dealLocation} onChange={event => setDealLocation(event.target.value)} className={controlClass} /></label>
          <label>Next step / note<input aria-label="Placement lead note" placeholder="Contact, fit, or next action" value={dealNote} onChange={event => setDealNote(event.target.value)} onKeyDown={event => event.key === "Enter" && addDeal()} className={controlClass} /></label>
          <button className="business-primary-action" disabled={!deal.trim()} onClick={addDeal}>Add lead</button>
        </div>
        <div className="placement-board-scroll"><div className="placement-board-grid">{STAGES.map((stage, index) => <section key={stage} className={`placement-column stage-${stage}`}><h3>{stage.replace("_", " ")}<span>{(snapshot.deals ?? []).filter((item: any) => item.stage === stage).length}</span></h3>{(snapshot.deals ?? []).filter((item: any) => item.stage === stage).map((item: any) => <article key={item.id} className="placement-card">
          {editingDeal === item.id ? <div className="placement-editor"><input aria-label="Edit venue name" className={controlClass} value={editDealName} onChange={event => setEditDealName(event.target.value)} /><input aria-label="Edit venue location" className={controlClass} value={editDealLocation} onChange={event => setEditDealLocation(event.target.value)} placeholder="Area / address" /><textarea aria-label="Edit venue note" className={controlClass} value={editDealNote} onChange={event => setEditDealNote(event.target.value)} placeholder="Next step / note" /><div><button onClick={() => setEditingDeal(null)}>Cancel</button><button className="business-primary-action" onClick={saveDeal}>Save</button></div></div> : <><div className="placement-card-head"><strong>{item.name}</strong><button onClick={() => beginDealEdit(item)}>Edit</button></div>{item.location && <p>{item.location}</p>}{item.note && <p className="placement-note">{item.note}</p>}<small>updated {timeAgo(item.updated_at)}</small><div className="placement-actions"><button disabled={index === 0} onClick={() => post({ action: "set_stage", id: item.id, stage: STAGES[index - 1] })}>Back</button><button onClick={() => post({ action: "delete_deal", id: item.id })} className="text-error">Delete</button><button disabled={index === STAGES.length - 1} onClick={() => post({ action: "set_stage", id: item.id, stage: STAGES[index + 1] })}>Advance</button></div></>}
        </article>)}</section>)}</div></div>
      </BusinessSection>

      <BusinessSection title="Outreach source" note={<SourceStamp>Google mailbox read model</SourceStamp>}>{!snapshot.outreach?.connected ? <p className="text-sm text-txt-muted">Outreach mailbox is not connected. Configure it under Integrations; no outreach totals are inferred.</p> : <div className="business-facts"><Fact label="Reached" value={snapshot.outreach.reachedTotal ?? 0} detail={`${snapshot.outreach.reached7d ?? 0} in the last 7 days`} /><Fact label="Replies" value={snapshot.outreach.respondedTotal ?? 0} detail={`${snapshot.outreach.responseRate ?? 0}% response rate`} /><Fact label="Last checked" value={snapshot.outreach.lastChecked ? timeAgo(snapshot.outreach.lastChecked) : "Unknown"} detail={snapshot.outreach.lastError || "mailbox read"} /></div>}</BusinessSection>
    </>}
  </BusinessPage></PokemonDataBoundary>;
}
