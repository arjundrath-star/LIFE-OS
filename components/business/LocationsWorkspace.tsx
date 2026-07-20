"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi, apiPost } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { BusinessPage, BusinessSection, Fact, SourceStamp } from "./Page";
import { PokemonDataBoundary } from "./BusinessContext";

const STAGES = ["lead", "contacted", "verbal_yes", "placing", "live"];

export default function LocationsWorkspace() {
  const { data, refetch } = useApi<any>("/api/vending");
  const { data: service, error: serviceError, refetch: refetchService } = useApi<any>("/api/business/service");
  const live = useLiveData<any>("vending");
  const snapshot = live || data;
  const [machine, setMachine] = useState("");
  const [location, setLocation] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [deal, setDeal] = useState("");
  const post = async (body: any) => { await apiPost("/api/vending", body); refetch(); };
  const addMachine = async () => { if (!machine.trim()||!location.trim()) return; await post({ action: "add_machine", name: machine.trim(), location: location.trim(), assetCode, accessNotes }); setMachine(""); setLocation(""); setAssetCode(""); setAccessNotes(""); refetchService(); };
  const addDeal = async () => { if (!deal.trim()) return; await post({ action: "add_deal", name: deal.trim() }); setDeal(""); };

  return <PokemonDataBoundary><BusinessPage title="Locations" description="Real placement opportunities and machine operations from the existing Vending and Pokemon Ops stores." actions={<SourceStamp>vending SQLite + live channel</SourceStamp>}>
    {!snapshot ? <div className="business-empty"><h2>Loading locations</h2><p>Reading the authenticated vending snapshot.</p></div> : <>
      <div className="business-facts">
        <Fact label="Machines" value={service?.kpis.total ?? snapshot.machines?.length ?? 0} detail={`${service?.kpis.live ?? snapshot.liveMachines ?? 0} live`} />
        <Fact label="Needs service" value={service?.kpis.needsService ?? snapshot.needsRefill ?? 0} detail="service required or out of order" />
        <Fact label="Open issues" value={service?.kpis.openIssues ?? 0} detail="operator-recorded evidence" />
        <Fact label="Physical counts" value={service?`${service.kpis.verified} verified`:`Unknown`} detail={service?`${service.kpis.unknown} unknown`:"loading service evidence"} />
        <Fact label="Placement opportunities" value={snapshot.deals?.length ?? 0} detail="real deal records" />
        <Fact label="Revenue connection" value={snapshot.revenueConnected ? "Connected" : "Not connected"} detail="Mercury source state" />
      </div>
      <BusinessSection title="Machine service priority" note={<div className="flex flex-wrap gap-2"><input aria-label="Machine name" placeholder="Machine name" value={machine} onChange={(e) => setMachine(e.target.value)} className="h-11 border border-border bg-base px-3 text-sm" /><input aria-label="Machine site or location" placeholder="Site / location" value={location} onChange={(e) => setLocation(e.target.value)} className="h-11 border border-border bg-base px-3 text-sm" /><input aria-label="Asset code" placeholder="Asset code (optional)" value={assetCode} onChange={e=>setAssetCode(e.target.value)} /><input aria-label="Access notes" placeholder="Access notes (optional)" value={accessNotes} onChange={e=>setAccessNotes(e.target.value)} /><button disabled={!machine.trim()||!location.trim()} className="h-11 bg-accent px-4 text-sm font-semibold text-white" onClick={addMachine}>Add machine</button></div>}>
        {serviceError?<div role="alert"><p>Could not load service priorities: {serviceError}</p><button onClick={refetchService}>Retry</button></div>:(service?.machines ?? []).length === 0 ? <p className="text-sm text-txt-muted">{service?"No machines recorded yet.":"Loading service priorities…"}</p> : <div className="business-list">{service.machines.map((item: any) => <article key={item.id} className="fleet-row"><div><span className={`machine-condition ${item.condition}`}>{item.condition.replaceAll("_"," ")}</span><strong>{item.name}{item.asset_code?` · ${item.asset_code}`:""}</strong><p>{item.location || "Unplaced"} · {item.calculated_stock}/{item.capacity} calculated stock</p><small>{item.complete_verified_at?`Verified at ${new Date(item.complete_verified_at).toLocaleString()}`:item.verified_slot_count?`Partially verified · ${item.verified_slot_count}/${item.active_slot_count} slots`:`No complete physical count · 0/${item.active_slot_count} slots`} · {item.last_service?`last service ${timeAgo(item.last_service.completed_at)}`:"no service visit"} · {item.open_issues.length} open issue{item.open_issues.length===1?"":"s"}</small></div><div className="fleet-actions"><Link href={`/business/locations/${item.id}`}>View machine</Link>{item.status==="live"&&item.condition!=="retired"&&item.active_slot_count>0?<Link href={`/business/locations/${item.id}/service`}>Start service</Link>:<span>Setup required</span>}</div></article>)}</div>}
      </BusinessSection>
      <BusinessSection title="Placement board" note={<div className="flex gap-2"><input aria-label="New placement lead" placeholder="Venue name" value={deal} onChange={(e) => setDeal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDeal()} className="h-11 border border-border bg-base px-3 text-sm" /><button className="h-11 bg-accent px-4 text-sm font-semibold text-white" onClick={addDeal}>Add</button></div>}>
        <div className="max-w-full overflow-x-auto"><div className="grid min-w-[820px] grid-cols-5 gap-3">{STAGES.map((stage, index) => <div key={stage}><h3 className="mb-2 border-b border-border pb-2 text-xs font-bold uppercase tracking-wide text-txt-muted">{stage.replace("_", " ")}</h3>{(snapshot.deals ?? []).filter((item: any) => item.stage === stage).map((item: any) => <div key={item.id} className="mb-2 border border-border bg-panel-2 p-3"><strong className="text-xs text-txt-primary">{item.name}</strong><p className="mt-1 text-[10px] text-txt-faint">updated {timeAgo(item.updated_at)}</p><div className="mt-2 flex justify-between"><button disabled={index === 0} onClick={() => post({ action: "set_stage", id: item.id, stage: STAGES[index - 1] })} className="min-h-11 px-2 text-xs disabled:opacity-30">Back</button><button onClick={() => post({ action: "delete_deal", id: item.id })} className="min-h-11 px-2 text-xs text-error">Delete</button><button disabled={index === STAGES.length - 1} onClick={() => post({ action: "set_stage", id: item.id, stage: STAGES[index + 1] })} className="min-h-11 px-2 text-xs disabled:opacity-30">Advance</button></div></div>)}</div>)}</div></div>
      </BusinessSection>
      <BusinessSection title="Outreach source" note={<SourceStamp>Google mailbox read model</SourceStamp>}>
        {!snapshot.outreach?.connected ? <p className="text-sm text-txt-muted">Outreach mailbox is not connected. Configure it under Integrations; no outreach totals are inferred.</p> : <div className="business-facts"><Fact label="Reached" value={snapshot.outreach.reachedTotal ?? 0} detail={`${snapshot.outreach.reached7d ?? 0} in the last 7 days`} /><Fact label="Replies" value={snapshot.outreach.respondedTotal ?? 0} detail={`${snapshot.outreach.responseRate ?? 0}% response rate`} /><Fact label="Last checked" value={snapshot.outreach.lastChecked ? timeAgo(snapshot.outreach.lastChecked) : "Unknown"} detail={snapshot.outreach.lastError || "mailbox read"} /></div>}
      </BusinessSection>
    </>}
  </BusinessPage></PokemonDataBoundary>;
}
