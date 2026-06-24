// Named-agent orchestration: the ONE write path (recordAgentEvent) and the ONE read model
// (agentsOrchestrationSnapshot), shared by scripts/agent-event.ts (the local CLI writer),
// the /api/agents/runs route, and the scheduler tick. Server-only: touches SQLite (+ the
// events ticker, also SQLite). No network, no hub, no secrets — so the CLI can import it
// safely as a trusted local writer. Mirrors the lib/vending.ts "shared snapshot" pattern.
import { getDb, all, get, nowIso, pushEvent } from "@/db";

if (typeof window !== "undefined") {
  throw new Error("lib/agents.ts is server-only");
}

// ---- status / validation contract (belt-and-suspenders to the migration CHECKs) ----
export const RUN_STATUSES = [
  "idle",
  "queued",
  "running",
  "waiting_for_review",
  "blocked",
  "completed",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const TERMINAL = new Set<string>(["completed", "failed"]);

export const LEVELS = ["info", "success", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];
const LEVEL_SET = new Set<string>(LEVELS);

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const MAX = {
  summary: 500,
  title: 200,
  uri: 1000,
  kind: 64,
  json: 8192,
  displayName: 120,
  description: 1000,
  scheduleLabel: 80,
  triggerType: 64,
  triggerSource: 200,
  artifactType: 64,
};

export class AgentEventError extends Error {}

function reqStr(v: unknown, name: string, max: number): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new AgentEventError(`${name} is required`);
  }
  if (v.length > max) throw new AgentEventError(`${name} exceeds ${max} chars`);
  return v;
}
function optStr(v: unknown, name: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new AgentEventError(`${name} must be a string`);
  if (v.length > max) throw new AgentEventError(`${name} exceeds ${max} chars`);
  return v;
}
// Validate optional JSON text: must parse and be within the size cap. Returns the original
// text (stored as-is) or null.
function optJson(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new AgentEventError(`${name} must be a JSON string`);
  if (Buffer.byteLength(v, "utf8") > MAX.json) throw new AgentEventError(`${name} exceeds ${MAX.json} bytes`);
  try {
    JSON.parse(v);
  } catch {
    throw new AgentEventError(`${name} is not valid JSON`);
  }
  return v;
}

export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---- the write path ----
export interface RecordEventInput {
  agent: string; // slug
  run: string; // run id
  summary: string;
  kind?: string; // event kind (free-form), default 'event'
  status?: string; // run status (validated against the enum) — optional; keeps run status if omitted
  level?: string; // info|success|warn|error, default 'info'
  detail?: string; // JSON text, optional
  triggerType?: string;
  triggerSource?: string;
  displayName?: string;
  description?: string;
  scheduleLabel?: string;
  enabled?: boolean;
  artifact?: { type: string; title: string; uri: string; metadata?: string };
}

export interface RecordEventResult {
  eventId: number;
  run: string;
  agent: string;
  status: RunStatus;
  artifactId?: number;
}

/**
 * The single, validated write path for an agent run event. Atomic: upserts the registry
 * row, upserts the run, inserts the timeline event, updates registry status/last-run, and
 * (optionally) inserts an artifact — all in one transaction. Mirrors meaningful events to
 * the bottom `events` ticker (a SQLite insert; the scheduler broadcasts that channel).
 * Throws AgentEventError on any invalid input or illegal state transition.
 */
export function recordAgentEvent(input: RecordEventInput): RecordEventResult {
  const agent = reqStr(input.agent, "agent", 64);
  if (!SLUG_RE.test(agent)) {
    throw new AgentEventError(`agent slug must match ${SLUG_RE} (lowercase a-z0-9._-)`);
  }
  const runId = reqStr(input.run, "run", 128);
  if (!RUN_ID_RE.test(runId)) {
    throw new AgentEventError(`run id must match ${RUN_ID_RE}`);
  }
  const summary = reqStr(input.summary, "summary", MAX.summary);
  const kind = optStr(input.kind, "kind", MAX.kind) || "event";
  const level = (optStr(input.level, "level", 16) || "info") as Level;
  if (!LEVEL_SET.has(level)) {
    throw new AgentEventError(`level must be one of ${LEVELS.join(", ")}`);
  }
  let status: string | undefined = input.status === undefined ? undefined : optStr(input.status, "status", 32) || undefined;
  if (status !== undefined && !RUN_STATUS_SET.has(status)) {
    throw new AgentEventError(`status must be one of ${RUN_STATUSES.join(", ")}`);
  }
  const detail = optJson(input.detail, "detail");
  const triggerType = optStr(input.triggerType, "trigger-type", MAX.triggerType);
  const triggerSource = optStr(input.triggerSource, "trigger-source", MAX.triggerSource);
  const displayName = optStr(input.displayName, "display-name", MAX.displayName);
  const description = optStr(input.description, "description", MAX.description);
  const scheduleLabel = optStr(input.scheduleLabel, "schedule-label", MAX.scheduleLabel);

  let artifact: { type: string; title: string; uri: string; metadata: string | null } | null = null;
  if (input.artifact) {
    artifact = {
      type: reqStr(input.artifact.type, "artifact-type", MAX.artifactType),
      title: reqStr(input.artifact.title, "artifact-title", MAX.title),
      uri: reqStr(input.artifact.uri, "artifact-uri", MAX.uri),
      metadata: optJson(input.artifact.metadata, "artifact-metadata"),
    };
  }

  const ts = nowIso();
  const db = getDb();

  const tx = db.transaction((): RecordEventResult => {
    // 1) upsert the registry row (system-owned). Apply metadata only when provided.
    const existingAgent = get<any>("SELECT slug FROM agent_registry WHERE slug = ?", agent);
    if (!existingAgent) {
      db.prepare(
        `INSERT INTO agent_registry (slug, display_name, description, enabled, schedule_label, current_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'idle', ?)`
      ).run(agent, displayName || humanizeSlug(agent), description, input.enabled === false ? 0 : 1, scheduleLabel, ts);
    } else {
      const sets: string[] = [];
      const params: any[] = [];
      if (displayName) { sets.push("display_name = ?"); params.push(displayName); }
      if (description) { sets.push("description = ?"); params.push(description); }
      if (scheduleLabel) { sets.push("schedule_label = ?"); params.push(scheduleLabel); }
      if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(input.enabled ? 1 : 0); }
      if (sets.length) {
        params.push(agent);
        db.prepare(`UPDATE agent_registry SET ${sets.join(", ")} WHERE slug = ?`).run(...params);
      }
    }

    // 2) upsert the run, enforcing state-transition rules.
    const run = get<any>("SELECT id, agent_slug, status, finished_at, started_at FROM agent_runs WHERE id = ?", runId);
    let effectiveStatus: string;
    let runStartedAt: string;
    if (!run) {
      effectiveStatus = status ?? "running";
      runStartedAt = ts;
      const finishedAt = TERMINAL.has(effectiveStatus) ? ts : null;
      db.prepare(
        `INSERT INTO agent_runs (id, agent_slug, status, trigger_type, trigger_source, summary, started_at, finished_at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(runId, agent, effectiveStatus, triggerType, triggerSource, summary, ts, finishedAt, detail);
    } else {
      if (run.agent_slug !== agent) {
        throw new AgentEventError(
          `run ${runId} already belongs to agent '${run.agent_slug}', not '${agent}'`
        );
      }
      const prev = run.status as string;
      // A terminal run is final and immutable. Reject ANY further event (status given,
      // omitted, or same) so a late / out-of-order event can't overwrite its summary or
      // regress the agent's registry pointer. Start a new run id to record more activity.
      if (TERMINAL.has(prev)) {
        throw new AgentEventError(
          `run ${runId} is already ${prev} (terminal); start a new run id to record more activity`
        );
      }
      effectiveStatus = status ?? prev;
      runStartedAt = run.started_at as string;
      const becameTerminal = TERMINAL.has(effectiveStatus);
      const finishedAt = becameTerminal ? run.finished_at || ts : run.finished_at;
      db.prepare(
        `UPDATE agent_runs
           SET status = ?, summary = ?, finished_at = ?,
               trigger_type = COALESCE(trigger_type, ?),
               trigger_source = COALESCE(trigger_source, ?),
               detail = COALESCE(?, detail)
         WHERE id = ?`
      ).run(effectiveStatus, summary, finishedAt, triggerType, triggerSource, detail, runId);
    }

    // 3) insert the timeline event.
    const evRes = db
      .prepare(
        `INSERT INTO agent_run_events (run_id, agent_slug, ts, kind, status, level, summary, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(runId, agent, ts, kind, status ?? null, level, summary, detail);
    const eventId = Number(evRes.lastInsertRowid);

    // 4) update registry current status / last run pointers. Advance the pointer only when
    //    this run is at least as new as the one the registry currently points to, so a stray
    //    event on an OLDER run can't regress the agent's visible status to a stale run.
    const pointed = get<any>("SELECT last_run_id FROM agent_registry WHERE slug = ?", agent);
    let advance = true;
    if (pointed?.last_run_id && pointed.last_run_id !== runId) {
      const cur = get<any>("SELECT started_at FROM agent_runs WHERE id = ?", pointed.last_run_id);
      if (cur && cur.started_at > runStartedAt) advance = false;
    }
    if (advance) {
      db.prepare(
        `UPDATE agent_registry SET current_status = ?, last_run_id = ?, last_run_at = ?, updated_at = ? WHERE slug = ?`
      ).run(effectiveStatus, runId, ts, ts, agent);
    } else {
      db.prepare(`UPDATE agent_registry SET updated_at = ? WHERE slug = ?`).run(ts, agent);
    }

    // 5) optional artifact.
    let artifactId: number | undefined;
    if (artifact) {
      const aRes = db
        .prepare(
          `INSERT INTO agent_artifacts (run_id, agent_slug, type, title, uri, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, agent, artifact.type, artifact.title, artifact.uri, artifact.metadata, ts);
      artifactId = Number(aRes.lastInsertRowid);
    }

    // 6) mirror meaningful events to the bottom ticker (SQLite insert; scheduler broadcasts
    //    the `ticker` channel). Meaningful = new run, a status change, or a warn/error.
    const prevStatus = run?.status as string | undefined;
    const statusChanged = status !== undefined && status !== prevStatus;
    const meaningful = !run || statusChanged || level === "warn" || level === "error";
    if (meaningful) {
      const reg = get<any>("SELECT display_name FROM agent_registry WHERE slug = ?", agent);
      const name = reg?.display_name || humanizeSlug(agent);
      const tickerLevel: "info" | "success" | "warn" | "error" =
        level === "info" ? (effectiveStatus === "completed" ? "success" : "info") : level;
      pushEvent(agent, `${name}: ${summary}`, tickerLevel);
    }

    return { eventId, run: runId, agent, status: effectiveStatus as RunStatus, artifactId };
  });

  // IMMEDIATE (not the default DEFERRED): this transaction reads then writes, and the CLI
  // process + the server process write the same WAL DB concurrently. Taking the write lock
  // at BEGIN lets busy_timeout serialize the two writers, instead of one hitting
  // SQLITE_BUSY_SNAPSHOT (which busy_timeout does NOT retry) and losing the event.
  return tx.immediate();
}

// ---- read model ----
const SNAP = { recentRuns: 30, recentEvents: 60, timelinePerRun: 40, artifactsPerRun: 20 };

function runDetailRows(runId: string, eventLimit: number, artifactLimit: number, latest = false) {
  // For the bounded live snapshot (latest=true) take the MOST RECENT N then reverse to
  // chronological order for display — otherwise a run with > N events would freeze the card
  // on its first N events and hide the live tail. runDetail() passes latest=false (full
  // chronological history up to a high cap), so it keeps ASC.
  const evSql = latest
    ? "SELECT id, ts, kind, status, level, summary, detail FROM agent_run_events WHERE run_id = ? ORDER BY id DESC LIMIT ?"
    : "SELECT id, ts, kind, status, level, summary, detail FROM agent_run_events WHERE run_id = ? ORDER BY id ASC LIMIT ?";
  const artSql = latest
    ? "SELECT id, type, title, uri, metadata, created_at FROM agent_artifacts WHERE run_id = ? ORDER BY id DESC LIMIT ?"
    : "SELECT id, type, title, uri, metadata, created_at FROM agent_artifacts WHERE run_id = ? ORDER BY id ASC LIMIT ?";
  const timeline = all<any>(evSql, runId, eventLimit);
  const artifacts = all<any>(artSql, runId, artifactLimit);
  if (latest) {
    timeline.reverse();
    artifacts.reverse();
  }
  return { timeline, artifacts };
}

/** Full detail for one run (used by the gated /api/agents/runs/[id] route). */
export function runDetail(runId: string) {
  const run = get<any>("SELECT * FROM agent_runs WHERE id = ?", runId);
  if (!run) return null;
  const { timeline, artifacts } = runDetailRows(runId, 500, 100);
  return { run, timeline, artifacts };
}

/** The orchestration snapshot — one object the API route and the scheduler both broadcast. */
export function agentsOrchestrationSnapshot() {
  const agents = all<any>(
    `SELECT slug, display_name, description, enabled, schedule_label, current_status, last_run_id, last_run_at, updated_at
       FROM agent_registry
      ORDER BY CASE slug
                 WHEN 'hermes-orchestrator' THEN 0
                 WHEN 'portable-charging-lead-scout' THEN 1
                 WHEN 'portable-charging-outreach-sender' THEN 2
                 WHEN 'deliverability-monitor' THEN 3
                 ELSE 9 END,
               display_name ASC`
  );

  const withLatest = agents.map((a: any) => {
    let latestRun: any = null;
    let runRow = a.last_run_id
      ? get<any>("SELECT * FROM agent_runs WHERE id = ?", a.last_run_id)
      : undefined;
    if (!runRow) {
      // no pointer, or a dangling/pruned last_run_id -> fall back to the agent's most recent run
      runRow = get<any>("SELECT * FROM agent_runs WHERE agent_slug = ? ORDER BY started_at DESC LIMIT 1", a.slug);
    }
    if (runRow) {
      const { timeline, artifacts } = runDetailRows(runRow.id, SNAP.timelinePerRun, SNAP.artifactsPerRun, true);
      latestRun = { ...runRow, timeline, artifacts };
    }
    return { ...a, enabled: !!a.enabled, latestRun };
  });

  const activeRuns = all<any>(
    `SELECT id, agent_slug, status, summary, started_at, finished_at, trigger_type, trigger_source
       FROM agent_runs
      WHERE status IN ('running','queued','waiting_for_review','blocked')
      ORDER BY started_at DESC
      LIMIT 100`
  );
  const recentRuns = all<any>(
    `SELECT id, agent_slug, status, summary, started_at, finished_at, trigger_type, trigger_source
       FROM agent_runs ORDER BY started_at DESC LIMIT ?`,
    SNAP.recentRuns
  );
  const recentEvents = all<any>(
    `SELECT id, run_id, agent_slug, ts, kind, status, level, summary
       FROM agent_run_events ORDER BY id DESC LIMIT ?`,
    SNAP.recentEvents
  );

  const stats = {
    total: agents.length,
    enabled: agents.filter((a: any) => a.enabled).length,
    active: agents.filter((a: any) => ["running", "queued"].includes(a.current_status)).length,
    waiting: agents.filter((a: any) => a.current_status === "waiting_for_review").length,
    blocked: agents.filter((a: any) => a.current_status === "blocked").length,
    idle: agents.filter((a: any) => a.current_status === "idle").length,
    runsActive: activeRuns.length,
  };

  return { agents: withLatest, activeRuns, recentRuns, recentEvents, stats, updatedAt: nowIso() };
}
