"use client";
// Pokemon Ops — machine performance + sourcing dashboard. Live via the
// 'pokemon_ops' WS channel (60s scheduler tick), API GET fallback for first
// paint and for instant refresh right after a form mutation (the live channel
// only refreshes on its own 60s cadence, too slow to reflect a just-submitted
// form — so after any mutation we explicitly refetch and prefer whichever
// snapshot is newer by `asOf`).
import { useMemo } from "react";
import { Boxes, Package, Radar, ClipboardList, ShoppingCart, Layers } from "lucide-react";
import { ProjectPage, Section } from "@/components/shell/ProjectPage";
import { EmptyState } from "@/components/Panel";
import { useLiveData } from "@/hooks/useLiveData";
import { useApi } from "@/hooks/useApi";
import { KpiBand } from "@/components/pokemon-ops/KpiBand";
import { SlotTable } from "@/components/pokemon-ops/SlotTable";
import { RecommendationsList } from "@/components/pokemon-ops/RecommendationsList";
import { RecentSales } from "@/components/pokemon-ops/RecentSales";
import { SourcingFeed } from "@/components/pokemon-ops/SourcingFeed";
import { RecentLots } from "@/components/pokemon-ops/RecentLots";
import { EntryForms } from "@/components/pokemon-ops/EntryForms";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import type { PkProduct } from "@/lib/pokemon-ops/types";

export default function PokemonOpsPage() {
  const live = useLiveData<PokemonOpsSnapshot>("pokemon_ops");
  const { data, refetch } = useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const { data: productsResp, refetch: refetchProducts } = useApi<{ products: PkProduct[] }>(
    "/api/pokemon-ops/products"
  );

  const snap = useMemo(() => {
    if (!live) return data;
    if (!data) return live;
    return Date.parse(live.asOf) >= Date.parse(data.asOf) ? live : data;
  }, [live, data]);

  const onSubmitted = () => {
    refetch();
    refetchProducts();
  };

  const products = productsResp?.products ?? [];

  return (
    <ProjectPage
      title="Pokemon Ops"
      icon={<Boxes size={18} />}
      subtitle="Vending machine performance, sourcing feed, and margin tracking for the Pokemon card machine."
      statusDot={snap?.machine ? "healthy" : "off"}
      statusLabel={snap?.machine ? snap.machine.name : "no machine yet"}
      hero={
        snap ? (
          <KpiBand snapshot={snap} />
        ) : (
          <EmptyState title="loading snapshot" hint="reading pk_* tables" />
        )
      }
    >
      {!snap ? (
        <Section>
          <EmptyState title="loading" />
        </Section>
      ) : (
        <>
          <Section title="Slots" icon={<Layers size={13} />}>
            <SlotTable slots={snap.slots} />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="Open recommendations"
              icon={<ClipboardList size={13} />}
              right={
                <span className="font-mono text-[10px] text-txt-faint">
                  {snap.open_recommendations.length} open
                </span>
              }
            >
              <RecommendationsList recommendations={snap.open_recommendations} onChanged={onSubmitted} />
            </Section>

            <Section title="Recent sales" icon={<ShoppingCart size={13} />}>
              <RecentSales sales={snap.recent_sales} />
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Sourcing feed" icon={<Radar size={13} />}>
              <SourcingFeed rows={snap.sourcing_feed} />
            </Section>

            <Section title="Purchase lots" icon={<Package size={13} />}>
              <RecentLots lots={snap.recent_lots} />
            </Section>
          </div>

          <Section title="Entry forms" bodyClassName="pt-4">
            <EntryForms products={products} machineId={snap.machine?.id ?? null} onSubmitted={onSubmitted} />
          </Section>
        </>
      )}
    </ProjectPage>
  );
}
