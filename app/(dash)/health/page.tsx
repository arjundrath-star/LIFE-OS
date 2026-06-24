"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { HealthPanel } from "@/components/panels/HealthPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { Activity } from "lucide-react";

type HealthSnapshot = {
  connected: boolean;
  athlete: string | null;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  sleepHours: number | null;
  strain: number | null;
};

const num = (v: number | null, digits = 0): string => (v == null ? "—" : v.toFixed(digits));

export default function HealthPage() {
  const snap = useLiveData<HealthSnapshot>("health");
  const connected = !!snap?.connected;
  const recTone = connected && snap!.recovery != null ? (snap!.recovery >= 67 ? "healthy" : snap!.recovery >= 34 ? "warn" : "error") : "muted";

  return (
    <ProjectPage
      title="Health"
      icon={<Activity size={18} />}
      subtitle={
        connected
          ? "Whoop recovery, sleep, and strain — live from the WHOOP v2 API. Real values only."
          : "Whoop recovery, sleep, and strain. Honest connect-me until the developer app is created — never fabricated vitals."
      }
      statusDot={connected ? "healthy" : "off"}
      statusLabel={connected ? (snap!.athlete ? `${snap!.athlete} · connected` : "Whoop connected") : "Whoop not connected"}
      hero={
        <div className="grid gap-3 sm:grid-cols-4">
          <HeroStat label="Recovery" value={`${num(connected ? snap!.recovery : null)}%`} tone={recTone} />
          <HeroStat label="Sleep" value={`${num(connected ? snap!.sleepHours : null, 1)}h`} tone={connected ? "primary" : "muted"} />
          <HeroStat label="Strain" value={num(connected ? snap!.strain : null, 1)} tone={connected ? "accent" : "muted"} />
          <HeroStat
            label="HRV / RHR"
            value={`${num(connected ? snap!.hrv : null)} / ${num(connected ? snap!.rhr : null)}`}
            tone={connected ? "primary" : "muted"}
          />
        </div>
      }
    >
      <HealthPanel />
    </ProjectPage>
  );
}
