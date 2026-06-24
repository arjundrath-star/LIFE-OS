"use client";
// Named-agent orchestration view. Reads the live `agent_runs` WS channel (the scheduler is
// the only poller) and falls back to GET /api/agents/runs. Shows one card per named agent
// with its current status, latest summary, last activity, and an expandable run timeline +
// artifacts. This is additive to AgentsPanel (Hermes/Telegram/Claude), which stays on /agents.
import { useState } from "react";
import { Section } from "@/components/shell/ProjectPage";
import { EmptyState } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { useLiveData } from "@/hooks/useLiveData";
import { useApi } from "@/hooks/useApi";
import { timeAgo, hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";
import {
  Workflow, ChevronDown, ChevronRight, Clock, FileSpreadsheet, Mail, FileText,
  ScrollText, AlertTriangle, Link2, Package, Activity,
} from "lucide-react";

type BadgeTone = "muted" | "accent" | "healthy" | "warn" | "error" | "off";

// One mapping from run status -> dot + badge + label, used everywhere so the UI is consistent.
function statusUi(status: string): { dot: DotState; tone: BadgeTone; label: string; pulse: boolean } {
  switch (status) {
    case "running": return { dot: "live", tone: "accent", label: "running", pulse: true };
    case "queued": return { dot: "warn", tone: "warn", label: "queued", pulse: false };
    case "waiting_for_review": return { dot: "warn", tone: "warn", label: "waiting for review", pulse: true };
    case "blocked": return { dot: "error", tone: "error", label: "blocked", pulse: false };
    case "completed": return { dot: "healthy", tone: "healthy", label: "completed", pulse: false };
    case "failed": return { dot: "error", tone: "error", label: "failed", pulse: false };
    default: return { dot: "off", tone: "muted", label: status || "idle", pulse: false };
  }
}

const levelTone: Record<string, string> = {
  info: "text-txt-faint/70",
  success: "text-healthy",
  warn: "text-warn",
  error: "text-error",
};

const artifactIcon: Record<string, React.ReactNode> = {
  spreadsheet: <FileSpreadsheet size={12} />,
  email: <Mail size={12} />,
  draft: <FileText size={12} />,
  log: <ScrollText size={12} />,
  blocker: <AlertTriangle size={12} />,
  link: <Link2 size={12} />,
};

const isHttp = (uri: string) => /^https?:\/\//i.test(uri);

export function AgentRunsPanel() {
  const live = useLiveData<any>("agent_runs");
  const { data } = useApi<any>("/api/agents/runs");
  const snap = live || data;
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!snap) {
    return (
      <Section title="Named agents" icon={<Workflow size={13} />}>
        <EmptyState title="connecting" hint="reading the agent orchestration store" />
      </Section>
    );
  }

  const agents: any[] = Array.isArray(snap.agents) ? snap.agents : [];
  const stats = snap.stats ?? {};
  const recent: any[] = Array.isArray(snap.recentEvents) ? snap.recentEvents : [];

  const toggle = (slug: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  return (
    <>
      <Section
        title="Named agents"
        icon={<Workflow size={13} />}
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone="accent" className="!normal-case">{stats.active ?? 0} active</Badge>
            {(stats.waiting ?? 0) > 0 && <Badge tone="warn" className="!normal-case">{stats.waiting} waiting</Badge>}
            {(stats.blocked ?? 0) > 0 && <Badge tone="error" className="!normal-case">{stats.blocked} blocked</Badge>}
            <Badge tone="muted" className="!normal-case">{stats.total ?? agents.length} total</Badge>
          </div>
        }
        bodyClassName="space-y-3"
      >
        {agents.length === 0 ? (
          <EmptyState title="no named agents yet" hint="agents register themselves on their first event" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {agents.map((a) => {
              const run = a.latestRun;
              const ui = statusUi(a.current_status);
              const expanded = open.has(a.slug);
              const timeline: any[] = Array.isArray(run?.timeline) ? run.timeline : [];
              const artifacts: any[] = Array.isArray(run?.artifacts) ? run.artifacts : [];
              const regionId = `agent-run-${a.slug}`;
              return (
                <div key={a.slug} className={cn("rounded-inner border bg-panel-2/30", expanded ? "border-accent/30" : "border-border/70")}>
                  <button
                    onClick={() => toggle(a.slug)}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                    aria-expanded={expanded}
                    aria-controls={regionId}
                  >
                    <StatusDot state={ui.dot} size={8} pulse={ui.pulse} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-txt-primary">{a.display_name}</span>
                        <Badge tone={ui.tone} className="shrink-0 !normal-case">{ui.label}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-txt-muted">
                        {run?.summary || a.description || "no runs yet"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10px] text-txt-faint">
                        {a.schedule_label && <span>{a.schedule_label}</span>}
                        {a.last_run_at ? <span className="inline-flex items-center gap-1"><Clock size={9} /> {timeAgo(a.last_run_at)}</span> : <span>never run</span>}
                        {run?.trigger_type && <span>via {run.trigger_type}</span>}
                      </div>
                    </div>
                    <span className="mt-1 shrink-0 text-txt-faint">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  </button>

                  {expanded && (
                    <div id={regionId} role="region" aria-label={`${a.display_name} latest run`} className="border-t border-border/60 px-3 py-2.5">
                      {!run ? (
                        <div className="py-2 text-center text-xs text-txt-faint/70">no runs recorded yet</div>
                      ) : (
                        <>
                          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-txt-faint">
                            <span className="truncate">run {run.id}</span>
                            <span>started {hhmm(run.started_at)}</span>
                          </div>
                          {/* timeline */}
                          <div className="space-y-1">
                            {timeline.length === 0 ? (
                              <div className="text-xs text-txt-faint/70">no events yet</div>
                            ) : (
                              timeline.map((e: any) => (
                                <div key={e.id} className="flex items-start gap-2 text-xs">
                                  <span className="mt-0.5 font-mono text-[10px] text-txt-faint/70">{hhmm(e.ts)}</span>
                                  <span className={cn("shrink-0 font-mono text-[10px] uppercase tracking-wide", levelTone[e.level] || levelTone.info)}>{e.kind}</span>
                                  <span className="min-w-0 flex-1 text-txt-muted">{e.summary}</span>
                                </div>
                              ))
                            )}
                          </div>
                          {/* artifacts */}
                          {artifacts.length > 0 && (
                            <div className="mt-2.5 space-y-1 border-t border-border/50 pt-2">
                              <div className="font-mono text-[10px] uppercase tracking-wider text-txt-faint/70">artifacts</div>
                              {artifacts.map((art: any) => (
                                <div key={art.id} className="flex items-center gap-2 text-xs">
                                  <span className="text-txt-faint">{artifactIcon[art.type] || <Package size={12} />}</span>
                                  <span className="shrink-0 text-txt-muted">{art.title}</span>
                                  {isHttp(art.uri) ? (
                                    <a href={art.uri} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-[10px] text-accent hover:underline">
                                      {art.uri}
                                    </a>
                                  ) : (
                                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-txt-faint/70">{art.uri}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* global live event stream — the control-tower feed */}
      <Section title="Orchestration event stream" icon={<Activity size={13} />}>
        {recent.length === 0 ? (
          <EmptyState title="no events yet" hint="emit one with scripts/agent-event.ts (or the --demo run)" />
        ) : (
          <div className="max-h-[40vh] space-y-1 overflow-auto">
            {recent.map((e: any) => (
              <div key={e.id} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 font-mono text-[10px] text-txt-faint/70">{hhmm(e.ts)}</span>
                <Badge tone="muted" className="shrink-0 !px-1.5 !py-0 !normal-case">{e.agent_slug}</Badge>
                <span className={cn("shrink-0 font-mono text-[10px] uppercase tracking-wide", levelTone[e.level] || levelTone.info)}>{e.kind}</span>
                <span className="min-w-0 flex-1 text-txt-muted">{e.summary}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
