"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { BusinessPage, BusinessSection, Fact, SourceStamp } from "./Page";
import { PokemonDataBoundary } from "./BusinessContext";
import { KpiBand } from "@/components/pokemon-ops/KpiBand";
import { SlotTable } from "@/components/pokemon-ops/SlotTable";
import { RecommendationsList } from "@/components/pokemon-ops/RecommendationsList";
import { RecentSales } from "@/components/pokemon-ops/RecentSales";
import { RecentLots } from "@/components/pokemon-ops/RecentLots";
import { EntryForms } from "@/components/pokemon-ops/EntryForms";
import { formatCents, formatDate } from "@/lib/pokemon-ops/format";
import { formatObservationAge, sourcePriceComparisonForSet } from "@/lib/pokemon-ops/source-price-comparison";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { PkProduct, PkSourceProductBenchmark, PkSourceProductCoverage, PkSourceProductCurrent } from "@/lib/pokemon-ops/types";

type SourcingOps = { offers:any[]; benchmarks:any[]; vendors:any[]; sourceProducts:PkSourceProductCurrent[]; sourceProductBenchmarks:PkSourceProductBenchmark[]; sourceProductCoverage:PkSourceProductCoverage[]; local:{provenance:any;spots:any[]}; discord:any[]; connector:any; monitors:any[] };
const INVENTORY_VIEWS = ["General Inventory","Machine Inventory","Service History","Purchase Lots","Sales","Record Activity"] as const;
const SOURCING_VIEWS = ["Box Targets","Deals","Market Prices","Vendors","Local Spots","Sources / Monitors","Discord Deals"] as const;

function ViewTabs({ values, active, onChange, id }:{values:readonly string[];active:string;onChange:(v:string)=>void;id:string}) { const refs=useRef<Array<HTMLButtonElement|null>>([]);const move=(index:number)=>{onChange(values[index]);refs.current[index]?.focus()};return <div className="business-view-tabs" role="tablist" aria-label={`${id} views`}>{values.map((v,index)=><button ref={el=>{refs.current[index]=el}} id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} tabIndex={active===v?0:-1} onKeyDown={e=>{let n:number|null=null;if(e.key==="ArrowRight")n=(index+1)%values.length;if(e.key==="ArrowLeft")n=(index-1+values.length)%values.length;if(e.key==="Home")n=0;if(e.key==="End")n=values.length-1;if(n!==null){e.preventDefault();move(n)}}} key={v} role="tab" aria-selected={active===v} className={active===v?"active":""} onClick={()=>onChange(v)}>{v}</button>)}</div>; }
function Fresh({ value }:{value:string|null}) { return <span title={value||undefined}>{value ? new Date(value).toLocaleString() : "No observation"}</span>; }
function PriceTable({ rows, actionable=false }:{rows:any[];actionable?:boolean}) { return rows.length===0?<p className="text-sm text-txt-muted">No evidence-backed rows are available for this view.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Product</th><th>Source</th><th>Price / pack</th><th>Benchmark</th>{actionable&&<><th>Delta</th><th>Decision</th><th>Action</th></>}<th>Freshness</th><th>Provenance</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.observation_id}-${r.source}`}><td><strong>{r.display_name||r.set_name}</strong></td><td>{r.source}</td><td>{formatCents(r.price_per_pack_cents)}</td><td>{r.benchmark_cents==null?"No benchmark":`${formatCents(r.benchmark_cents)} · ${r.benchmark_source}`}</td>{actionable&&<><td>{r.delta_cents==null?"Unknown":formatCents(r.delta_cents)}</td><td><span className={`ops-decision ${r.decision}`}>{r.decision}</span></td><td><a className="text-accent underline" href={`/business/inventory?view=record&product=${encodeURIComponent(r.product_id)}&source=${encodeURIComponent(r.source)}&price=${encodeURIComponent(r.price_per_pack_cents)}`}>Record purchase</a></td></>}<td><Fresh value={r.observed_date}/></td><td>{r.listing_ref?<a href={r.listing_ref.startsWith("http")?r.listing_ref:undefined} rel="noreferrer" target="_blank">{r.listing_ref.startsWith("http")?"Open source":"Recorded reference"}</a>:"Database observation"}</td></tr>)}</tbody></table></div>; }
function VendorTable({rows}:{rows:any[]}){return rows.length===0?<p className="text-sm text-txt-muted">No supplier quotes are available.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Provider</th><th>Products covered</th><th>Latest quote</th><th>Best / current</th><th>Delta</th></tr></thead><tbody>{rows.map(r=><tr key={r.source}><td><strong>{r.provider_name}</strong></td><td>{r.products_covered.join(", ")}</td><td><Fresh value={r.latest_quote}/></td><td>{formatCents(r.best_price_cents)}</td><td>{r.delta_cents==null?"Unknown":formatCents(r.delta_cents)}</td></tr>)}</tbody></table></div>}

function SourceProductTargets({rows,benchmarks,coverage}:{rows:PkSourceProductCurrent[];benchmarks:PkSourceProductBenchmark[];coverage:PkSourceProductCoverage[]}) {
  const [setFilter,setSetFilter]=useState("all");
  const [selectedProductId,setSelectedProductId]=useState<number|null>(null);
  const sets=Array.from(new Set(rows.map(row=>row.set_name))).sort();
  const visible=setFilter==="all"?rows:rows.filter(row=>row.set_name===setFilter);
  const comparison=sourcePriceComparisonForSet(setFilter,benchmarks);
  const selectedProduct=visible.find(row=>row.source_product_id===selectedProductId)??null;
  const mediumBuyPppCents=selectedProduct?.medium_ppp_cents??comparison?.medium_buy_ppp_cents??null;
  const selectProduct=(row:PkSourceProductCurrent)=>{setSetFilter(row.set_name);setSelectedProductId(row.source_product_id)};
  const money=(cents:number|null)=>cents==null?"Not listed":formatCents(Math.round(cents));
  const comparisonMoney=(cents:number|null)=>cents==null?"Not available":formatCents(Math.round(cents));
  const freshnessTitle=(sourceDate:string|null,observedAt:string|null)=>[
    sourceDate?`Source date: ${sourceDate}`:null,
    observedAt?`Recorded in Rathworkspace: ${observedAt}`:null,
  ].filter(Boolean).join(" · ")||undefined;
  return <>
    <div className="business-facts" data-testid="source-product-summary">
      <Fact label="Valued products" value={rows.length} detail="exact English sealed forms"/>
      <Fact label="Sets covered" value={`${coverage.filter(row=>row.valued_product_count>0).length}/${coverage.length}`} detail="CardDistro-observed sets"/>
      <Fact label="High ceiling" value="15% below" detail="lower of TCGplayer pack and CardDistro"/>
      <Fact label="Extras value" value="$0" detail="promos, sleeves, tins, posters, binders"/>
    </div>
    <BusinessSection title="Box and sealed-product buy targets" note={<SourceStamp>append-only dated snapshots · pack economics only</SourceStamp>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="source-product-set">Set</label>
        <select id="source-product-set" className="rounded-md border border-white/20 bg-surface px-3 py-2 text-sm text-txt" value={setFilter} onChange={event=>{setSetFilter(event.target.value);setSelectedProductId(null)}}>
          <option value="all">All sets</option>{sets.map(set=><option key={set} value={set}>{set}</option>)}
        </select>
        <span className="text-sm text-txt-muted">Low / medium / high are all acceptable; low is preferred. All-in deal cost must include tax, shipping, fees, and travel.</span>
      </div>
      {comparison===null?
        <div className="mb-4 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700" data-testid="source-price-comparison-empty">Select a specific set to compare per-pack prices.</div>:
        <div className="mb-4 rounded-lg border-2 border-slate-300 bg-white p-3 text-slate-950 shadow-sm" data-testid="source-price-comparison" role="group" aria-label={`${comparison.set_name} per-pack price comparison`}>
          <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">{selectedProduct?.name??comparison.set_name} · per pack</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-orange-300 bg-orange-50 px-3 py-3"><span className="block text-xs font-bold text-orange-900">Medium buy level</span><strong className="mt-1 block text-xl text-slate-950">{comparisonMoney(mediumBuyPppCents)}</strong><small className="mt-1 block text-xs text-slate-700">Your medium buy target per pack</small></div>
            <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-3"><span className="block text-xs font-bold text-slate-800">TCGplayer</span><strong className="mt-1 block text-xl text-slate-950">{comparisonMoney(comparison.tcgplayer_ppp_cents)}</strong><small className="mt-1 block text-xs text-slate-700" title={freshnessTitle(comparison.tcgplayer_observed_date,comparison.tcgplayer_observed_at)}>{formatObservationAge(comparison.tcgplayer_observed_at)}</small></div>
            <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-3"><span className="block text-xs font-bold text-slate-800">CardDistro</span><strong className="mt-1 block text-xl text-slate-950">{comparisonMoney(comparison.carddistro_ppp_cents)}</strong><small className="mt-1 block text-xs text-slate-700" title={freshnessTitle(comparison.carddistro_observed_date,comparison.carddistro_observed_at)}>{formatObservationAge(comparison.carddistro_observed_at)}</small></div>
          </div>
        </div>}
      {visible.length===0?<p className="text-sm text-txt-muted">No dated sealed-product values are available for this filter.</p>:<div className="business-table-wrap"><table className="business-ops-table" data-testid="source-product-targets"><thead><tr><th>Exact product</th><th>Packs</th><th>TCG sealed market</th><th>Pack benchmarks</th><th>Low buy</th><th>Medium buy</th><th>High buy</th><th>Snapshot</th></tr></thead><tbody>{visible.map(row=><tr key={row.source_product_id} data-selected={selectedProductId===row.source_product_id?"true":undefined} className="cursor-pointer" tabIndex={0} onClick={()=>selectProduct(row)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();selectProduct(row)}}}><td><strong className="text-accent underline">{row.name}</strong><small>{row.set_name} · {row.form.replaceAll("_"," ")} · <a className="underline" href={row.tcgplayer_url} rel="noreferrer" target="_blank" onClick={event=>event.stopPropagation()}>TCGplayer listing</a></small></td><td><strong>{row.pack_count}</strong><small title={row.pack_count_note}>verified count</small></td><td><strong>{money(row.tcg_market_cents)}</strong><small>{row.tcg_market_ppp_cents==null?"No sealed market":`${money(row.tcg_market_ppp_cents)} / pack`}</small></td><td><strong>{money(row.benchmark_ppp_cents)} / pack</strong><small>TCGplayer {money(row.pack_tcg_cents)} · CardDistro {money(row.carddistro_cents)}</small></td><td><strong>{money(row.low_total_cents)}</strong><small>{money(row.low_ppp_cents)} / pack</small></td><td><strong>{money(row.medium_total_cents)}</strong><small>{money(row.medium_ppp_cents)} / pack</small></td><td><strong>{money(row.high_total_cents)}</strong><small>{money(row.high_ppp_cents)} / pack</small></td><td><strong>{formatDate(row.observed_date)}</strong><small>historical row preserved</small></td></tr>)}</tbody></table></div>}
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-txt-muted">{coverage.map(row=><span key={row.set_name} className={`rounded-full border px-2 py-1 ${row.valued_product_count>0?"border-emerald-500/40":"border-amber-500/50 text-amber-300"}`}>{row.set_name}: {row.valued_product_count}/{row.source_product_count||0}</span>)}</div>
    </BusinessSection>
  </>;
}

function GeneralInventoryPanel({snapshot}:{snapshot:PokemonOpsSnapshot}) {
  const {kpis}=snapshot;
  return <>
    <div className="business-facts" data-testid="general-inventory-summary">
      <Fact label="Unassigned packs" value={kpis.general_inventory_units} detail="received stock not loaded into a machine"/>
      <Fact label="Cost basis" value={formatCents(kpis.general_inventory_cost_cents)} detail="what the unassigned stock cost"/>
      <Fact label="Est. market value" value={formatCents(kpis.general_inventory_market_cents)} detail={kpis.general_inventory_market_cents==null?"missing a market benchmark":"latest TCGplayer / eBay sold prices"}/>
      <Fact label="In transit" value={`${kpis.in_transit_units} packs`} detail={`${formatCents(kpis.in_transit_cost_cents)} cost basis`}/>
    </div>
    <BusinessSection title="General inventory" note={<SourceStamp>not assigned to a machine</SourceStamp>}>
      {snapshot.general_inventory.length===0?<p className="text-sm text-txt-muted">No unassigned or in-transit inventory is recorded.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Product</th><th>Unassigned packs</th><th>Cost basis</th><th>Est. market value</th><th>Market benchmark</th><th>In transit</th></tr></thead><tbody>{snapshot.general_inventory.map(row=><tr key={row.product_id} data-testid={`general-inventory-row-${row.product_id}`}><td><strong>{row.set_name}</strong></td><td><strong>{row.on_hand_units}</strong></td><td>{formatCents(row.cost_value_cents)}</td><td>{formatCents(row.estimated_market_value_cents)}</td><td>{row.market_price_per_pack_cents==null?"No benchmark":<><strong>{formatCents(row.market_price_per_pack_cents)} / pack</strong><small>{row.market_source} · {formatDate(row.market_observed_date)}</small></>}</td><td><strong>{row.in_transit_units} packs</strong><small>{formatCents(row.in_transit_cost_cents)} cost</small></td></tr>)}</tbody></table></div>}
    </BusinessSection>
  </>;
}

export function OpsWorkspace({ mode }: { mode: "inventory" | "sourcing" }) {
  const live=useLiveData<PokemonOpsSnapshot>("pokemon_ops"); const {data,refetch,error}=useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const {data:productData,refetch:refetchProducts}=useApi<{products:PkProduct[]}>("/api/pokemon-ops/products"); const {data:sourcing,error:sourcingError,refetch:refetchSourcing}=useApi<SourcingOps>("/api/business/sourcing");
  const {data:serviceData}=useApi<any>("/api/business/service");
  const snapshot=useMemo(()=>!live?data:!data||Date.parse(live.asOf)>=Date.parse(data.asOf)?live:data,[live,data]);
  const refresh=()=>{refetch();refetchProducts();}; const products=productData?.products??[]; const inventory=mode==="inventory";
  const [inventoryView,setInventoryView]=useState<string>(INVENTORY_VIEWS[0]); const [sourcingView,setSourcingView]=useState<string>(SOURCING_VIEWS[0]);
  const [prefill,setPrefill]=useState<{productId?:number;source?:string;priceCents?:number}>({});useEffect(()=>{if(mode!=="inventory")return;const q=new URLSearchParams(window.location.search);if(q.get("view")==="record"){setInventoryView("Record Activity");setPrefill({productId:Number(q.get("product"))||undefined,source:q.get("source")||undefined,priceCents:Number(q.get("price"))||undefined});}},[mode]);
  return <PokemonDataBoundary><BusinessPage title={inventory?"Inventory":"Sourcing"} description={inventory?"Operate available, allocated, and in-transit stock first; review history or record activity in dedicated views.":"Compare actionable offers with market evidence, supplier decisions, local call-ahead routes, and connector health."} actions={snapshot&&<SourceStamp>Pokemon Ops · <Fresh value={snapshot.asOf}/></SourceStamp>}>
    {!snapshot?<div className="business-empty" role={error?"alert":"status"}><h2>{error?"Could not load Pokemon Ops":"Loading Pokemon Ops"}</h2><p>{error||"Reading the authenticated operational snapshot."}</p>{error&&<button onClick={refetch}>Retry</button>}</div>:inventory?<>
      <ViewTabs id="inventory" values={INVENTORY_VIEWS} active={inventoryView} onChange={setInventoryView}/><div role="tabpanel" id={`inventory-panel-${INVENTORY_VIEWS.indexOf(inventoryView as any)}`} aria-labelledby={`inventory-tab-${INVENTORY_VIEWS.indexOf(inventoryView as any)}`}>
      {inventoryView==="General Inventory"&&<GeneralInventoryPanel snapshot={snapshot}/>}
      {inventoryView==="Machine Inventory"&&<><KpiBand snapshot={snapshot}/><BusinessSection title="Machine inventory" note={<SourceStamp>{snapshot.machine?.name??"No machine configured"}</SourceStamp>}><SlotTable slots={snapshot.slots}/></BusinessSection></>}
      {inventoryView==="Service History"&&<BusinessSection title="Service history" note={<SourceStamp>Physical count evidence · estimates separate</SourceStamp>}>{!serviceData?.history?.length?<p className="text-sm text-txt-muted">No completed physical-count visits yet.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Machine</th><th>Verified at</th><th>Actor</th><th>Physical count</th><th>Estimated dispensed / revenue</th><th>Exact cash</th><th>Condition</th></tr></thead><tbody>{serviceData.history.map((v:any)=><tr key={v.id}><td><strong>{v.machine_name}</strong>Visit {v.id}</td><td>{new Date(v.completed_at).toLocaleString()}</td><td>{v.actor_email}</td><td>{v.slot_count} slots · {v.verified_units} verified units</td><td>{v.estimated_dispensed} units · {formatCents(v.estimated_revenue_cents)} estimated</td><td>{v.cash_collected_cents==null?"Unknown":`${formatCents(v.cash_collected_cents)} exact`}</td><td>{v.condition_before.replaceAll("_"," ")} → {v.condition_after.replaceAll("_"," ")}</td></tr>)}</tbody></table></div>}</BusinessSection>}
      {inventoryView==="Purchase Lots"&&<BusinessSection title="Purchase lots" note={<SourceStamp>landed cost + status history</SourceStamp>}><RecentLots lots={snapshot.recent_lots}/></BusinessSection>}
      {inventoryView==="Sales"&&<BusinessSection title="Recent sales" note={<SourceStamp>recorded transactions</SourceStamp>}><RecentSales sales={snapshot.recent_sales}/></BusinessSection>}
      {inventoryView==="Record Activity"&&<BusinessSection title="Record activity or import" note={<SourceStamp>existing write APIs preserved</SourceStamp>}><EntryForms products={products} machineId={snapshot.machine?.id??null} onSubmitted={refresh} purchasePrefill={prefill}/></BusinessSection>}</div>
    </>:<>
      <ViewTabs id="sourcing" values={SOURCING_VIEWS} active={sourcingView} onChange={setSourcingView}/><div role="tabpanel" id={`sourcing-panel-${SOURCING_VIEWS.indexOf(sourcingView as any)}`} aria-labelledby={`sourcing-tab-${SOURCING_VIEWS.indexOf(sourcingView as any)}`}>
      {!sourcing?<div className="business-empty" role={sourcingError?"alert":"status"}><h2>{sourcingError?"Could not load sourcing evidence":"Loading sourcing evidence"}</h2><p>{sourcingError||"Grouping observations, recommendations, and source health."}</p>{sourcingError&&<button onClick={refetchSourcing}>Retry</button>}</div>:<>
        {sourcingView==="Box Targets"&&<SourceProductTargets rows={sourcing.sourceProducts??[]} benchmarks={sourcing.sourceProductBenchmarks??[]} coverage={sourcing.sourceProductCoverage??[]}/>}
        {sourcingView==="Deals"&&<><div className="business-grid-2"><BusinessSection title="Actionable offers"><PriceTable rows={sourcing.offers} actionable/></BusinessSection><BusinessSection title="Recommendations"><RecommendationsList recommendations={snapshot.open_recommendations} onChanged={refresh}/></BusinessSection></div></>}
        {sourcingView==="Market Prices"&&<BusinessSection title="Market benchmarks" note={<SourceStamp>TCGplayer and eBay evidence</SourceStamp>}><PriceTable rows={sourcing.benchmarks}/></BusinessSection>}
        {sourcingView==="Vendors"&&<BusinessSection title="Vendors and retailers" note={<SourceStamp>grouped by observed provider</SourceStamp>}><VendorTable rows={sourcing.vendors}/></BusinessSection>}
        {sourcingView==="Local Spots"&&<BusinessSection title="Call-ahead routes" note={<SourceStamp>checked {sourcing.local.provenance.checked_at} · inventory not confirmed</SourceStamp>}><div className="local-spots">{sourcing.local.spots.map(s=><article key={s.name}><span>{s.route}</span><h3>{s.name}</h3><p>{s.address}</p><p>{s.phone||"Phone not recorded"}</p><strong>Not confirmed — call/check</strong><small>{s.note}</small></article>)}</div></BusinessSection>}
        {sourcingView==="Sources / Monitors"&&<BusinessSection title="Sources and monitors"><div className="monitor-list">{sourcing.monitors.map(m=><div key={m.id}><span className={`monitor-state ${m.state}`}>{m.state.replaceAll("_"," ")}</span><strong>{m.label}</strong><small>{m.row_count} rows · latest: <Fresh value={m.latest}/></small></div>)}</div></BusinessSection>}
        {sourcingView==="Discord Deals"&&<BusinessSection title="Discord deals" note={<SourceStamp>{sourcing.connector.configured?"Official bot configured":"Not connected"}</SourceStamp>}>{!sourcing.connector.configured?<div className="business-empty !my-0"><h2>Discord is not connected</h2><p>Install an official Discord bot in the guild and watched channels, then add its bot token and numeric channel IDs in Integrations. The bot needs View Channel and Read Message History. Ordinary user login and self-bots are not supported.</p></div>:sourcing.discord.length===0?<p className="text-sm text-txt-muted">Connected, but no relevant normalized deal messages have been stored.</p>:<div className="business-table-wrap"><table className="business-ops-table"><thead><tr><th>Product text</th><th>Price</th><th>Observed</th><th>Channel</th><th>Match</th><th>Excerpt</th></tr></thead><tbody>{sourcing.discord.map(d=><tr key={d.id}><td><strong>{d.product_text}</strong>{d.url&&<a href={d.url} target="_blank" rel="noreferrer"> Open message</a>}</td><td>{d.price_cents==null?"Not parsed":formatCents(d.price_cents)}</td><td><Fresh value={d.observed_at}/></td><td>{d.channel_id}</td><td>{d.matching_status}</td><td>{d.raw_excerpt}</td></tr>)}</tbody></table></div>}</BusinessSection>}
      </>}</div>
    </>}
  </BusinessPage></PokemonDataBoundary>;
}
