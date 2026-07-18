"use client";
import { EmptyState } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/pokemon-ops/format";
import type { PokemonOpsSourcingRow } from "@/lib/pokemon-ops/snapshot";

export function SourcingFeed({ rows }: { rows: PokemonOpsSourcingRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="no price observations yet"
        hint="log a sourcing offer or external market observation below"
      />
    );
  }
  return (
    <div className="space-y-1.5" data-testid="sourcing-feed">
      {rows.map((r) => (
        <div key={r.observation_id} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-txt-primary">
            {r.set_name} <span className="text-txt-faint">· {r.source}</span>
          </span>
          <span className="shrink-0 font-mono text-txt-muted">{formatCents(r.price_per_pack_cents)}</span>
          <span className="shrink-0">
            {r.benchmark_delta_cents === null ? (
              <Badge tone="muted">no benchmark</Badge>
            ) : r.benchmark_delta_cents <= 0 ? (
              <Badge tone="healthy">{formatCents(r.benchmark_delta_cents)}</Badge>
            ) : (
              <Badge tone="warn">+{formatCents(r.benchmark_delta_cents)}</Badge>
            )}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-txt-faint">{formatDate(r.observed_date)}</span>
        </div>
      ))}
    </div>
  );
}
