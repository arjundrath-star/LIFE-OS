// Hermes Kanban read model for Rathworkspace. Server-only: reads the shared Hermes
// Kanban SQLite databases in query-only mode and exposes dashboard-friendly snapshots.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("lib/kanban.ts is server-only");
}

const STATUSES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"];
const BOARD_COLUMNS = ["triage", "todo", "ready", "running", "blocked", "done"] as const;
const ACTIVE_STATUSES = new Set(["triage", "todo", "scheduled", "ready", "running", "blocked", "review"]);
const PROFILE_DIR = "profiles";

type CountRow = { status: string; n: number };

type BoardMeta = {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  default_workdir?: string | null;
  created_at?: number | null;
  archived?: boolean;
};

export type KanbanComment = { id: number; task_id: string; author: string; body: string; created_at: string | null };
export type KanbanEvent = { id: number; task_id: string; run_id: number | null; kind: string; payload: any; created_at: string | null };
export type KanbanRun = { id: number; status: string; profile: string | null; outcome: string | null; summary: string | null; error: string | null; started_at: string | null; ended_at: string | null };
export type KanbanLink = { parent_id: string; child_id: string; title?: string; status?: string };

export type KanbanTask = {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  column: string;
  priority: number;
  created_by: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  tenant: string | null;
  result: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  current_run_id: number | null;
  last_heartbeat_at: string | null;
  consecutive_failures: number;
  last_failure_error: string | null;
  goal_mode: boolean;
  current_step_key: string | null;
  comment_count: number;
  event_count: number;
  run_count: number;
  parent_count: number;
  child_count: number;
  children_done: number;
  latest_event_kind: string | null;
  latest_event_at: string | null;
  latest_summary: string | null;
  comments?: KanbanComment[];
  events?: KanbanEvent[];
  runs?: KanbanRun[];
  parents?: KanbanLink[];
  children?: KanbanLink[];
};

export type KanbanColumn = { key: string; label: string; hint: string; tasks: KanbanTask[]; count: number };

export type KanbanBoardSnapshot = {
  slug: string;
  name: string;
  description: string | null;
  isCurrent: boolean;
  archived: boolean;
  counts: Record<string, number>;
  total: number;
  active: number;
  ready: number;
  running: number;
  blocked: number;
  updatedAt: string;
};

export type KanbanSnapshot = {
  currentBoard: string;
  boards: KanbanBoardSnapshot[];
  columns: KanbanColumn[];
  tasks: KanbanTask[];
  tenants: string[];
  assignees: { name: string; onDisk: boolean; counts: Record<string, number>; total: number; active: number }[];
  stats: {
    boards: number;
    total: number;
    active: number;
    ready: number;
    running: number;
    blocked: number;
    done: number;
    latestEventId: number;
  };
  updatedAt: string;
};

function hermesRoot(): string {
  const explicit = (process.env.HERMES_KANBAN_HOME || "").trim();
  if (explicit) return path.resolve(explicit.replace(/^~/, os.homedir()));

  const home = (process.env.HERMES_HOME || "").trim();
  if (home) {
    const resolved = path.resolve(home.replace(/^~/, os.homedir()));
    const parent = path.basename(path.dirname(resolved));
    if (parent === PROFILE_DIR) return path.dirname(path.dirname(resolved));
    return resolved;
  }
  return path.join(os.homedir(), ".hermes");
}

function boardsRoot(root = hermesRoot()) { return path.join(root, "kanban", "boards"); }
function boardDir(slug: string, root = hermesRoot()) { return path.join(root, "kanban", "boards", slug); }
function boardDbPath(slug: string, root = hermesRoot()) { return slug === "default" ? path.join(root, "kanban.db") : path.join(boardDir(slug, root), "kanban.db"); }

function currentBoard(root = hermesRoot()) {
  const env = (process.env.HERMES_KANBAN_BOARD || "").trim();
  if (env) return env;
  try {
    const p = path.join(root, "kanban", "current");
    if (fs.existsSync(p)) {
      const val = fs.readFileSync(p, "utf8").trim();
      if (val) return val;
    }
  } catch {}
  return "default";
}

function epochToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000).toISOString();
}

function parsePayload(v: unknown) {
  if (typeof v !== "string" || !v) return null;
  try { return JSON.parse(v); } catch { return v; }
}

function readJson<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch { return null; }
}

function boardMeta(slug: string, root = hermesRoot()): BoardMeta {
  return readJson<BoardMeta>(path.join(boardDir(slug, root), "board.json")) || {};
}

function discoverBoards(root = hermesRoot()) {
  const slugs = new Set<string>(["default"]);
  const br = boardsRoot(root);
  try {
    if (fs.existsSync(br)) {
      for (const ent of fs.readdirSync(br, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith("_")) continue;
        const dir = path.join(br, ent.name);
        if (fs.existsSync(path.join(dir, "board.json")) || fs.existsSync(path.join(dir, "kanban.db"))) slugs.add(ent.name);
      }
    }
  } catch {}
  return [...slugs].sort((a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)));
}

function openReadonly(dbPath: string): Database.Database | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 1000");
  return db;
}

function countsFor(db: Database.Database | null, showArchived = false): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  if (!db) return counts;
  const sql = showArchived ? "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status" : "SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'archived' GROUP BY status";
  for (const row of db.prepare(sql).all() as CountRow[]) counts[row.status] = row.n;
  return counts;
}

function boardSnapshot(slug: string, current: string, root = hermesRoot(), showArchived = false): KanbanBoardSnapshot {
  const meta = boardMeta(slug, root);
  const db = openReadonly(boardDbPath(slug, root));
  try {
    const counts = countsFor(db, showArchived);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = Object.entries(counts).filter(([status]) => ACTIVE_STATUSES.has(status)).reduce((sum, [, n]) => sum + n, 0);
    return {
      slug,
      name: meta.name || (slug === "default" ? "Default" : slug),
      description: meta.description || null,
      isCurrent: slug === current,
      archived: !!meta.archived,
      counts,
      total,
      active,
      ready: counts.ready || 0,
      running: counts.running || 0,
      blocked: counts.blocked || 0,
      updatedAt: new Date().toISOString(),
    };
  } finally { db?.close(); }
}

function columnFor(status: string) {
  if (status === "scheduled") return "todo";
  if (status === "review") return "blocked";
  if (BOARD_COLUMNS.includes(status as any)) return status;
  return status;
}

function baseTask(r: any): KanbanTask {
  const children = Number(r.child_count || 0);
  const done = Number(r.children_done || 0);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    assignee: r.assignee,
    status: r.status,
    column: columnFor(r.status),
    priority: Number(r.priority || 0),
    created_by: r.created_by,
    created_at: epochToIso(r.created_at),
    started_at: epochToIso(r.started_at),
    completed_at: epochToIso(r.completed_at),
    tenant: r.tenant,
    result: r.result,
    workspace_kind: r.workspace_kind,
    workspace_path: r.workspace_path,
    current_run_id: r.current_run_id,
    last_heartbeat_at: epochToIso(r.last_heartbeat_at),
    consecutive_failures: Number(r.consecutive_failures || 0),
    last_failure_error: r.last_failure_error,
    goal_mode: !!r.goal_mode,
    current_step_key: r.current_step_key,
    comment_count: Number(r.comment_count || 0),
    event_count: Number(r.event_count || 0),
    run_count: Number(r.run_count || 0),
    parent_count: Number(r.parent_count || 0),
    child_count: children,
    children_done: done,
    latest_event_kind: r.latest_event_kind,
    latest_event_at: epochToIso(r.latest_event_at),
    latest_summary: r.latest_summary || r.result || null,
  };
}

function taskSelectSql(where: string) {
  return `SELECT t.id, t.title, t.body, t.assignee, t.status, t.priority, t.created_by,
              t.created_at, t.started_at, t.completed_at, t.tenant, t.result,
              t.workspace_kind, t.workspace_path, t.current_run_id, t.last_heartbeat_at,
              t.consecutive_failures, t.last_failure_error, t.goal_mode, t.current_step_key,
              (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
              (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id) AS event_count,
              (SELECT COUNT(*) FROM task_runs r WHERE r.task_id = t.id) AS run_count,
              (SELECT COUNT(*) FROM task_links l WHERE l.child_id = t.id) AS parent_count,
              (SELECT COUNT(*) FROM task_links l WHERE l.parent_id = t.id) AS child_count,
              (SELECT COUNT(*) FROM task_links l JOIN tasks child ON child.id = l.child_id WHERE l.parent_id = t.id AND child.status = 'done') AS children_done,
              (SELECT e.kind FROM task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS latest_event_kind,
              (SELECT e.created_at FROM task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS latest_event_at,
              (SELECT COALESCE(r.summary, r.error) FROM task_runs r WHERE r.task_id = t.id ORDER BY r.id DESC LIMIT 1) AS latest_summary
         FROM tasks t
        ${where}`;
}

function tasksFor(slug: string, root = hermesRoot(), showArchived = false, limit = 300): KanbanTask[] {
  const db = openReadonly(boardDbPath(slug, root));
  if (!db) return [];
  try {
    const where = showArchived ? "" : "WHERE t.status != 'archived'";
    const rows = db.prepare(
      `${taskSelectSql(where)}
        ORDER BY CASE t.status
                   WHEN 'triage' THEN 0
                   WHEN 'todo' THEN 1
                   WHEN 'scheduled' THEN 2
                   WHEN 'ready' THEN 3
                   WHEN 'running' THEN 4
                   WHEN 'blocked' THEN 5
                   WHEN 'review' THEN 6
                   WHEN 'done' THEN 7
                   WHEN 'archived' THEN 8
                   ELSE 9 END,
                 t.priority DESC,
                 t.created_at DESC
        LIMIT ?`
    ).all(limit) as any[];
    return rows.map(baseTask);
  } finally { db.close(); }
}

function commentsFor(db: Database.Database, taskId: string): KanbanComment[] {
  return (db.prepare("SELECT id, task_id, author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY id ASC LIMIT 80").all(taskId) as any[])
    .map((r) => ({ ...r, created_at: epochToIso(r.created_at) }));
}

function eventsFor(db: Database.Database, taskId: string): KanbanEvent[] {
  return (db.prepare("SELECT id, task_id, run_id, kind, payload, created_at FROM task_events WHERE task_id = ? ORDER BY id ASC LIMIT 120").all(taskId) as any[])
    .map((r) => ({ ...r, payload: parsePayload(r.payload), created_at: epochToIso(r.created_at) }));
}

function runsFor(db: Database.Database, taskId: string): KanbanRun[] {
  return (db.prepare("SELECT id, status, profile, outcome, summary, error, started_at, ended_at FROM task_runs WHERE task_id = ? ORDER BY id DESC LIMIT 30").all(taskId) as any[])
    .map((r) => ({ ...r, started_at: epochToIso(r.started_at), ended_at: epochToIso(r.ended_at) }));
}

function linksFor(db: Database.Database, taskId: string) {
  const parents = db.prepare(
    `SELECT l.parent_id, l.child_id, p.title, p.status FROM task_links l LEFT JOIN tasks p ON p.id = l.parent_id WHERE l.child_id = ? ORDER BY p.created_at DESC`
  ).all(taskId) as KanbanLink[];
  const children = db.prepare(
    `SELECT l.parent_id, l.child_id, c.title, c.status FROM task_links l LEFT JOIN tasks c ON c.id = l.child_id WHERE l.parent_id = ? ORDER BY c.created_at DESC`
  ).all(taskId) as KanbanLink[];
  return { parents, children };
}

export function kanbanTaskDetail(taskId: string, board?: string): KanbanTask | null {
  const root = hermesRoot();
  const selected = board || currentBoard(root);
  const db = openReadonly(boardDbPath(selected, root));
  if (!db) return null;
  try {
    const row = db.prepare(taskSelectSql("WHERE t.id = ?")).get(taskId) as any;
    if (!row) return null;
    const task = baseTask(row);
    const { parents, children } = linksFor(db, taskId);
    return { ...task, comments: commentsFor(db, taskId), events: eventsFor(db, taskId), runs: runsFor(db, taskId), parents, children };
  } finally { db.close(); }
}

function profileNames(root = hermesRoot()) {
  const names = new Set<string>(["default"]);
  const profiles = path.join(root, PROFILE_DIR);
  try {
    if (fs.existsSync(profiles)) {
      for (const ent of fs.readdirSync(profiles, { withFileTypes: true })) if (ent.isDirectory()) names.add(ent.name);
    }
  } catch {}
  return names;
}

function assigneesFor(slug: string, root = hermesRoot(), showArchived = false) {
  const onDisk = profileNames(root);
  const names = new Set<string>(onDisk);
  const db = openReadonly(boardDbPath(slug, root));
  const byName = new Map<string, Record<string, number>>();
  try {
    if (db) {
      const where = showArchived ? "" : "WHERE status != 'archived'";
      const rows = db.prepare(
        `SELECT COALESCE(assignee, 'unassigned') AS assignee, status, COUNT(*) AS n FROM tasks ${where} GROUP BY assignee, status`
      ).all() as { assignee: string; status: string; n: number }[];
      for (const row of rows) {
        names.add(row.assignee);
        const counts = byName.get(row.assignee) || {};
        counts[row.status] = row.n;
        byName.set(row.assignee, counts);
      }
    }
  } finally { db?.close(); }

  return [...names].sort().map((name) => {
    const counts = byName.get(name) || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = Object.entries(counts).filter(([status]) => ACTIVE_STATUSES.has(status)).reduce((sum, [, n]) => sum + n, 0);
    return { name, onDisk: onDisk.has(name), counts, total, active };
  });
}

function tenantsFor(tasks: KanbanTask[]) {
  return [...new Set(tasks.map((t) => t.tenant).filter(Boolean) as string[])].sort();
}

function latestEventId(slug: string, root = hermesRoot()) {
  const db = openReadonly(boardDbPath(slug, root));
  if (!db) return 0;
  try {
    return Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM task_events").get() as any)?.id || 0);
  } finally { db.close(); }
}

function columnsFor(tasks: KanbanTask[]): KanbanColumn[] {
  const specs: Record<string, { label: string; hint: string }> = {
    triage: { label: "Triage", hint: "Raw ideas — specify or decompose" },
    todo: { label: "Todo", hint: "Waiting on dependencies or assignment" },
    ready: { label: "Ready", hint: "Assigned and waiting for dispatcher" },
    running: { label: "In Progress", hint: "Claimed by a worker — in flight" },
    blocked: { label: "Blocked", hint: "Worker asked for human input" },
    done: { label: "Done", hint: "Completed" },
  };
  return BOARD_COLUMNS.map((key) => {
    const colTasks = tasks.filter((t) => t.column === key);
    return { key, label: specs[key].label, hint: specs[key].hint, tasks: colTasks, count: colTasks.length };
  });
}

export function kanbanSnapshot(opts: { board?: string; showArchived?: boolean } | string = {}): KanbanSnapshot {
  const root = hermesRoot();
  const options = typeof opts === "string" ? { board: opts } : opts;
  const current = options.board || currentBoard(root);
  const boards = discoverBoards(root).map((slug) => boardSnapshot(slug, current, root, !!options.showArchived));
  const selected = boards.some((b) => b.slug === current) ? current : "default";
  const currentBoardSnap = boards.find((b) => b.slug === selected) || boardSnapshot(selected, selected, root, !!options.showArchived);
  const tasks = tasksFor(selected, root, !!options.showArchived);
  const now = new Date().toISOString();
  return {
    currentBoard: selected,
    boards,
    columns: columnsFor(tasks),
    tasks,
    tenants: tenantsFor(tasks),
    assignees: assigneesFor(selected, root, !!options.showArchived),
    stats: {
      boards: boards.length,
      total: currentBoardSnap.total,
      active: currentBoardSnap.active,
      ready: currentBoardSnap.ready,
      running: currentBoardSnap.running,
      blocked: currentBoardSnap.blocked,
      done: currentBoardSnap.counts.done || 0,
      latestEventId: latestEventId(selected, root),
    },
    updatedAt: now,
  };
}
