"use client";
import { Clock } from "@/components/Clock";
import { Centerpiece } from "@/components/Centerpiece";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import { CountUp } from "@/components/CountUp";
import { StatusDot } from "@/components/StatusDot";
import { hhmm, timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Mail, Calendar as CalIcon, Bot, Activity, Radio } from "lucide-react";

function Glance({
  label,
  icon,
  children,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-panel border border-border bg-panel/70 p-4", className)}>
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-txt-faint">
        <span className="text-txt-faint/70">{icon}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function EmailGlance() {
  const email = useLiveData<any>("email");
  if (!email || email.connected === 0) {
    return (
      <Glance label="Email" icon={<Mail size={12} />}>
        <div className="text-2xl font-semibold text-txt-faint">—</div>
        <div className="text-xs text-txt-faint/70">no accounts connected</div>
      </Glance>
    );
  }
  return (
    <Glance label="Email" icon={<Mail size={12} />}>
      <div className="flex items-baseline gap-2">
        <CountUp value={email.totalUnread} className="text-3xl font-semibold text-txt-primary" />
        <span className="text-xs text-txt-faint">unread</span>
      </div>
      <div className="mt-0.5 text-xs text-txt-muted">
        {email.totalImportant > 0 ? `${email.totalImportant} important · ` : ""}
        {email.connected} account{email.connected > 1 ? "s" : ""}
      </div>
    </Glance>
  );
}

function CalendarGlance() {
  const cal = useLiveData<any>("calendar");
  if (!cal || cal.connected === 0) {
    return (
      <Glance label="Calendar" icon={<CalIcon size={12} />}>
        <div className="text-2xl font-semibold text-txt-faint">—</div>
        <div className="text-xs text-txt-faint/70">connect a Google account</div>
      </Glance>
    );
  }
  const now = Date.now();
  const next = (cal.events || []).find((e: any) => e.start && Date.parse(e.start) >= now);
  return (
    <Glance label="Today" icon={<CalIcon size={12} />}>
      <div className="flex items-baseline gap-2">
        <CountUp value={cal.events.length} className="text-3xl font-semibold text-txt-primary" />
        <span className="text-xs text-txt-faint">events</span>
      </div>
      <div className="mt-0.5 truncate text-xs text-txt-muted">
        {next ? `next ${hhmm(next.start)} · ${next.summary}` : "nothing left today"}
      </div>
    </Glance>
  );
}

function AgentsGlance() {
  const agents = useLiveData<any>("agents");
  const hermes = agents?.hermes;
  const tg = agents?.telegram;
  return (
    <Glance label="Agents" icon={<Bot size={12} />}>
      <div className="space-y-1.5">
        <Row dot={hermes?.online ? "healthy" : "error"} name="Hermes" val={hermes?.online ? `${hermes.activeSessions} sessions` : "offline"} />
        <Row
          dot={tg?.state === "active" || tg?.state === "idle" ? "healthy" : tg?.state === "conflict" ? "warn" : "error"}
          name="Telegram"
          val={tg?.state ?? "—"}
        />
        <Row dot={agents?.claude ? "healthy" : "off"} name="Claude" val={agents?.claude ? timeAgo(agents.claude.lastAt) : "no reports"} />
      </div>
    </Glance>
  );
}

function Row({ dot, name, val }: { dot: any; name: string; val: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-txt-muted">
        <StatusDot state={dot} size={6} pulse={dot === "healthy"} />
        {name}
      </span>
      <span className="truncate font-mono text-[11px] text-txt-faint">{val}</span>
    </div>
  );
}

function HealthGlance() {
  // Whoop not connected — honest connect-me state, never fake vitals.
  return (
    <Glance label="Health" icon={<Activity size={12} />}>
      <div className="text-2xl font-semibold text-txt-faint">—</div>
      <div className="text-xs text-txt-faint/70">Whoop not connected</div>
    </Glance>
  );
}

function LiveBadge() {
  const status = useConnStatus();
  const map = {
    open: { t: "LIVE", c: "text-accent border-accent/40 bg-accent/10", dot: "live" as const },
    connecting: { t: "SYNC", c: "text-warn border-warn/40 bg-warn/10", dot: "warn" as const },
    closed: { t: "OFFLINE", c: "text-error border-error/40 bg-error/10", dot: "error" as const },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest", map.c)}>
      <StatusDot state={map.dot} size={6} pulse={status === "open"} />
      {map.t}
      <Radio size={10} className="opacity-60" />
    </span>
  );
}

export function Hero({ mode }: { mode: "working" | "ambient" }) {
  if (mode === "ambient") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8">
        <Centerpiece mode="ambient" size={460} />
        <div className="text-center">
          <Clock big />
        </div>
        <div className="flex items-center gap-3">
          <LiveBadge />
          <span className="font-mono text-[11px] text-txt-faint">ambient mode · move the mouse to resume</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr]">
      {/* left: clock + glances */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between rounded-panel border border-border bg-panel/70 p-4">
          <Clock />
          <LiveBadge />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <CalendarGlance />
          <EmailGlance />
        </div>
      </div>

      {/* center: living centerpiece */}
      <div className="flex items-center justify-center px-2">
        <Centerpiece mode="working" size={340} />
      </div>

      {/* right: agents + health */}
      <div className="grid grid-cols-2 gap-4">
        <AgentsGlance />
        <HealthGlance />
      </div>
    </div>
  );
}
