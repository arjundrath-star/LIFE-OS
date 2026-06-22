"use client";
import { Panel } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { Activity, Moon, Flame, HeartPulse } from "lucide-react";

// Whoop not connected. Honest connect-me: shows the metric slots it WILL fill,
// explicitly marked "not connected" — never fabricated vitals.
const SLOTS = [
  { label: "Recovery", icon: <Activity size={14} />, unit: "%" },
  { label: "Sleep", icon: <Moon size={14} />, unit: "h" },
  { label: "Day strain", icon: <Flame size={14} />, unit: "" },
  { label: "HRV / RHR", icon: <HeartPulse size={14} />, unit: "" },
];

export function HealthPanel({ onExpand }: { onExpand?: () => void }) {
  return (
    <Panel title="Health" icon={<Activity size={13} />} state="off" onExpand={onExpand} subtitle="Whoop v2">
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((s) => (
          <div key={s.label} className="rounded-inner border border-dashed border-border bg-panel-2/20 p-3">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">
              {s.icon} {s.label}
            </div>
            <div className="font-mono text-2xl text-off">—{s.unit}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-inner border border-border/60 bg-panel-2/30 px-3 py-2">
        <span className="text-xs text-txt-muted">Whoop developer app not created yet.</span>
        <Badge tone="off" className="!normal-case">connect me</Badge>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-txt-faint/70">
        Create the app at developer.whoop.com (v2, offline scope), then authorize from
        the Connections panel. Recovery, sleep, strain, HRV and resting HR will fill in here.
      </p>
    </Panel>
  );
}
