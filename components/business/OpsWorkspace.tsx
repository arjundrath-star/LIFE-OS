"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { BusinessPage, BusinessSection, SourceStamp } from "./Page";
import { PokemonDataBoundary } from "./BusinessContext";
import { KpiBand } from "@/components/pokemon-ops/KpiBand";
import { SlotTable } from "@/components/pokemon-ops/SlotTable";
import { RecommendationsList } from "@/components/pokemon-ops/RecommendationsList";
import { RecentSales } from "@/components/pokemon-ops/RecentSales";
import { RecentLots } from "@/components/pokemon-ops/RecentLots";
import { EntryForms } from "@/components/pokemon-ops/EntryForms";
import { formatCents } from "@/lib/pokemon-ops/format";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { PkProduct } from "@/lib/pokemon-ops/types";

type SourcingOps = { offers:any[]; benchmarks:any[]; vendors:any[]; local:{provenance:any;spots:any[]}; discord:any[]; connector:any; monitors:any[] };
const INVENTORY_VIEWS = ["Active Inventory","Purchase Lots","Sales","Record Activity"] as const;
const SOURCING_VIEWS = ["Deals","Market Prices","Vendors","Local Spots","Sources / Monitors","Discord Deals"] as const;

function ViewTabs({ values, active, onChange }:{values:readonly string[];active:string;onChange:(v:string)=>void}) { return <div className="business-view-tabs" role="tablist">{values.map(v=><button key={v} role="tab" aria-selected={active===v} className={active===v?"active":""} onClick={()=>onChange(v)}>{v}</button>)}</div>; }
function Fresh({ value }:{value:string|null}) { return <span title={value||undefined}>{value ? new Date(value).toLocaleString() : "No observation"}</span>; }
function PriceTable({ rows, vendor=false }:{rows:any[];vendor?:boolean}) { return rows.length===0?<p className="text-sm text-txt-muted">No evidence-backed rows are available for this view.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Product</th><th>Source</th><th>Price / pack</th><th>Benchmark</th>{vendor&&<><th>Delta</th><th>Decision</th></>}<th>Freshness</th><th>Provenance</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.observation_id}-${r.source}`}><td><strong>{r.display_name||r.set_name}</strong></td><td>{r.source}</td><td>{formatCents(r.price_per_pack_cents)}</td><td>{r.benchmark_cents==null?"No benchmark":`${formatCents(r.benchmark_cents)} · ${r.benchmark_source}`}</td>{vendor&&<><td>{r.delta_cents==null?"Unknown":formatCents(r.delta_cents)}</td><td><span className={`ops-decision ${r.decision}`}>{r.decision}</span></td></>}<td><Fresh value={r.observed_date}/></td><td>{r.listing_ref?<a href={r.listing_ref.startsWith("http")?r.listing_ref:undefined} rel="noreferrer" target="_blank">{r.listing_ref.startsWith("http")?"Open source":"Recorded reference"}</a>:"Database observation"}</td></tr>)}</tbody></table></div>; }

export function OpsWorkspace({ mode }: { mode: "inventory" | "sourcing" }) {
  const live=useLiveData<PokemonOpsSnapshot>("pokemon_ops"); const {data,refetch}=useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const {data:productData,refetch:refetchProducts}=useApi<{products:PkProduct[]}>("/api/pokemon-ops/products"); const {data:sourcing}=useApi<SourcingOps>("/api/business/sourcing");
  const snapshot=useMemo(()=>!live?data:!data||Date.parse(live.asOf)>=Date.parse(data.asOf)?live:data,[live,data]);
  const refresh=()=>{refetch();refetchProducts();}; const products=productData?.products??[]; const inventory=mode==="inventory";
  const [inventoryView,setInventoryView]=useState<string>(INVENTORY_VIEWS[0]); const [sourcingView,setSourcingView]=useState<string>(SOURCING_VIEWS[0]);
  return <PokemonDataBoundary><BusinessPage title={inventory?"Inventory":"Sourcing"} description={inventory?"Operate available, allocated, and in-transit stock first; review history or record activity in dedicated views.":"Compare actionable offers with market evidence, supplier decisions, local call-ahead routes, and connector health."} actions={snapshot&&<SourceStamp>Pokemon Ops · <Fresh value={snapshot.asOf}/></SourceStamp>}>
    {!snapshot?<div className="business-empty" role="status"><h2>Loading Pokemon Ops</h2><p>Reading the authenticated operational snapshot.</p></div>:inventory?<>
      <ViewTabs values={INVENTORY_VIEWS} active={inventoryView} onChange={setInventoryView}/>
      {inventoryView==="Active Inventory"&&<><KpiBand snapshot={snapshot}/><BusinessSection title="Active inventory" note={<SourceStamp>{snapshot.machine?.name??"No machine configured"}</SourceStamp>}><SlotTable slots={snapshot.slots}/></BusinessSection></>}
      {inventoryView==="Purchase Lots"&&<BusinessSection title="Purchase lots" note={<SourceStamp>landed cost + status history</SourceStamp>}><RecentLots lots={snapshot.recent_lots}/></BusinessSection>}
      {inventoryView==="Sales"&&<BusinessSection title="Recent sales" note={<SourceStamp>recorded transactions</SourceStamp>}><RecentSales sales={snapshot.recent_sales}/></BusinessSection>}
      {inventoryView==="Record Activity"&&<BusinessSection title="Record activity or import" note={<SourceStamp>existing write APIs preserved</SourceStamp>}><EntryForms products={products} machineId={snapshot.machine?.id??null} onSubmitted={refresh}/></BusinessSection>}
    </>:<>
      <ViewTabs values={SOURCING_VIEWS} active={sourcingView} onChange={setSourcingView}/>
      {!sourcing?<div className="business-empty" role="status"><h2>Loading sourcing evidence</h2><p>Grouping observations, recommendations, and source health.</p></div>:<>
        {sourcingView==="Deals"&&<><div className="business-grid-2"><BusinessSection title="Actionable offers"><PriceTable rows={sourcing.offers} vendor/></BusinessSection><BusinessSection title="Recommendations"><RecommendationsList recommendations={snapshot.open_recommendations} onChanged={refresh}/></BusinessSection></div></>}
        {sourcingView==="Market Prices"&&<BusinessSection title="Market benchmarks" note={<SourceStamp>TCGplayer and eBay evidence</SourceStamp>}><PriceTable rows={sourcing.benchmarks}/></BusinessSection>}
        {sourcingView==="Vendors"&&<BusinessSection title="Vendors and retailers" note={<SourceStamp>decision uses configured alert threshold</SourceStamp>}><PriceTable rows={sourcing.vendors} vendor/></BusinessSection>}
        {sourcingView==="Local Spots"&&<BusinessSection title="Call-ahead routes" note={<SourceStamp>checked {sourcing.local.provenance.checked_at} · inventory not confirmed</SourceStamp>}><div className="local-spots">{sourcing.local.spots.map(s=><article key={s.name}><span>{s.route}</span><h3>{s.name}</h3><p>{s.address}</p><p>{s.phone||"Phone not recorded"}</p><strong>Not confirmed — call/check</strong><small>{s.note}</small></article>)}</div></BusinessSection>}
        {sourcingView==="Sources / Monitors"&&<BusinessSection title="Sources and monitors"><div className="monitor-list">{sourcing.monitors.map(m=><div key={m.id}><span className={`monitor-state ${m.state}`}>{m.state.replaceAll("_"," ")}</span><strong>{m.label}</strong><small>{m.row_count} rows · latest: <Fresh value={m.latest}/></small></div>)}</div></BusinessSection>}
        {sourcingView==="Discord Deals"&&<BusinessSection title="Discord deals" note={<SourceStamp>{sourcing.connector.configured?"Official bot configured":"Not connected"}</SourceStamp>}>{!sourcing.connector.configured?<div className="business-empty !my-0"><h2>Discord is not connected</h2><p>Install an official Discord bot in the guild and watched channels, then add its bot token and numeric channel IDs in Integrations. The bot needs View Channel and Read Message History. Ordinary user login and self-bots are not supported.</p></div>:sourcing.discord.length===0?<p className="text-sm text-txt-muted">Connected, but no relevant normalized deal messages have been stored.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Product text</th><th>Price</th><th>Observed</th><th>Channel</th><th>Match</th><th>Excerpt</th></tr></thead><tbody>{sourcing.discord.map(d=><tr key={d.id}><td><strong>{d.product_text}</strong>{d.url&&<a href={d.url} target="_blank" rel="noreferrer"> Open message</a>}</td><td>{d.price_cents==null?"Not parsed":formatCents(d.price_cents)}</td><td><Fresh value={d.observed_at}/></td><td>{d.channel_id}</td><td>{d.matching_status}</td><td>{d.raw_excerpt}</td></tr>)}</tbody></table></div>}</BusinessSection>}
      </>}
    </>}
  </BusinessPage></PokemonDataBoundary>;
}
