"use client";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { Snapshot as CrmSnapshot } from "@/components/pokemon-crm/types";
import { BusinessPage, BusinessSection, Fact, SourceStamp } from "./Page";
import { useBusinessUnit } from "./BusinessContext";

export default function OverviewWorkspace() {
  const { unit } = useBusinessUnit();
  const { data: crm } = useApi<CrmSnapshot>("/api/pokemon-crm");
  const { data: opsHttp } = useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const ops = useLiveData<PokemonOpsSnapshot>("pokemon_ops") || opsHttp;
  const { data: vendingHttp } = useApi<any>("/api/vending");
  const vending = useLiveData<any>("vending") || vendingHttp;
  const { data: agentRuns } = useApi<any>("/api/agents/runs");
  const websocket = useConnStatus();
  if (unit === "portable-charging" || unit === "subtap") return <BusinessPage title="Overview" description="Daily business operating view."><div className="business-empty"><h2>{unit === "subtap" ? "Subtap" : "Portable Charging"} has no operational data integration yet</h2><p>Relevant agent work may still appear under Agents. No Pokemon metrics are being relabeled for this unit.</p></div></BusinessPage>;
  const leads = crm?.leads ?? [];
  const followups = leads.filter((lead) => lead.stage === "follow_up" || (lead.next_action_due || "").toLowerCase().startsWith("overdue")).length;
  const businessAgents = (agentRuns?.agents ?? []).filter((agent: any) => /(pokemon|vending|portable|charging|subtap|platform)/i.test(`${agent.slug} ${agent.display_name} ${agent.description || ""}`));
  return <BusinessPage title="Overview" description="A truthful daily view assembled from the existing CRM, vending, Pokemon Ops, agent, and live-connection sources." actions={<SourceStamp>WebSocket {websocket}</SourceStamp>}>
    <div className="business-facts">
      <Fact label="CRM follow-ups" value={crm ? followups : "—"} detail={crm ? `${leads.length} Pokemon leads · API current` : "Source unavailable"} />
      <Fact label="Machines needing refill" value={vending ? vending.needsRefill : "—"} detail={vending ? `${vending.liveMachines} live · vending snapshot` : "Source unavailable"} />
      <Fact label="Open recommendations" value={ops ? ops.open_recommendations.length : "—"} detail={ops ? `Pokemon Ops · ${new Date(ops.asOf).toLocaleTimeString()}` : "Source unavailable"} />
      <Fact label="Business agent runs" value={agentRuns ? businessAgents.length : "—"} detail="real filtered registry" />
    </div>
    <div className="business-grid-2">
      <BusinessSection title="Today’s operating queue"><div className="business-list"><Link href="/business/crm" className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Review CRM follow-ups</span><strong className="text-accent">{crm ? followups : "Unavailable"}</strong></Link><Link href="/business/locations" className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Check machine refills</span><strong className="text-accent">{vending ? vending.needsRefill : "Unavailable"}</strong></Link><Link href="/business/sourcing" className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Review sourcing recommendations</span><strong className="text-accent">{ops ? ops.open_recommendations.length : "Unavailable"}</strong></Link></div></BusinessSection>
      <BusinessSection title="Source health"><div className="business-list"><div className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Live updates</span><SourceStamp>{websocket}</SourceStamp></div><div className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Pokemon CRM</span><SourceStamp>{crm ? "available" : "loading / unavailable"}</SourceStamp></div><div className="flex min-h-14 items-center justify-between py-3 text-sm"><span>Pokemon Ops</span><SourceStamp>{ops ? `as of ${new Date(ops.asOf).toLocaleString()}` : "loading / unavailable"}</SourceStamp></div></div></BusinessSection>
    </div>
  </BusinessPage>;
}
