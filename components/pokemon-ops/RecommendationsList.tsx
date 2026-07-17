"use client";
// Open recommendations with Ack/Dismiss. PATCH /api/pokemon-ops/recommendations.
import { useState } from "react";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/Panel";
import { apiPost } from "@/hooks/useApi";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";
import type { PokemonOpsRecommendation } from "@/lib/pokemon-ops/snapshot";

const SEVERITY_TONE: Record<string, string> = {
  urgent: "border-error/40 text-error",
  action: "border-warn/40 text-warn",
  info: "border-border text-txt-faint",
};

function summarize(rec: PokemonOpsRecommendation): string {
  const p = rec.payload as any;
  switch (rec.rule) {
    case "refill_sync":
      return `Refill sync: spread ${Number(p?.spread_days ?? 0).toFixed(1)}d across slots (threshold ${p?.threshold_days}d)`;
    case "price_raise":
      return `Price raise on slot ${rec.slot_number} (${p?.set_name}): sellout in ${Number(p?.days_of_supply ?? 0).toFixed(1)}d — suggest $${((p?.suggested_price_min_cents ?? 0) / 100).toFixed(2)}–$${((p?.suggested_price_max_cents ?? 0) / 100).toFixed(2)}`;
    case "add_slot":
      return `Add slot for ${p?.set_name} (fast slot ${p?.fast_slot}) — candidate slot ${p?.candidate_slot} (${p?.candidate_kind})`;
    case "dead_stock":
      return `Dead stock: slot ${rec.slot_number} (${p?.set_name}), no sales in ${p?.window_days}d`;
    case "refill_order":
      return `Refill order ready: ${(p?.items?.length ?? 0)} item(s), $${((p?.spent_cents ?? 0) / 100).toFixed(2)} of $${((p?.budget_cents ?? 0) / 100).toFixed(2)} budget`;
    default:
      return `${rec.rule} (machine ${rec.machine_id ?? "—"}, slot ${rec.slot_number ?? "—"})`;
  }
}

export function RecommendationsList({
  recommendations,
  onChanged,
}: {
  recommendations: PokemonOpsRecommendation[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (id: number, action: "ack" | "dismiss") => {
    setBusyId(id);
    try {
      await apiPost("/api/pokemon-ops/recommendations", { id, action });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  if (recommendations.length === 0) {
    return <EmptyState title="no open recommendations" hint="the rules engine runs daily — nothing needs action right now" />;
  }

  return (
    <div className="space-y-2" data-testid="recommendations-list">
      {recommendations.map((rec) => (
        <div
          key={rec.id}
          data-testid={`recommendation-${rec.id}`}
          className={cn(
            "flex items-start justify-between gap-3 rounded-inner border bg-panel-2/30 px-3 py-2.5",
            SEVERITY_TONE[rec.severity] ?? SEVERITY_TONE.info
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider">{rec.severity}</span>
              <span className="font-mono text-[10px] text-txt-faint">{rec.rule}</span>
              <span className="ml-auto font-mono text-[10px] text-txt-faint">{timeAgo(rec.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-txt-primary">{summarize(rec)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Button's prop type has no data-* index signature; `id` is a
                declared HTML attribute and works identically as an E2E selector. */}
            <Button
              id={`ack-${rec.id}`}
              size="sm"
              variant="accent"
              disabled={busyId === rec.id}
              onClick={() => act(rec.id, "ack")}
            >
              Ack
            </Button>
            <Button
              id={`dismiss-${rec.id}`}
              size="sm"
              variant="ghost"
              disabled={busyId === rec.id}
              onClick={() => act(rec.id, "dismiss")}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
