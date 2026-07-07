"use client";
import { Section } from "@/components/shell/ProjectPage";
import { EmptyState } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { useLiveData } from "@/hooks/useLiveData";
import { useApi } from "@/hooks/useApi";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Columns3, MessageSquare, Activity, UserRound, GitBranch, AlertTriangle } from "lucide-react";

type BadgeTone = "muted" | "accent" | "healthy" | "warn" | "error" | "off";

function statusUi(status: string): { dot: DotState; tone: BadgeTone; label: string; pulse: boolean } {
  switch (status) {
    case "running": return { dot: "live", tone: "accent", label: "running", pulse: true };
    case "ready": return { dot: "healthy", tone: "healthy", label: "ready", pulse: false };
    case "review": return { dot: "warn", tone: "warn", label: "review", pulse: true };
    case "blocked": return { dot: "error", tone: "error", label: "blocked", pulse: false };
    case "scheduled": return { dot: "warn", tone: "warn", label: "scheduled", pulse: false };
    case "todo": return { dot: "off", tone: "muted", label: "todo", pulse: false };
    case "triage": return { dot: "warn", tone: "warn", label: "triage", pulse: false };
    case "done": return { dot: "healthy", tone: "healthy", label: "done", pulse: false };
    default: return { dot: "off", tone: "muted", label: status || "unknown", pulse: false };
  }
}

function clip(s: string | null | undefined, n = 180) {
  if (!s) return "";
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

export function KanbanPanel() {
  const live = useLiveData<any>("kanban");
  const { data } = useApi<any>("/api/kanban");
  const snap = live || data;

  if (!snap) {
    return (
      <Section title="Hermes Kanban" icon={<Columns3 size={13} />}>
        <EmptyState title="connecting" hint="reading the shared Hermes Kanban board" />
      </Section>
    );
  }

  const boards: any[] = Array.isArray(snap.boards) ? snap.boards : [];
  const tasks: any[] = Array.isArray(snap.tasks) ? snap.tasks : [];
  const assignees: any[] = Array.isArray(snap.assignees) ? snap.assignees : [];
  const stats = snap.stats ?? {};

  return (
    <Section
      title="Hermes Kanban"
      icon={<Columns3 size={13} />}
      right={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge tone="accent" className="!normal-case">{stats.active ?? 0} active</Badge>
          {(stats.ready ?? 0) > 0 && <Badge tone="healthy" className="!normal-case">{stats.ready} ready</Badge>}
          {(stats.running ?? 0) > 0 && <Badge tone="accent" className="!normal-case">{stats.running} running</Badge>}
          {(stats.blocked ?? 0) > 0 && <Badge tone="error" className="!normal-case">{stats.blocked} blocked</Badge>}
          <Badge tone="muted" className="!normal-case">board {snap.currentBoard}</Badge>
        </div>
      }
      bodyClassName="space-y-3"
    >
      <div className="grid gap-2 md:grid-cols-3">
        {boards.map((b) => (
          <div key={b.slug} className={cn("rounded-inner border px-3 py-2", b.isCurrent ? "border-accent/35 bg-accent/5" : "border-border/70 bg-panel-2/20")}>
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-medium text-txt-primary">{b.name || b.slug}</div>
              <Badge tone={b.isCurrent ? "accent" : "muted"} className="shrink-0 !normal-case">{b.isCurrent ? "current" : b.slug}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-txt-faint">
              <span>{b.active ?? 0} active</span>
              <span>·</span>
              <span>{b.total ?? 0} total</span>
              {(b.blocked ?? 0) > 0 && <span className="text-error">· {b.blocked} blocked</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wider text-txt-faint/80">current board tasks</div>
            <div className="font-mono text-[10px] text-txt-faint">updated {timeAgo(snap.updatedAt)}</div>
          </div>
          {tasks.length === 0 ? (
            <EmptyState title="board is empty" hint="create cards with `hermes kanban create ...` or the /kanban command" />
          ) : (
            <div className="space-y-2">
              {tasks.slice(0, 12).map((t) => {
                const ui = statusUi(t.status);
                return (
                  <div key={t.id} className="rounded-inner border border-border/70 bg-panel-2/25 px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <StatusDot state={ui.dot} pulse={ui.pulse} size={8} className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ui.tone} className="!normal-case">{ui.label}</Badge>
                          {t.priority !== 0 && <Badge tone="muted" className="!normal-case">p{t.priority}</Badge>}
                          {t.goal_mode && <Badge tone="accent" className="!normal-case">goal</Badge>}
                          {t.consecutive_failures > 0 && <Badge tone="error" className="!normal-case"><AlertTriangle size={10} /> {t.consecutive_failures} fail</Badge>}
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-txt-primary">{t.title}</div>
                        {t.body && <div className="mt-0.5 text-xs text-txt-muted">{clip(t.body)}</div>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] text-txt-faint">
                          <span className="truncate">{t.id}</span>
                          <span className="inline-flex items-center gap-1"><UserRound size={9} /> {t.assignee || "unassigned"}</span>
                          {t.tenant && <span>{t.tenant}</span>}
                          {t.workspace_kind && <span className="inline-flex items-center gap-1"><GitBranch size={9} /> {t.workspace_kind}</span>}
                          {t.created_at && <span>{timeAgo(t.created_at)}</span>}
                          {(t.comment_count ?? 0) > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={9} /> {t.comment_count}</span>}
                          {(t.event_count ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Activity size={9} /> {t.event_count}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-txt-faint/80">profiles / assignees</div>
          <div className="rounded-inner border border-border/70 bg-panel-2/20 p-2">
            {assignees.length === 0 ? (
              <div className="text-xs text-txt-faint">no profiles found</div>
            ) : (
              <div className="space-y-1.5">
                {assignees.map((a) => (
                  <div key={a.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className={cn("truncate", a.onDisk ? "text-txt-muted" : "text-warn")}>{a.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-txt-faint">
                      {a.active ?? 0} active · {a.total ?? 0} total
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
