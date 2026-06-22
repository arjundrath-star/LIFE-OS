"use client";
import { useEffect, useState } from "react";
import { Clock } from "@/components/Clock";
import { Centerpiece } from "@/components/Centerpiece";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import { StatusDot } from "@/components/StatusDot";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";

function CalmMetric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "accent" | "warn" }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-txt-faint/70">{label}</div>
      <div
        className={cn(
          "font-mono text-lg",
          tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-txt-muted"
        )}
      >
        {value}
      </div>
    </div>
  );
}

// True screensaver: the rail is hidden and the screen goes full-bleed to the breathing
// centerpiece. Cinematic, never frantic. Any interaction (handled by the shell) exits.
export function AmbientScreen() {
  const pulse = useLiveData<any>("pulse");
  const cal = useLiveData<any>("calendar");
  const email = useLiveData<any>("email");
  const connStatus = useConnStatus();
  const [size, setSize] = useState(460);

  useEffect(() => {
    const calc = () =>
      setSize(Math.max(280, Math.min(window.innerWidth * 0.5, window.innerHeight * 0.55, 600)));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const now = Date.now();
  const next = (cal?.events || []).find((e: any) => e.start && Date.parse(e.start) >= now);

  return (
    <div className="fixed inset-0 z-[90] flex cursor-none flex-col items-center justify-center gap-10 bg-base">
      <Centerpiece mode="ambient" size={size} />

      <div className="text-center">
        <Clock big />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        <CalmMetric
          label="Agents"
          value={pulse ? `${pulse.agentsActive}/${pulse.agentsTotal} active` : "—"}
          tone={pulse?.hermesOnline ? "accent" : "warn"}
        />
        <CalmMetric
          label="Next"
          value={next ? `${hhmm(next.start)} · ${String(next.summary).slice(0, 22)}` : "clear"}
        />
        <CalmMetric
          label="Unread"
          value={email?.connected ? String(email.totalUnread) : "—"}
          tone={email?.totalUnread > 0 ? "accent" : "muted"}
        />
      </div>

      <div className="absolute bottom-8 flex items-center gap-2 font-mono text-[11px] text-txt-faint/60">
        <StatusDot state={connStatus === "open" ? "live" : "warn"} pulse={connStatus === "open"} size={6} />
        ambient mode · move to resume
      </div>
    </div>
  );
}
