"use client";
import { useEffect } from "react";
import { Panel, EmptyState } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { DollarSign, Boxes, AlertCircle } from "lucide-react";

const STAGES: { key: string; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "verbal_yes", label: "Verbal yes" },
  { key: "placing", label: "Placing" },
  { key: "live", label: "Live" },
];

export function VendingPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const { data, refetch } = useApi<any>("/api/vending");
  const live = useLiveData<any>("vending");
  const v = live || data;

  useEffect(() => {
    if (live) return;
  }, [live]);

  if (!v) {
    return (
      <Panel title="Vending" icon={<Boxes size={13} />} onExpand={onExpand}>
        <EmptyState title="loading" />
      </Panel>
    );
  }

  const maxStage = Math.max(1, ...STAGES.map((s) => v.stages?.[s.key] ?? 0));

  return (
    <Panel
      title="Vending ops"
      icon={<Boxes size={13} />}
      state={v.needsRefill > 0 ? "warn" : "healthy"}
      subtitle={`${v.machines?.length ?? 0} machines`}
      onExpand={onExpand}
      bodyClassName="space-y-3"
    >
      {/* revenue */}
      <div className="rounded-inner border border-border/70 bg-panel-2/30 p-3">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">
          <DollarSign size={11} /> revenue (7d)
        </div>
        {v.revenueConnected ? (
          <div className="font-mono text-2xl text-accent">${((v.revenueLast7Cents ?? 0) / 100).toFixed(2)}</div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="font-mono text-2xl text-off">$—</span>
            <Badge tone="off" className="!normal-case">Mercury not connected</Badge>
          </div>
        )}
      </div>

      {/* deal pipeline */}
      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">deal pipeline</div>
        {STAGES.every((s) => (v.stages?.[s.key] ?? 0) === 0) ? (
          <div className="rounded-inner border border-dashed border-border bg-panel-2/20 px-3 py-2 text-xs text-txt-faint/70">
            No deals yet. "Bar says yes → machine being placed" lands here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {STAGES.map((s) => {
              const n = v.stages?.[s.key] ?? 0;
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-txt-muted">{s.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full bg-accent/60" style={{ width: `${(n / maxStage) * 100}%` }} />
                  </div>
                  <span className="w-5 shrink-0 text-right font-mono text-xs text-txt-primary">{n}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* refills */}
      {v.needsRefill > 0 && (
        <div className="flex items-center gap-2 rounded-inner border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertCircle size={13} /> {v.needsRefill} machine{v.needsRefill > 1 ? "s" : ""} need a refill
        </div>
      )}

      {expanded && v.machines?.length > 0 && (
        <div className="border-t border-border/60 pt-2">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">machines</div>
          <div className="space-y-1">
            {v.machines.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-xs">
                <span className="text-txt-primary">{m.name}</span>
                <span className="text-txt-faint">{m.location || "—"} · {m.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
