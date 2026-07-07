// Hermes Kanban read model for Rathworkspace. Server-only: reads the shared Hermes
// kanban SQLite databases in query-only mode and exposes a small dashboard snapshot.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("lib/kanban.ts is server-only");
}

const STATUSES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"];
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

export type KanbanTask = {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
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
  latest_event_kind: string | null;
  latest_event_at: string | null;
};

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
  tasks: KanbanTask[];
  assignees: { name: string; onDisk: boolean; counts: Record<string, number>; total: number; active: number }[];
  stats: {
    boards: number;
    total: number;
    active: number;
    ready: number;
    running: number;
    blocked: number;
    done: number;
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

function boardsRoot(root = hermesRoot()) {
  return path.join(root, "kanban", "boards");
}

function currentBoard(root = hermesRoot()) {
  const env = (process.env.HERMES_KANBAN_BOARD || "").trim();
  if (env) return env;
  try {
    const p = path.join(root, "kanban", "current");
    if (fs.existsSync(p)) {
      const val = fs.readFileSync(p, "utf8").trim();
      if (val) return val;
    }
  } catch {
    // fall through to default
  }
  return "default";
}

function boardDir(slug: string, root = hermesRoot()) {
  return path.join(root, "kanban", "boards", slug);
}

function boardDbPath(slug: string, root = hermesRoot()) {
  if (slug === "default") return path.join(root, "kanban.db");
  return path.join(boardDir(slug, root), "kanban.db");
}

function epochToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000).toISOString();
}

function readJson<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
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
        if (fs.existsSync(path.join(dir, "board.json")) || fs.existsSync(path.join(dir, "kanban.db"))) {
          slugs.add(ent.name);
        }
      }
    }
  } catch {
    // best-effort snapshot
  }
  return [...slugs].sort((a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)));
}

function openReadonly(dbPath: string): Database.Database | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 1000");
  return db;
}

function countsFor(db: Database.Database | null): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  if (!db) return counts;
  for (const row of db.prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'archived' GROUP BY status").all() as CountRow[]) {
    counts[row.status] = row.n;
  }
  return counts;
}

function boardSnapshot(slug: string, current: string, root = hermesRoot()): KanbanBoardSnapshot {
  const meta = boardMeta(slug, root);
  const db = openReadonly(boardDbPath(slug, root));
  try {
    const counts = countsFor(db);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = Object.entries(counts)
      .filter(([status]) => ACTIVE_STATUSES.has(status))
      .reduce((sum, [, n]) => sum + n, 0);
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
  } finally {
    db?.close();
  }
}

function tasksFor(slug: string, root = hermesRoot(), limit = 80): KanbanTask[] {
  const db = openReadonly(boardDbPath(slug, root));
  if (!db) return [];
  try {
    const rows = db.prepare(
      `SELECT t.id, t.title, t.body, t.assignee, t.status, t.priority, t.created_by,
              t.created_at, t.started_at, t.completed_at, t.tenant, t.result,
              t.workspace_kind, t.workspace_path, t.current_run_id, t.last_heartbeat_at,
              t.consecutive_failures, t.last_failure_error, t.goal_mode, t.current_step_key,
              (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
              (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id) AS event_count,
              (SELECT e.kind FROM task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS latest_event_kind,
              (SELECT e.created_at FROM task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS latest_event_at
         FROM tasks t
        WHERE t.status != 'archived'
        ORDER BY CASE t.status
                   WHEN 'running' THEN 0
                   WHEN 'blocked' THEN 1
                   WHEN 'ready' THEN 2
                   WHEN 'review' THEN 3
                   WHEN 'todo' THEN 4
                   WHEN 'triage' THEN 5
                   WHEN 'scheduled' THEN 6
                   WHEN 'done' THEN 7
                   ELSE 8 END,
                 t.priority DESC,
                 t.created_at DESC
        LIMIT ?`
    ).all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      assignee: r.assignee,
      status: r.status,
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
      latest_event_kind: r.latest_event_kind,
      latest_event_at: epochToIso(r.latest_event_at),
    }));
  } finally {
    db.close();
  }
}

function profileNames(root = hermesRoot()) {
  const names = new Set<string>(["default"]);
  const profiles = path.join(root, PROFILE_DIR);
  try {
    if (fs.existsSync(profiles)) {
      for (const ent of fs.readdirSync(profiles, { withFileTypes: true })) {
        if (ent.isDirectory()) names.add(ent.name);
      }
    }
  } catch {
    // best-effort
  }
  return names;
}

function assigneesFor(slug: string, root = hermesRoot()) {
  const names = profileNames(root);
  const db = openReadonly(boardDbPath(slug, root));
  const byName = new Map<string, Record<string, number>>();
  try {
    if (db) {
      const rows = db.prepare(
        "SELECT COALESCE(assignee, 'unassigned') AS assignee, status, COUNT(*) AS n FROM tasks WHERE status != 'archived' GROUP BY assignee, status"
      ).all() as { assignee: string; status: string; n: number }[];
      for (const row of rows) {
        names.add(row.assignee);
        const counts = byName.get(row.assignee) || {};
        counts[row.status] = row.n;
        byName.set(row.assignee, counts);
      }
    }
  } finally {
    db?.close();
  }

  return [...names].sort().map((name) => {
    const counts = byName.get(name) || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = Object.entries(counts)
      .filter(([status]) => ACTIVE_STATUSES.has(status))
      .reduce((sum, [, n]) => sum + n, 0);
    return { name, onDisk: name === "default" || profileNames(root).has(name), counts, total, active };
  });
}

export function kanbanSnapshot(board?: string): KanbanSnapshot {
  const root = hermesRoot();
  const current = board || currentBoard(root);
  const boards = discoverBoards(root).map((slug) => boardSnapshot(slug, current, root));
  const selected = boards.some((b) => b.slug === current) ? current : "default";
  const currentBoardSnap = boards.find((b) => b.slug === selected) || boardSnapshot(selected, selected, root);
  const tasks = tasksFor(selected, root);
  const now = new Date().toISOString();
  return {
    currentBoard: selected,
    boards,
    tasks,
    assignees: assigneesFor(selected, root),
    stats: {
      boards: boards.length,
      total: currentBoardSnap.total,
      active: currentBoardSnap.active,
      ready: currentBoardSnap.ready,
      running: currentBoardSnap.running,
      blocked: currentBoardSnap.blocked,
      done: currentBoardSnap.counts.done || 0,
    },
    updatedAt: now,
  };
}
