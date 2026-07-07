"use client";
import { useMemo, useState } from "react";
import { Section } from "@/components/shell/ProjectPage";
import { EmptyState } from "@/components/Panel";
import { Badge, Button } from "@/components/ui";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { useLiveData } from "@/hooks/useLiveData";
import { useApi, apiPost } from "@/hooks/useApi";
import { timeAgo, hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";
import {
  Columns3, MessageSquare, Activity, UserRound, GitBranch, AlertTriangle,
  Search, RefreshCw, Send, Plus, X, CheckCircle2, Archive, Play, Ban,
} from "lucide-react";

type BadgeTone = "muted" | "accent" | "healthy" | "warn" | "error" | "off";

type Props = { compact?: boolean; className?: string };

const COLUMN_ORDER = ["triage", "todo", "ready", "running", "blocked", "done"];
const COLUMN_META: Record<string, { label: string; hint: string }> = {
  triage: { label: "Triage", hint: "Raw ideas — specify or decompose" },
  todo: { label: "Todo", hint: "Waiting on dependencies or assignment" },
  ready: { label: "Ready", hint: "Assigned and waiting for dispatcher" },
  running: { label: "In Progress", hint: "Claimed by a worker — in flight" },
  blocked: { label: "Blocked", hint: "Worker asked for human input" },
  done: { label: "Done", hint: "Completed" },
};

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

function clip(s: string | null | undefined, n = 150) {
  if (!s) return "";
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

function laneGroups(tasks: any[]) {
  const map = new Map<string, any[]>();
  for (const t of tasks) {
    const key = t.assignee || "unassigned";
    map.set(key, [...(map.get(key) || []), t]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function KanbanPanel(props: Props) {
  const live = useLiveData<any>("kanban");
  const { data, refetch } = useApi<any>("/api/kanban");
  const [snapOverride, setSnapOverride] = useState<any>(null);
  const snap = snapOverride || live || data;
  const [query, setQuery] = useState("");
  const [tenant, setTenant] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [lanes, setLanes] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async (archived = showArchived) => {
    const url = archived ? "/api/kanban?archived=1" : "/api/kanban";
    const j = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (j) setSnapOverride(j);
    refetch();
  };

  const post = async (body: any) => {
    setBusy(body.action || "working");
    try {
      const res = await apiPost("/api/kanban", body);
      if (res?.snapshot) setSnapOverride(res.snapshot);
      else await refresh();
      return res;
    } finally {
      setBusy(null);
    }
  };

  const openTask = async (task: any) => {
    setSelected(task);
    const url = `/api/kanban/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(snap.currentBoard)}`;
    const detail = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (detail?.task) setSelected(detail.task);
  };

  const filteredTasks = useMemo(() => {
    const tasks: any[] = Array.isArray(snap?.tasks) ? snap.tasks : [];
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (tenant !== "all" && (t.tenant || "") !== tenant) return false;
      if (assignee !== "all" && (t.assignee || "unassigned") !== assignee) return false;
      if (!q) return true;
      return [t.id, t.title, t.body, t.assignee, t.tenant, t.status].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [snap, query, tenant, assignee]);

  if (!snap) {
    return (
      <Section title="Hermes Kanban" icon={<Columns3 size={13} />} className={props.className}>
        <EmptyState title="connecting" hint="reading the shared Hermes Kanban board" />
      </Section>
    );
  }

  const tenants: string[] = Array.isArray(snap.tenants) ? snap.tenants : [];
  const assignees: any[] = Array.isArray(snap.assignees) ? snap.assignees : [];
  const stats = snap.stats ?? {};
  const columns = COLUMN_ORDER.map((key) => ({ key, ...COLUMN_META[key], tasks: filteredTasks.filter((t) => t.column === key) }));

  return (
    <Section
      title="Kanban"
      icon={<Columns3 size={13} />}
      className={props.className}
      right={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge tone="accent" className="!normal-case">{stats.active ?? 0} active</Badge>
          {(stats.ready ?? 0) > 0 && <Badge tone="healthy" className="!normal-case">{stats.ready} ready</Badge>}
          {(stats.running ?? 0) > 0 && <Badge tone="accent" className="!normal-case">{stats.running} running</Badge>}
          {(stats.blocked ?? 0) > 0 && <Badge tone="error" className="!normal-case">{stats.blocked} blocked</Badge>}
          <Badge tone="muted" className="!normal-case">{snap.currentBoard}</Badge>
        </div>
      }
      bodyClassName="space-y-4"
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(240px,1.1fr)_180px_180px_auto]">
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-txt-faint">Search</span>
          <span className="flex items-center gap-2 rounded-inner border border-border bg-base px-3 py-2 text-sm focus-within:border-accent/50">
            <Search size={14} className="text-txt-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter cards…" className="min-w-0 flex-1 bg-transparent text-txt-primary outline-none placeholder:text-txt-faint/70" />
          </span>
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-txt-faint">Tenant</span>
          <select value={tenant} onChange={(e) => setTenant(e.target.value)} className="h-[38px] w-full rounded-inner border border-border bg-base px-2 text-sm text-txt-primary outline-none focus:border-accent/50">
            <option value="all">All tenants</option>
            {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-txt-faint">Assignee</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-[38px] w-full rounded-inner border border-border bg-base px-2 text-sm text-txt-primary outline-none focus:border-accent/50">
            <option value="all">All profiles</option>
            {assignees.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex h-[38px] items-center gap-2 rounded-inner border border-border bg-base px-2 font-mono text-[10px] uppercase tracking-wider text-txt-muted">
            <input type="checkbox" checked={showArchived} onChange={async (e) => { setShowArchived(e.target.checked); await refresh(e.target.checked); }} /> archived
          </label>
          <label className="flex h-[38px] items-center gap-2 rounded-inner border border-border bg-base px-2 font-mono text-[10px] uppercase tracking-wider text-txt-muted">
            <input type="checkbox" checked={lanes} onChange={(e) => setLanes(e.target.checked)} /> lanes
          </label>
          <Button size="sm" variant="accent" onClick={() => post({ action: "dispatch", board: snap.currentBoard })} disabled={!!busy}><Send size={12} /> nudge dispatcher</Button>
          <Button size="sm" variant="outline" onClick={() => refresh()} disabled={!!busy}><RefreshCw size={12} /> refresh</Button>
        </div>
      </div>

      <div className="grid min-h-[56vh] gap-3 xl:grid-cols-4 2xl:grid-cols-6">
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            col={col}
            lanes={lanes}
            creating={creating === col.key}
            setCreating={setCreating}
            onCreate={(payload: any) => post({ action: "create", status: col.key === "blocked" ? "blocked" : undefined, board: snap.currentBoard, ...payload })}
            onSelect={openTask}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 font-mono text-[10px] uppercase tracking-wider text-txt-faint">
        <span>{filteredTasks.length} visible · {snap.tasks?.length ?? 0} loaded · event #{stats.latestEventId ?? 0}</span>
        <span>updated {timeAgo(snap.updatedAt)}</span>
      </div>

      {selected && <TaskDrawer task={selected} assignees={assignees} busy={busy} onClose={() => setSelected(null)} onPost={post} />}
    </Section>
  );
}

function KanbanColumn({ col, lanes, creating, setCreating, onCreate, onSelect }: any) {
  const content = col.key === "running" && lanes
    ? laneGroups(col.tasks).map(([lane, tasks]) => (
        <div key={lane} className="space-y-2 rounded-inner border border-border/50 bg-black/10 p-2">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-txt-faint">
            <span>@{lane}</span><span>{tasks.length}</span>
          </div>
          {tasks.map((t: any) => <TaskCard key={t.id} task={t} onSelect={onSelect} />)}
        </div>
      ))
    : col.tasks.map((t: any) => <TaskCard key={t.id} task={t} onSelect={onSelect} />);

  return (
    <div className="flex min-h-[260px] flex-col rounded-panel border border-border/80 bg-panel-2/20 shadow-panel">
      <div className="flex items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <StatusDot state={col.key === "running" ? "live" : col.key === "blocked" ? "error" : col.key === "ready" || col.key === "done" ? "healthy" : "off"} pulse={col.key === "running" && col.count > 0} size={6} />
            <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-txt-primary">{col.label}</h3>
            <span className="font-mono text-[10px] text-txt-faint">{col.tasks.length}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-[10px] uppercase tracking-wide text-txt-faint/70">{col.hint}</p>
        </div>
        <button onClick={() => setCreating(creating ? null : col.key)} className="rounded border border-border px-1.5 py-0.5 text-txt-faint hover:border-accent/50 hover:text-accent" aria-label={`Create ${col.label} card`}><Plus size={12} /></button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2.5">
        {creating && <InlineCreate status={col.key} onCancel={() => setCreating(null)} onCreate={async (p: any) => { await onCreate(p); setCreating(null); }} />}
        {col.tasks.length === 0 && !creating ? <div className="rounded-inner border border-dashed border-border/70 py-8 text-center font-mono text-[10px] uppercase tracking-wider text-txt-faint/60">No tasks</div> : content}
      </div>
    </div>
  );
}

function InlineCreate({ status, onCreate, onCancel }: any) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState(status === "triage" ? "" : "default");
  return (
    <div className="space-y-2 rounded-inner border border-accent/30 bg-accent/5 p-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title" className="w-full rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body / acceptance criteria" rows={3} className="w-full resize-none rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50" />
      <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assignee profile" className="w-full rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50" />
      <div className="flex gap-1.5">
        <Button size="sm" variant="accent" onClick={() => title.trim() && onCreate({ title: title.trim(), body, assignee: assignee || undefined })}>add</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>cancel</Button>
      </div>
    </div>
  );
}

function TaskCard({ task, onSelect }: any) {
  const ui = statusUi(task.status);
  const childProgress = task.child_count > 0 ? `${task.children_done}/${task.child_count}` : null;
  return (
    <button onClick={() => onSelect(task)} className="group w-full rounded-inner border border-border/70 bg-base/45 px-3 py-2 text-left shadow-sm transition-colors hover:border-accent/40 hover:bg-accent/5">
      <div className="flex items-center gap-1.5">
        <StatusDot state={ui.dot} pulse={ui.pulse} size={7} />
        <span className="font-mono text-[10px] text-txt-faint">{task.id}</span>
        <Badge tone={ui.tone} className="!px-1.5 !py-0 !normal-case">{ui.label}</Badge>
        {childProgress && <Badge tone="muted" className="!px-1.5 !py-0 !normal-case">{childProgress}</Badge>}
      </div>
      <div className="mt-1 line-clamp-2 text-xs font-semibold uppercase tracking-wide text-txt-primary group-hover:text-accent">{task.title}</div>
      {task.body && <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-txt-muted">{clip(task.body, 110)}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-txt-faint">
        <span>@{task.assignee || "unassigned"}</span>
        {task.tenant && <span>{task.tenant}</span>}
        {task.created_at && <span className="ml-auto">{timeAgo(task.created_at)}</span>}
        {task.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={9} />{task.comment_count}</span>}
        {task.event_count > 0 && <span className="inline-flex items-center gap-0.5"><Activity size={9} />{task.event_count}</span>}
      </div>
      {task.consecutive_failures > 0 && <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-error"><AlertTriangle size={10} /> {task.consecutive_failures} failure(s)</div>}
    </button>
  );
}

function TaskDrawer({ task, assignees, busy, onClose, onPost }: any) {
  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState(task.assignee || "default");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState(task.latest_summary || `Completed ${task.title}`);
  const ui = statusUi(task.status);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-border bg-panel shadow-glow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5"><Badge tone={ui.tone} className="!normal-case">{ui.label}</Badge><span className="font-mono text-[10px] text-txt-faint">{task.id}</span></div>
            <h2 className="text-lg font-semibold uppercase tracking-wide text-txt-primary">{task.title}</h2>
            <p className="mt-1 text-xs text-txt-muted">{task.body || "No body."}</p>
          </div>
          <button className="rounded-inner p-2 text-txt-faint hover:bg-white/5 hover:text-txt-primary" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
          <div className="grid gap-2 sm:grid-cols-3">
            <Info label="Assignee" value={task.assignee || "unassigned"} />
            <Info label="Tenant" value={task.tenant || "—"} />
            <Info label="Workspace" value={task.workspace_kind || "—"} />
          </div>
          {task.latest_summary && <div className="rounded-inner border border-border bg-panel-2/30 p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-txt-faint">latest summary</div><p className="mt-1 text-xs text-txt-muted">{task.latest_summary}</p></div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-inner border border-border bg-panel-2/20 p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">actions</div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onPost({ action: "promote", id: task.id })}><Play size={12} /> ready</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onPost({ action: "unblock", id: task.id })}><Play size={12} /> unblock</Button>
                <Button size="sm" variant="danger" disabled={!!busy || !reason.trim()} onClick={() => onPost({ action: "block", id: task.id, reason })}><Ban size={12} /> block</Button>
                <Button size="sm" variant="accent" disabled={!!busy || !summary.trim()} onClick={() => onPost({ action: "complete", id: task.id, summary })}><CheckCircle2 size={12} /> complete</Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => onPost({ action: "archive", id: task.id })}><Archive size={12} /> archive</Button>
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="block reason" className="mt-2 w-full rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none" />
              <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="completion summary" className="mt-2 w-full rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none" />
            </div>
            <div className="rounded-inner border border-border bg-panel-2/20 p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">assign</div>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none">
                {assignees.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <Button className="mt-2" size="sm" variant="outline" disabled={!!busy || !assignee} onClick={() => onPost({ action: "assign", id: task.id, assignee })}>assign</Button>
            </div>
          </div>
          <div className="rounded-inner border border-border bg-panel-2/20 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">comment</div>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Add operator note / unblock context…" className="w-full resize-none rounded border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none" />
            <Button className="mt-2" size="sm" variant="accent" disabled={!!busy || !comment.trim()} onClick={async () => { await onPost({ action: "comment", id: task.id, body: comment }); setComment(""); }}>add comment</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Timeline title="events" rows={task.events || []} kind="event" fallback={`${task.event_count || 0} event(s); refresh after opening from live board for full detail.`} />
            <Timeline title="comments" rows={task.comments || []} kind="comment" fallback={`${task.comment_count || 0} comment(s).`} />
          </div>
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: any) {
  return <div className="rounded-inner border border-border bg-panel-2/20 p-2"><div className="font-mono text-[9px] uppercase tracking-wider text-txt-faint">{label}</div><div className="mt-1 truncate text-xs text-txt-muted">{value}</div></div>;
}

function Timeline({ title, rows, kind, fallback }: any) {
  return (
    <div className="rounded-inner border border-border bg-panel-2/20 p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">{title}</div>
      {rows.length === 0 ? <div className="text-xs text-txt-faint/70">{fallback}</div> : (
        <div className="max-h-60 space-y-2 overflow-auto">
          {rows.map((r: any) => <div key={r.id} className="text-xs"><div className="font-mono text-[10px] text-txt-faint">{kind === "comment" ? r.author : r.kind} · {hhmm(r.created_at)}</div><div className="mt-0.5 text-txt-muted">{kind === "comment" ? r.body : JSON.stringify(r.payload || {})}</div></div>)}
        </div>
      )}
    </div>
  );
}
