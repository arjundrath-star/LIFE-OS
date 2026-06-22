"use client";
import { useLiveData } from "@/hooks/useLiveData";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";

type Ev = { id: number; ts: string; source: string; level: string; message: string };

const levelColor: Record<string, string> = {
  info: "text-txt-muted",
  success: "text-healthy",
  warn: "text-warn",
  error: "text-error",
};

export function Ticker({ slow = false }: { slow?: boolean }) {
  const events = useLiveData<Ev[]>("ticker") || [];

  if (events.length === 0) {
    return (
      <div className="flex h-8 items-center px-4 font-mono text-[11px] text-txt-faint/60">
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent/40" />
        event stream idle — waiting for activity
      </div>
    );
  }

  const items = [...events, ...events]; // duplicate for seamless loop

  return (
    <div className="relative h-8 overflow-hidden">
      <div
        className="flex h-full w-max items-center whitespace-nowrap will-change-transform"
        style={{ animation: `ticker-scroll ${slow ? 80 : 40}s linear infinite` }}
      >
        {items.map((e, i) => (
          <span key={`${e.id}-${i}`} className="mx-4 inline-flex items-center gap-2 font-mono text-[11px]">
            <span className="text-txt-faint/60">{hhmm(e.ts)}</span>
            <span className="text-accent/70">{e.source}</span>
            <span className={cn(levelColor[e.level] || "text-txt-muted")}>{e.message}</span>
            <span className="text-border">•</span>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-panel to-transparent" />
    </div>
  );
}
