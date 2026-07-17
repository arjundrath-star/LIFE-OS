"use client";
import { EmptyState } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { formatCents } from "@/lib/pokemon-ops/format";
import type { PkPurchaseLot } from "@/lib/pokemon-ops/types";

export function RecentLots({ lots }: { lots: Array<PkPurchaseLot & { set_name: string }> }) {
  if (lots.length === 0) {
    return <EmptyState title="no purchase lots yet" hint="log one with the lot form below" />;
  }
  return (
    <div className="space-y-1.5" data-testid="recent-lots">
      {lots.map((l) => (
        <div key={l.id} data-testid={`lot-row-${l.id}`} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-txt-primary">
            {l.set_name} <span className="text-txt-faint">· {l.pack_count} packs · {l.source}</span>
          </span>
          <span className="shrink-0 font-mono text-txt-muted">{formatCents(l.total_cost_cents)}</span>
          <Badge tone={l.status === "in_transit" ? "warn" : "muted"} className="shrink-0">
            {l.status}
          </Badge>
          <span className="shrink-0 font-mono text-[10px] text-txt-faint">{l.purchase_date}</span>
        </div>
      ))}
    </div>
  );
}
