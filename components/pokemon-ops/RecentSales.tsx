"use client";
import { EmptyState } from "@/components/Panel";
import { formatCents } from "@/lib/pokemon-ops/format";
import { timeAgo } from "@/lib/time";
import type { PkSale } from "@/lib/pokemon-ops/types";

export function RecentSales({ sales }: { sales: Array<PkSale & { set_name: string }> }) {
  if (sales.length === 0) {
    return <EmptyState title="no sales logged" hint="log a sale with the quick-sales form below, or import a CSV" />;
  }
  return (
    <div className="space-y-1.5" data-testid="recent-sales">
      {sales.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-txt-primary">
            {s.set_name} <span className="text-txt-faint">· slot {s.slot_number}</span>
          </span>
          <span className="shrink-0 font-mono text-txt-muted">
            {s.qty} × {formatCents(s.unit_price_cents)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-txt-faint">{timeAgo(s.sold_at)}</span>
        </div>
      ))}
    </div>
  );
}
