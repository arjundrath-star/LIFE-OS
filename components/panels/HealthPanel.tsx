"use client";
import { Panel } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { Activity, Moon, Flame, HeartPulse } from "lucide-react";

// Whoop. Renders REAL recovery/sleep/strain/HRV from the live `health` channel once
// connected. Until the developer app exists it shows an honest connect-me with empty
// metric slots — never fabricated vitals.
type HealthSnapshot = {
  connected: boolean;
  athlete: string | null;
  lastSync: string | null;
  lastError: string | null;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  sleepHours: number | null;
  sleepPerformance: number | null;
  strain: number | null;
  asOf: string | null;
};

const num = (v: number | null, digits = 0): string => (v == null ? "—" : v.toFixed(digits));

// WHOOP recovery zones: green >= 67, yellow 34-66, red < 34.
function recoveryTone(r: number | null): string {
  if (r == null) return "text-off";
  if (r >= 67) return "text-healthy";
  if (r >= 34) return "text-warn";
  return "text-error";
}

export function HealthPanel({ onExpand }: { onExpand?: () => void }) {
  const snap = useLiveData<HealthSnapshot>("health");
  const connected = !!snap?.connected;

  if (!connected) {
    const SLOTS = [
      { label: "Recovery", icon: <Activity size={14} />, unit: "%" },
      { label: "Sleep", icon: <Moon size={14} />, unit: "h" },
      { label: "Day strain", icon: <Flame size={14} />, unit: "" },
      { label: "HRV / RHR", icon: <HeartPulse size={14} />, unit: "" },
    ];
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

  const tiles = [
    { label: "Recovery", icon: <Activity size={14} />, value: num(snap!.recovery), unit: "%", tone: recoveryTone(snap!.recovery) as string, sub: undefined as string | undefined },
    {
      label: "Sleep",
      icon: <Moon size={14} />,
      value: num(snap!.sleepHours, 1),
      unit: "h",
      tone: "text-txt-primary",
      sub: snap!.sleepPerformance != null ? `${snap!.sleepPerformance}% performance` : undefined,
    },
    { label: "Day strain", icon: <Flame size={14} />, value: num(snap!.strain, 1), unit: "", tone: "text-accent", sub: undefined },
    {
      label: "HRV / RHR",
      icon: <HeartPulse size={14} />,
      value: `${num(snap!.hrv)} / ${num(snap!.rhr)}`,
      unit: "",
      tone: "text-txt-primary",
      sub: "ms · bpm",
    },
  ];

  return (
    <Panel
      title="Health"
      icon={<Activity size={13} />}
      state={snap!.lastError ? "warn" : "healthy"}
      onExpand={onExpand}
      subtitle={snap!.athlete ? `${snap!.athlete} · Whoop` : "Whoop v2"}
    >
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-inner border border-border bg-panel-2/20 p-3">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">
              {t.icon} {t.label}
            </div>
            <div className={`font-mono text-2xl ${t.tone}`}>
              {t.value}
              <span className="text-base text-txt-faint">{t.unit}</span>
            </div>
            {t.sub && <div className="mt-0.5 text-[10px] text-txt-faint">{t.sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-txt-faint">
        <span>{snap!.asOf ? `latest cycle ${snap!.asOf}` : "no data yet"}</span>
        {snap!.lastSync && <span className="font-mono">synced {timeAgo(snap!.lastSync)}</span>}
      </div>
      {snap!.lastError && <p className="mt-1 text-[11px] text-warn">{snap!.lastError}</p>}
    </Panel>
  );
}
