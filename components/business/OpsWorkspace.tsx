"use client";

import { useMemo } from "react";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { BusinessPage, BusinessSection, SourceStamp } from "./Page";
import { PokemonDataBoundary } from "./BusinessContext";
import { KpiBand } from "@/components/pokemon-ops/KpiBand";
import { SlotTable } from "@/components/pokemon-ops/SlotTable";
import { RecommendationsList } from "@/components/pokemon-ops/RecommendationsList";
import { RecentSales } from "@/components/pokemon-ops/RecentSales";
import { SourcingFeed } from "@/components/pokemon-ops/SourcingFeed";
import { RecentLots } from "@/components/pokemon-ops/RecentLots";
import { EntryForms } from "@/components/pokemon-ops/EntryForms";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { PkProduct } from "@/lib/pokemon-ops/types";

export function OpsWorkspace({ mode }: { mode: "inventory" | "sourcing" }) {
  const live = useLiveData<PokemonOpsSnapshot>("pokemon_ops");
  const { data, refetch } = useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const { data: productData, refetch: refetchProducts } = useApi<{ products: PkProduct[] }>("/api/pokemon-ops/products");
  const snapshot = useMemo(() => !live ? data : !data || Date.parse(live.asOf) >= Date.parse(data.asOf) ? live : data, [live, data]);
  const refresh = () => { refetch(); refetchProducts(); };
  const products = productData?.products ?? [];
  const inventory = mode === "inventory";

  return <PokemonDataBoundary><BusinessPage
    title={inventory ? "Inventory" : "Sourcing"}
    description={inventory ? "Real machine stock, slot assignments, purchase lots, sales, and cost-backed entry workflows." : "Live price observations, benchmark comparisons, recommendations, purchase decisions, and the existing sourcing ingestion workflow."}
    actions={snapshot && <SourceStamp>pk_* read model · as of {new Date(snapshot.asOf).toLocaleString()}</SourceStamp>}
  >
    {!snapshot ? <div className="business-empty"><h2>Loading Pokemon Ops</h2><p>Reading the existing authenticated snapshot.</p></div> : inventory ? <>
      <KpiBand snapshot={snapshot} />
      <BusinessSection title="Machine slots" note={<SourceStamp>{snapshot.machine?.name ?? "No machine configured"}</SourceStamp>}><SlotTable slots={snapshot.slots} /></BusinessSection>
      <div className="business-grid-2">
        <BusinessSection title="Recent sales"><RecentSales sales={snapshot.recent_sales} /></BusinessSection>
        <BusinessSection title="Purchase lots"><RecentLots lots={snapshot.recent_lots} /></BusinessSection>
      </div>
      <BusinessSection title="Inventory entry and import"><EntryForms products={products} machineId={snapshot.machine?.id ?? null} onSubmitted={refresh} /></BusinessSection>
    </> : <>
      <div className="business-grid-2">
        <BusinessSection title="Price observations" note={<SourceStamp>{snapshot.sourcing_feed.length} latest source observations</SourceStamp>}><SourcingFeed rows={snapshot.sourcing_feed} /></BusinessSection>
        <BusinessSection title="Recommendations" note={<SourceStamp>{snapshot.open_recommendations.length} open</SourceStamp>}><RecommendationsList recommendations={snapshot.open_recommendations} onChanged={refresh} /></BusinessSection>
      </div>
      <BusinessSection title="Purchase lots"><RecentLots lots={snapshot.recent_lots} /></BusinessSection>
      <BusinessSection title="Sourcing ingestion and purchase entry"><EntryForms products={products} machineId={snapshot.machine?.id ?? null} onSubmitted={refresh} /></BusinessSection>
      <div className="business-empty"><h2>Scheduled sourcing engine</h2><p>The existing worker fetches TCGplayer and eBay observations, imports them idempotently, runs recommendation rules, and records agent events. It is scheduled through Hermes; manual server trigger: <code>agents/pokemon-sourcing-scout/scripts/pokemon_sourcing_worker.sh</code>. This UI reads its real output and does not duplicate the engine.</p></div>
    </>}
  </BusinessPage></PokemonDataBoundary>;
}
