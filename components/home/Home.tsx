"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Centerpiece } from "@/components/Centerpiece";
import { Clock } from "@/components/Clock";
import { CountUp } from "@/components/CountUp";
import { StatusDot } from "@/components/StatusDot";
import { Section } from "@/components/shell/ProjectPage";
import { EmptyState } from "@/components/Panel";
import { Button } from "@/components/ui";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import { useApi, apiPost } from "@/hooks/useApi";
import { hhmm, timeAgo } from "@/lib/time";
import { daysUntilTerm, TERM_LABEL } from "@/lib/school";
import { cn } from "@/lib/cn";
import {
  Bot, Cpu, Send, Terminal as TermIcon, Mail, Calendar as CalIcon, MapPin,
  CheckSquare, Square, Plus, Activity, Boxes, Clapperboard, GraduationCap, FolderGit2, ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------- hero
function useResponsiveSize(min: number, vw: number, vh: number, max: number) {
  const [size, setSize] = useState(min);
  useEffect(() => {
    const calc = () => setSize(Math.max(min, Math.min(window.innerWidth * vw, window.innerHeight * vh, max)));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [min, vw, vh, max]);
  return size;
}

function Hero() {
  const size = useResponsiveSize(300, 0.26, 0.42, 440);
  const status = useConnStatus();
  return (
    <section className="grid items-center gap-6 rounded-panel border border-border bg-panel/40 p-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Clock big />
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest",
              status === "open" ? "border-accent/40 bg-accent/10 text-accent" : "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            <StatusDot state={status === "open" ? "live" : "warn"} pulse={status === "open"} size={6} />
            {status === "open" ? "LIVE" : status.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <Centerpiece mode="working" size={size} />
      </div>

      <LiveAgents />
    </section>
  );
}

// ---------------------------------------------------------------- live agents
function AgentLine({ icon, name, state, status, meta }: { icon: React.ReactNode; name: string; state: any; status: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-txt-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-txt-primary">{name}</span>
          <StatusDot state={state} size={6} pulse={state === "healthy"} />
        </div>
        <div className="truncate text-xs text-txt-muted">{status}</div>
      </div>
      {meta && <span className="shrink-0 font-mono text-[10px] text-txt-faint">{meta}</span>}
    </div>
  );
}

function LiveAgents() {
  const agents = useLiveData<any>("agents");
  const hermes = agents?.hermes;
  const tg = agents?.telegram;
  const claude = agents?.claude;
  return (
    <div className="flex h-full flex-col gap-3 rounded-inner border border-border/70 bg-panel-2/30 p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-txt-faint">
        <Bot size={12} /> agents running
      </div>
      {!agents ? (
        <div className="text-xs text-txt-faint/70">reading gateway…</div>
      ) : (
        <>
          <div className="space-y-2.5">
            <AgentLine icon={<Cpu size={13} />} name="Hermes" state={hermes?.online ? "healthy" : "error"} status={hermes?.online ? `online · ${hermes.gatewayState}` : hermes?.detail || "offline"} meta={hermes?.online ? `${hermes.activeSessions} sess` : ""} />
            <AgentLine icon={<Send size={13} />} name="Telegram" state={tg?.state === "active" || tg?.state === "idle" ? "healthy" : tg?.state === "conflict" ? "warn" : "error"} status={tg?.detail || tg?.state || "—"} meta={tg?.lastEventAt ? timeAgo(tg.lastEventAt) : ""} />
            <AgentLine icon={<TermIcon size={13} />} name="Claude Code" state={claude ? "healthy" : "off"} status={claude ? claude.summary : "no session reports yet"} meta={claude ? timeAgo(claude.lastAt) : ""} />
          </div>
          {hermes?.platforms?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {hermes.platforms.map((p: any) => (
                <span key={p.name} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-txt-muted">
                  <StatusDot state={p.state === "connected" ? "healthy" : "warn"} size={5} />
                  {p.name}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto min-h-0 border-t border-border/60 pt-2">
            <div className="max-h-24 space-y-1 overflow-auto">
              {(agents.activity || []).slice(0, 6).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-[10px] text-txt-faint/70">{hhmm(a.ts)}</span>
                  <span className="text-accent/60">{a.source}</span>
                  <span className="min-w-0 flex-1 truncate text-txt-muted">{a.summary}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- today's calendar
function TodayCalendar() {
  const cal = useLiveData<any>("calendar");
  const connected = cal?.connected ?? 0;
  const events = cal?.events ?? [];
  const now = Date.now();
  return (
    <Section title="Today" icon={<CalIcon size={13} />} bodyClassName="max-h-[420px] overflow-auto">
      {connected === 0 ? (
        <EmptyState title="no calendars connected" hint="Connect a Google account to see today's events." icon={<CalIcon size={20} />} action={<a href="/api/google/connect"><Button size="sm" variant="accent"><Plus size={12} /> connect</Button></a>} />
      ) : events.length === 0 ? (
        <EmptyState title="nothing today" hint={`${connected} calendar${connected > 1 ? "s" : ""} · day is clear`} />
      ) : (
        <div className="space-y-1.5">
          {events.map((e: any, i: number) => {
            const past = e.end && Date.parse(e.end) < now;
            const live = e.start && e.end && Date.parse(e.start) <= now && Date.parse(e.end) >= now;
            return (
              <div key={i} className={cn("flex items-start gap-3 rounded-inner border px-3 py-2", live ? "border-accent/40 bg-accent/5" : "border-border/60 bg-panel-2/30", past && "opacity-50")}>
                <div className="w-16 shrink-0 font-mono text-[11px] text-txt-muted">{e.allDay ? "all day" : hhmm(e.start)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-txt-primary">{e.summary}</div>
                  <div className="flex items-center gap-2 text-[11px] text-txt-faint">
                    <span className="truncate">{e.account}</span>
                    {e.location && <span className="flex items-center gap-0.5 truncate"><MapPin size={9} /> {e.location}</span>}
                  </div>
                </div>
                {live && <span className="shrink-0 font-mono text-[10px] text-accent">now</span>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- recent emails
function RecentEmails() {
  const email = useLiveData<any>("email");
  const connected = email?.connected ?? 0;
  const recent: any[] = email?.recent ?? [];
  return (
    <Section
      title="Recent email"
      icon={<Mail size={13} />}
      right={connected > 0 ? <span className="font-mono text-[11px] text-txt-faint">{email.totalUnread} unread · {connected} acct</span> : undefined}
      bodyClassName="max-h-[420px] overflow-auto"
    >
      {connected === 0 ? (
        <EmptyState title="no inboxes connected" hint="Add a Google account to see a scannable feed across inboxes." icon={<Mail size={20} />} action={<a href="/api/google/connect"><Button size="sm" variant="accent"><Plus size={12} /> add account</Button></a>} />
      ) : recent.length === 0 ? (
        <EmptyState title="inboxes clear" hint={`${connected} account${connected > 1 ? "s" : ""} · nothing recent`} />
      ) : (
        <div className="space-y-1">
          {recent.map((m) => (
            <div key={`${m.account}-${m.id}`} className={cn("flex items-start gap-2.5 rounded-inner px-2.5 py-2", m.unread ? "bg-panel-2/40" : "")}>
              <StatusDot state={m.unread ? "live" : "off"} size={6} pulse={m.unread} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", m.unread ? "text-txt-primary" : "text-txt-muted")}>
                    {m.important && <span className="mr-1 text-warn">★</span>}
                    {m.fromName || m.from || "(unknown)"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-txt-faint">{hhmm(m.ts)}</span>
                </div>
                <div className="truncate text-xs text-txt-muted">{m.subject}</div>
                <div className="truncate font-mono text-[10px] text-txt-faint/70">{m.account}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- today's to-dos
function TodayTodos() {
  const { data, refetch } = useApi<any>("/api/todos");
  const [text, setText] = useState("");
  const todos = (data?.todos ?? []).filter((t: any) => !t.done);
  const add = async () => {
    if (!text.trim()) return;
    await apiPost("/api/todos", { action: "add", text: text.trim() });
    setText("");
    refetch();
  };
  const toggle = async (id: number) => {
    await apiPost("/api/todos", { action: "toggle", id });
    refetch();
  };
  return (
    <Section title="To-dos" icon={<CheckSquare size={13} />} right={<span className="font-mono text-[11px] text-txt-faint">{todos.length} open</span>}>
      <div className="mb-2 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add a task"
          className="flex-1 rounded-inner border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50"
        />
        <Button size="sm" variant="accent" onClick={add} aria-label="Add task"><Plus size={12} /></Button>
      </div>
      {todos.length === 0 ? (
        <div className="py-3 text-center text-xs text-txt-faint/70">all clear</div>
      ) : (
        <div className="space-y-0.5">
          {todos.map((t: any) => (
            <div key={t.id} className="flex items-start gap-2 rounded-inner px-1 py-1 hover:bg-white/5">
              <button onClick={() => toggle(t.id)} aria-label="Mark task done" className="mt-0.5 text-txt-faint hover:text-accent"><Square size={14} /></button>
              <span className="min-w-0 flex-1 text-xs text-txt-muted">
                {t.text}
                {t.due && <span className="ml-1 font-mono text-[10px] text-warn">· {t.due}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- whoop
function WhoopSnapshot() {
  const snap = useLiveData<any>("health");
  const connected = !!snap?.connected;
  const fmt = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toFixed(d));

  if (!connected) {
    const SLOTS = [
      { label: "Recovery", unit: "%" },
      { label: "Sleep", unit: "h" },
      { label: "Strain", unit: "" },
      { label: "HRV", unit: "" },
    ];
    return (
      <Section title="Whoop" icon={<Activity size={13} />} right={<span className="font-mono text-[10px] uppercase tracking-wider text-off">connect me</span>}>
        <div className="grid grid-cols-4 gap-2">
          {SLOTS.map((s) => (
            <div key={s.label} className="rounded-inner border border-dashed border-border bg-panel-2/20 p-2 text-center">
              <div className="font-mono text-xl text-off">—{s.unit}</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-txt-faint">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-txt-faint/70">Whoop not connected. Create the app at developer.whoop.com (v2, offline scope), then authorize from Connections.</p>
      </Section>
    );
  }

  const recTone = snap.recovery == null ? "text-off" : snap.recovery >= 67 ? "text-healthy" : snap.recovery >= 34 ? "text-warn" : "text-error";
  const STATS = [
    { label: "Recovery", value: `${fmt(snap.recovery)}%`, tone: recTone },
    { label: "Sleep", value: `${fmt(snap.sleepHours, 1)}h`, tone: "text-txt-primary" },
    { label: "Strain", value: fmt(snap.strain, 1), tone: "text-accent" },
    { label: "HRV", value: `${fmt(snap.hrv)}`, tone: "text-txt-primary" },
  ];
  return (
    <Section
      title="Whoop"
      icon={<Activity size={13} />}
      right={<span className="font-mono text-[10px] uppercase tracking-wider text-healthy">{snap.athlete ?? "connected"}</span>}
    >
      <div className="grid grid-cols-4 gap-2">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-inner border border-border bg-panel-2/20 p-2 text-center">
            <div className={cn("font-mono text-xl", s.tone)}>{s.value}</div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-txt-faint">{s.label}</div>
          </div>
        ))}
      </div>
      {snap.asOf && <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">latest cycle {snap.asOf}</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- projects glance
function GlanceCard({ href, icon, name, chip, chipTone = "accent", sub, dot }: { href: string; icon: React.ReactNode; name: string; chip: string; chipTone?: "accent" | "warn" | "muted"; sub?: string; dot?: any }) {
  return (
    <Link href={href} className="group flex flex-col gap-2 rounded-panel border border-border bg-panel p-4 shadow-panel transition-colors hover:border-accent/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-txt-muted">
          <span className="text-accent">{icon}</span>
          <span className="text-sm text-txt-primary">{name}</span>
          {dot && <StatusDot state={dot} size={6} pulse={dot === "healthy"} />}
        </div>
        <ArrowRight size={14} className="text-txt-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className={cn("font-mono text-lg", chipTone === "warn" ? "text-warn" : chipTone === "muted" ? "text-txt-faint" : "text-accent")}>{chip}</div>
      {sub && <div className="text-[11px] text-txt-faint">{sub}</div>}
    </Link>
  );
}

function ProjectsGlance() {
  const { data: vending } = useApi<any>("/api/vending");
  const { data: ad } = useApi<any>("/api/adagency");
  const projects = useLiveData<any[]>("projects");
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => setDays(daysUntilTerm()), []);

  const dealCount = vending ? Object.values(vending.stages || {}).reduce((a: number, b: any) => a + (b as number), 0) : 0;
  const vendChip = vending?.revenueConnected
    ? `$${((vending.revenueMtdCents ?? 0) / 100).toFixed(0)} MTD`
    : `${vending?.liveMachines ?? 0} live · ${dealCount} deals`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-txt-faint">
        <FolderGit2 size={12} /> projects
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlanceCard href="/vending" icon={<Boxes size={15} />} name="Vending Ops" chip={vendChip} chipTone={vending?.revenueConnected ? "accent" : "muted"} sub={vending?.needsRefill ? `${vending.needsRefill} need refill` : "deal pipeline live"} dot={vending?.needsRefill ? "warn" : undefined} />
        <GlanceCard href="/ad-agency" icon={<Clapperboard size={15} />} name="Klade Ad Agency" chip={ad?.connected ? `${ad.account?.credits ?? "—"} credits` : "connect CLI"} chipTone={ad?.connected ? "accent" : "muted"} sub={ad?.connected ? `${ad.videos?.length ?? 0} recent generations` : "Higgsfield"} />
        <GlanceCard href="/school" icon={<GraduationCap size={15} />} name="School" chip={days === null ? "—" : `${days}d`} chipTone="warn" sub={`until ${TERM_LABEL}`} />
        <GlanceCard href="/projects" icon={<FolderGit2 size={15} />} name="Vault projects" chip={projects ? `${projects.length}` : "—"} chipTone="muted" sub="from command-center" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export function Home() {
  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-5">
      <Hero />
      <ProjectsGlance />
      <div className="grid gap-5 lg:grid-cols-3">
        <RecentEmails />
        <TodayCalendar />
        <div className="flex flex-col gap-5">
          <TodayTodos />
          <WhoopSnapshot />
        </div>
      </div>
    </div>
  );
}
