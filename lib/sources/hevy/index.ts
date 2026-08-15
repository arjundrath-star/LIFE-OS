import type Database from "better-sqlite3";
import { get, getDb, nowIso } from "@/db";
import { isConnectionEnabled } from "@/lib/connections/enabled";
import {
  HevySyncError,
  hevyConnectionDetail,
  sanitizeHevyError,
} from "@/lib/health/hevy-errors";
import {
  acquireSourceLease,
  credentialIdentity,
  ensureSourceState,
  quarantineImportedRows,
  releaseSourceLease,
  sourceCommitStillCurrent,
  sourceIdentity,
  sourceLeaseStillCurrent,
} from "@/lib/health/source-state";
import { hasSecret, secret } from "@/lib/secrets";

const API = "https://api.hevyapp.com/v1";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_SYNC_DEADLINE_MS = 60_000;
const OVERLAP_MS = 5 * 60_000;
const PAGE_SIZE = 10;
const MAX_PAGES = 200;
const MAX_RECORDS = 2_000;
const HEALTH_CHECK_TTL_MS = 30 * 60_000;
type Requester = (url: string, init?: RequestInit) => Promise<Response>;

export type HevySet = { externalId: string; order: number; type: string; weightKg: number | null; reps: number | null; durationSeconds: number | null; distanceMeters: number | null; rpe: number | null; rir: number | null; completed: boolean | null; raw: unknown };
export type HevyExercise = { externalId: string; templateId: string | null; title: string; order: number; notes: string; sets: HevySet[]; raw: unknown };
export type HevyWorkout = { externalId: string; title: string; description: string; startedAt: string; endedAt: string | null; updatedAt: string; durationSeconds: number | null; exercises: HevyExercise[]; raw: unknown };
type HevyMeasurement = { externalId: string; measuredAt: string; updatedAt: string; weightKg: number | null; bodyFatPct: number | null; leanMassKg: number | null; waistCm: number | null; raw: unknown };
type HevyAccount = { id: string; name: string; url: string; identity: string };
type WorkoutMutation = { type: "delete"; externalId: string; sourceUpdatedAt: string } | { type: "upsert"; workout: HevyWorkout; sourceUpdatedAt: string };

function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function numberOrNull(value: unknown) { const n = typeof value === "number" ? value : Number(value); return value == null || value === "" || !Number.isFinite(n) ? null : n; }
function iso(value: unknown): string | null { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null; return new Date(value).toISOString(); }
function dateKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function setType(value: unknown) { const raw = text(value, "normal").toLowerCase().replaceAll(" ", "_"); const normalized = raw === "warm_up" ? "warmup" : raw === "drop_set" ? "dropset" : raw; return ["warmup", "normal", "failure", "dropset", "superset", "rest_pause"].includes(normalized) ? normalized : "other"; }
function schema(_message: string): never { throw new HevySyncError("HEVY_SCHEMA_ERROR"); }

async function boundedRequest(request: Requester, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try { return await request(url, { ...init, signal: controller.signal }); }
  catch (error) { if (controller.signal.aborted) throw new HevySyncError("HEVY_SYNC_TIMEOUT"); throw new HevySyncError("HEVY_HTTP_ERROR"); }
  finally { clearTimeout(timer); }
}

export function normalizeWorkout(raw: any): HevyWorkout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) schema("workout must be an object");
  const externalId = text(raw.id);
  if (!externalId) schema("workout is missing id");
  const startedAt = iso(raw.start_time);
  if (!startedAt) schema(`workout ${externalId} is missing a valid start_time`);
  if (!Array.isArray(raw.exercises)) schema(`workout ${externalId} is partial: exercises are missing`);
  const endedAt = raw.end_time == null ? null : iso(raw.end_time);
  if (raw.end_time != null && !endedAt) schema(`workout ${externalId} has an invalid end_time`);
  const exercises = raw.exercises.map((exercise: any, exerciseIndex: number): HevyExercise => {
    if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) schema(`workout ${externalId} has an invalid exercise`);
    if (!Array.isArray(exercise.sets)) schema(`workout ${externalId} exercise ${exerciseIndex} is partial: sets are missing`);
    const exerciseId = `${externalId}:exercise:${Number.isInteger(exercise.index) ? exercise.index : exerciseIndex}`;
    const sets = exercise.sets.map((set: any, setIndex: number): HevySet => {
      if (!set || typeof set !== "object" || Array.isArray(set)) schema(`workout ${externalId} has an invalid set`);
      const order = Number.isInteger(set.index) ? set.index : setIndex;
      return { externalId: `${exerciseId}:set:${order}`, order, type: setType(set.type), weightKg: numberOrNull(set.weight_kg), reps: numberOrNull(set.reps), durationSeconds: numberOrNull(set.duration_seconds), distanceMeters: numberOrNull(set.distance_meters), rpe: numberOrNull(set.rpe), rir: null, completed: null, raw: set };
    });
    return { externalId: exerciseId, templateId: text(exercise.exercise_template_id) || null, title: text(exercise.title, "Unknown exercise"), order: Number.isInteger(exercise.index) ? exercise.index : exerciseIndex, notes: text(exercise.notes), sets, raw: exercise };
  });
  const durationSeconds = endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;
  const updatedAt = iso(raw.updated_at) ?? endedAt ?? startedAt;
  return { externalId, title: text(raw.title, "Untitled workout"), description: text(raw.description), startedAt, endedAt, updatedAt, durationSeconds, exercises, raw };
}

function normalizeMeasurement(raw: any): HevyMeasurement {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) schema("body measurement must be an object");
  const externalId = dateKey(raw.date);
  if (!externalId) schema("body measurement is missing a valid date identity");
  const measuredAt = `${externalId}T00:00:00.000Z`;
  const result = { externalId, measuredAt, updatedAt: iso(raw.updated_at) ?? measuredAt, weightKg: numberOrNull(raw.weight_kg), bodyFatPct: numberOrNull(raw.fat_percent), leanMassKg: numberOrNull(raw.lean_mass_kg), waistCm: numberOrNull(raw.waist), raw };
  if ([result.weightKg, result.bodyFatPct, result.leanMassKg, result.waistCm].every((value) => value == null)) schema(`body measurement ${externalId} has no supported values`);
  return result;
}

function normalizeUserInfo(payload: any): HevyAccount {
  const data = payload?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) schema("user info is missing data");
  const id = text(data.id), name = text(data.name), url = text(data.url);
  if (!id || !name || !url) schema("user info data must contain id, name, and url");
  return { id, name, url, identity: sourceIdentity("hevy-account", id) };
}

export class HevyClient {
  private readonly deadlineAt: number;
  constructor(private apiKey: string, private request: Requester = fetch, private base = API, private timeoutMs = DEFAULT_TIMEOUT_MS, syncDeadlineMs = DEFAULT_SYNC_DEADLINE_MS) { this.deadlineAt = Date.now() + syncDeadlineMs; }
  assertWithinDeadline() { if (Date.now() >= this.deadlineAt) throw new HevySyncError("HEVY_SYNC_DEADLINE"); }
  async json(path: string) {
    this.assertWithinDeadline();
    const remaining = this.deadlineAt - Date.now();
    const response = await boundedRequest(this.request, `${this.base}${path}`, { headers: { "api-key": this.apiKey, accept: "application/json" } }, Math.min(this.timeoutMs, remaining));
    if (!response.ok) throw new HevySyncError(response.status === 401 || response.status === 403 ? "HEVY_AUTH_ERROR" : "HEVY_HTTP_ERROR");
    try { const payload = await response.json(); this.assertWithinDeadline(); return payload; } catch (error) { if (error instanceof HevySyncError) throw error; schema("invalid JSON"); }
  }
  async userInfo() { return normalizeUserInfo(await this.json("/user/info")); }
}

function strictPage(payload: any, key: string, path: string, requestedPage: number) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) schema(`${path} response must be an object`);
  if (!Number.isInteger(payload.page) || payload.page !== requestedPage) schema(`${path} has an invalid page number`);
  if (!Number.isInteger(payload.page_count) || payload.page_count < 0 || (payload.page_count > 0 && payload.page_count < requestedPage)) schema(`${path} has an invalid page_count`);
  if (!Array.isArray(payload[key])) schema(`${path}.${key} must be an array`);
  return { items: payload[key] as any[], pageCount: payload.page_count as number };
}

export async function fetchPaginated(client: HevyClient, path: string, key: string, options: { pageSize?: number; maxPages?: number; maxRecords?: number } = {}) {
  const pageSize = Math.min(PAGE_SIZE, Math.max(1, options.pageSize ?? PAGE_SIZE));
  const maxPages = options.maxPages ?? MAX_PAGES, maxRecords = options.maxRecords ?? MAX_RECORDS;
  const records: any[] = []; let expectedPageCount: number | null = null;
  for (let page = 1; ; page += 1) {
    if (page > maxPages) throw new HevySyncError("HEVY_PAGINATION_ERROR");
    const separator = path.includes("?") ? "&" : "?";
    const parsed = strictPage(await client.json(`${path}${separator}page=${page}&pageSize=${pageSize}`), key, path, page);
    if (expectedPageCount == null) expectedPageCount = parsed.pageCount;
    else if (parsed.pageCount !== expectedPageCount) schema(`${path} page_count changed during traversal`);
    records.push(...parsed.items);
    if (records.length > maxRecords) throw new HevySyncError("HEVY_PAGINATION_ERROR");
    if (parsed.pageCount === 0 || page >= parsed.pageCount) return records;
  }
}

function sourceOrderAllows(existing: any, sourceUpdatedAt: string, runVersion: number): boolean {
  if (!existing) return true;
  const previous = typeof existing.source_updated_at === "string" ? existing.source_updated_at : null;
  if (previous && sourceUpdatedAt < previous) return false;
  return sourceUpdatedAt !== previous || runVersion >= Number(existing.source_run_version ?? 0);
}

function storageIdentity(kind: "workout" | "measurement", accountIdentity: string, externalId: string) {
  return sourceIdentity(`hevy-${kind}:${accountIdentity}`, externalId);
}

function applyWorkout(db: Database.Database, accountIdentity: string, workout: HevyWorkout, sourceUpdatedAt = workout.updatedAt, runVersion = 0) {
  const ts = nowIso(), payload = JSON.stringify(workout.raw), storedExternalId = storageIdentity("workout", accountIdentity, workout.externalId);
  const existing = db.prepare("SELECT id,source_payload,deleted_at,source_updated_at,source_run_version FROM health_workouts WHERE source='hevy' AND source_account_identity=? AND source_external_id=?").get(accountIdentity, workout.externalId) as any;
  if (!sourceOrderAllows(existing, sourceUpdatedAt, runVersion)) return 0;
  if (existing) {
    db.prepare(`UPDATE health_workouts SET title=?,description=?,started_at=?,ended_at=?,duration_seconds=?,source_payload=?,source_updated_at=?,source_run_version=?,deleted_at=NULL,updated_at=? WHERE id=?`)
      .run(workout.title, workout.description, workout.startedAt, workout.endedAt, workout.durationSeconds, payload, sourceUpdatedAt, runVersion, ts, existing.id);
  } else {
    db.prepare(`INSERT INTO health_workouts (idempotency_key,source,external_id,source_account_identity,source_external_id,title,description,started_at,ended_at,duration_seconds,energy_estimated,source_payload,source_updated_at,source_run_version,deleted_at,created_at,updated_at)
      VALUES (?,'hevy',?,?,?,?,?,?,?,?,1,?,?,?,NULL,?,?)`)
      .run(`hevy:workout:${storedExternalId}`, storedExternalId, accountIdentity, workout.externalId, workout.title, workout.description, workout.startedAt, workout.endedAt, workout.durationSeconds, payload, sourceUpdatedAt, runVersion, ts, ts);
  }
  const row = db.prepare("SELECT id FROM health_workouts WHERE source='hevy' AND source_account_identity=? AND source_external_id=?").get(accountIdentity, workout.externalId) as any;
  db.prepare("DELETE FROM health_workout_exercises WHERE workout_id=?").run(row.id);
  for (const exercise of workout.exercises) {
    const inserted = db.prepare("INSERT INTO health_workout_exercises (workout_id,external_id,exercise_template_id,title,exercise_order,notes,source_payload) VALUES (?,?,?,?,?,?,?)").run(row.id, exercise.externalId, exercise.templateId, exercise.title, exercise.order, exercise.notes, JSON.stringify(exercise.raw));
    const exerciseId = Number(inserted.lastInsertRowid);
    for (const set of exercise.sets) db.prepare("INSERT INTO health_workout_sets (exercise_id,external_id,set_order,set_type,weight_kg,reps,duration_seconds,distance_meters,rpe,rir,completed,source_payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(exerciseId, set.externalId, set.order, set.type, set.weightKg, set.reps, set.durationSeconds, set.distanceMeters, set.rpe, set.rir, set.completed == null ? null : set.completed ? 1 : 0, JSON.stringify(set.raw));
  }
  return !existing || existing.source_payload !== payload || existing.deleted_at ? 1 : 0;
}

function applyWorkoutDelete(db: Database.Database, accountIdentity: string, externalId: string, sourceUpdatedAt = nowIso(), runVersion = 0) {
  const existing = db.prepare("SELECT id,deleted_at,source_updated_at,source_run_version FROM health_workouts WHERE source='hevy' AND source_account_identity=? AND source_external_id=?").get(accountIdentity, externalId) as any;
  if (!existing || existing.deleted_at || !sourceOrderAllows(existing, sourceUpdatedAt, runVersion)) return 0;
  const ts = nowIso();
  return db.prepare("UPDATE health_workouts SET deleted_at=?,source_updated_at=?,source_run_version=?,updated_at=? WHERE id=?").run(ts, sourceUpdatedAt, runVersion, ts, existing.id).changes ? 1 : 0;
}
function applyMeasurement(db: Database.Database, accountIdentity: string, value: HevyMeasurement, runVersion = 0) {
  const storedExternalId = storageIdentity("measurement", accountIdentity, value.externalId);
  const previous = db.prepare("SELECT id,source_payload,deleted_at,source_updated_at,source_run_version FROM health_body_measurements WHERE source='hevy' AND source_account_identity=? AND source_external_id=?").get(accountIdentity, value.externalId) as any;
  if (!sourceOrderAllows(previous, value.updatedAt, runVersion)) return 0;
  const payload = JSON.stringify(value.raw), ts = nowIso();
  if (previous) {
    db.prepare(`UPDATE health_body_measurements SET measured_at=?,weight_kg=?,body_fat_pct=?,lean_mass_kg=?,waist_cm=?,source_payload=?,source_updated_at=?,source_run_version=?,deleted_at=NULL,updated_at=?,observation_at_known=1 WHERE id=?`)
      .run(value.measuredAt, value.weightKg, value.bodyFatPct, value.leanMassKg, value.waistCm, payload, value.updatedAt, runVersion, ts, previous.id);
  } else {
    db.prepare(`INSERT INTO health_body_measurements (idempotency_key,measured_at,weight_kg,body_fat_pct,lean_mass_kg,waist_cm,context,estimated,source,external_id,source_account_identity,source_external_id,source_payload,source_updated_at,source_run_version,deleted_at,created_at,updated_at,observation_at_known)
      VALUES (?,?,?,?,?,?,'Hevy import',0,'hevy',?,?,?,?,?,?,NULL,?,?,1)`)
      .run(`hevy:measurement:${storedExternalId}`, value.measuredAt, value.weightKg, value.bodyFatPct, value.leanMassKg, value.waistCm, storedExternalId, accountIdentity, value.externalId, payload, value.updatedAt, runVersion, ts, ts);
  }
  return !previous || previous.source_payload !== payload || previous.deleted_at ? 1 : 0;
}

function currentHevyIdentity(db: Database.Database): string {
  const identity = (db.prepare("SELECT account_identity FROM health_sync_state WHERE source='hevy'").get() as any)?.account_identity;
  if (!identity) throw new HevySyncError("HEVY_SESSION_CHANGED");
  return identity;
}
export function upsertHevyWorkout(workout: HevyWorkout) { const db = getDb(); return db.transaction(() => applyWorkout(db, currentHevyIdentity(db), workout)).immediate(); }
export function deleteHevyWorkout(externalId: string) { const db = getDb(); return db.transaction(() => applyWorkoutDelete(db, currentHevyIdentity(db), externalId) > 0).immediate(); }
export function upsertHevyMeasurement(raw: any) { const db = getDb(), measurement = normalizeMeasurement(raw); return db.transaction(() => applyMeasurement(db, currentHevyIdentity(db), measurement)).immediate(); }

function reconcileWorkouts(db: Database.Database, accountIdentity: string, seen: Set<string>, boundary: string, runVersion: number) { let changed = 0; const rows = db.prepare("SELECT source_external_id FROM health_workouts WHERE source='hevy' AND source_account_identity=? AND deleted_at IS NULL").all(accountIdentity) as any[]; for (const row of rows) if (!seen.has(row.source_external_id)) changed += applyWorkoutDelete(db, accountIdentity, row.source_external_id, boundary, runVersion); return changed; }
function reconcileMeasurements(db: Database.Database, accountIdentity: string, seen: Set<string>, boundary: string, runVersion: number) { let changed=0;const rows=db.prepare("SELECT id,source_external_id,deleted_at,source_updated_at,source_run_version FROM health_body_measurements WHERE source='hevy' AND source_account_identity=? AND deleted_at IS NULL").all(accountIdentity) as any[];for(const row of rows){if(seen.has(row.source_external_id)||!sourceOrderAllows(row,boundary,runVersion))continue;const ts=nowIso();changed+=db.prepare("UPDATE health_body_measurements SET deleted_at=?,source_updated_at=?,source_run_version=?,updated_at=? WHERE id=? AND source_account_identity=? AND deleted_at IS NULL").run(ts,boundary,runVersion,ts,row.id,accountIdentity).changes}return changed; }
function overlapCursor(cursor: string) { const ms = Date.parse(cursor); return Number.isFinite(ms) ? new Date(ms - OVERLAP_MS).toISOString() : null; }

async function stageFull(client: HevyClient) {
  const workouts = (await fetchPaginated(client, "/workouts", "workouts")).map(normalizeWorkout);
  const measurements = (await fetchPaginated(client, "/body_measurements", "body_measurements")).map(normalizeMeasurement);
  return { mutations: workouts.map((workout): WorkoutMutation => ({ type: "upsert", workout, sourceUpdatedAt: workout.updatedAt })), measurements, reconcileAll: true, seen: workouts.length + measurements.length };
}

async function stageIncremental(client: HevyClient, cursor: string, boundary: string) {
  const since = overlapCursor(cursor);
  if (!since) return stageFull(client);
  const newestFirst = await fetchPaginated(client, `/workouts/events?since=${encodeURIComponent(since)}`, "events");
  const mutations = [...newestFirst].reverse().map((event: any): WorkoutMutation => {
    if (!event || typeof event !== "object" || Array.isArray(event)) schema("workout event must be an object");
    if (event.type === "updated") { const workout=normalizeWorkout(event.workout);return { type: "upsert", workout, sourceUpdatedAt: iso(event.updated_at) ?? workout.updatedAt }; }
    if (event.type === "deleted" && text(event.id)) return { type: "delete", externalId: text(event.id), sourceUpdatedAt: iso(event.deleted_at) ?? iso(event.updated_at) ?? boundary };
    schema("workout event must be an updated workout or deleted id");
  });
  const measurements = (await fetchPaginated(client, "/body_measurements", "body_measurements")).map(normalizeMeasurement);
  return { mutations, measurements, reconcileAll: false, seen: newestFirst.length + measurements.length };
}

function prepareAccount(account: HevyAccount) {
  const db = getDb(); let generation = 0;
  db.transaction(() => {
    const state = ensureSourceState(db, "hevy");
    if (state.accountIdentity !== account.identity) {
      if (state.accountIdentity) quarantineImportedRows(db, "hevy");
      db.prepare(`UPDATE health_sync_state SET account_identity=?,generation=generation+1,cursor=NULL,last_success_at=NULL,last_error=NULL,records_seen=0,records_changed=0,updated_at=? WHERE source='hevy'`).run(account.identity, nowIso());
    }
    generation = Number((db.prepare("SELECT generation FROM health_sync_state WHERE source='hevy'").get() as any).generation);
  }).immediate();
  return generation;
}

function sourceEnabled(db: Database.Database) { return (db.prepare("SELECT enabled FROM connections WHERE service='hevy' AND surface='dashboard'").get() as any)?.enabled === 1; }

export async function syncHevy(options: { request?: Requester; forceFull?: boolean; baseUrl?: string; timeoutMs?: number; syncDeadlineMs?: number; leaseTtlMs?: number; now?: () => string } = {}) {
  if (!isConnectionEnabled("hevy")) return { status: "disconnected" as const, detail: "Hevy is disabled in Connections", seen: 0, changed: 0 };
  const apiKey = secret("HEVY_API_KEY");
  if (!apiKey) return { status: "disconnected" as const, detail: "HEVY_API_KEY is not configured", seen: 0, changed: 0 };
  const clock = options.now ?? nowIso, boundary = clock(), attempt = boundary, keyIdentity = credentialIdentity(apiKey);
  const leaseDb = getDb();
  const lease = acquireSourceLease(leaseDb, "hevy", { now: boundary, ttlMs: options.leaseTtlMs });
  if (!lease) return { status: "degraded" as const, detail: "Hevy sync already in progress", seen: 0, changed: 0 };
  const client = new HevyClient(apiKey, options.request, options.baseUrl, options.timeoutMs, options.syncDeadlineMs);
  let account: HevyAccount | null = null, generation: number | null = null;
  try {
    account = await client.userInfo();
    generation = prepareAccount(account);
    const state = get<any>("SELECT cursor FROM health_sync_state WHERE source='hevy'");
    const staged = !options.forceFull && state?.cursor ? await stageIncremental(client, state.cursor, boundary) : await stageFull(client);
    client.assertWithinDeadline();
    const db = getDb(); let changed = 0;
    db.transaction(() => {
      const currentKey = secret("HEVY_API_KEY");
      if (!currentKey || credentialIdentity(currentKey) !== keyIdentity || !sourceLeaseStillCurrent(db, "hevy", lease, clock()) || !sourceCommitStillCurrent(db, "hevy", generation!, account!.identity, sourceEnabled(db))) throw new HevySyncError("HEVY_SESSION_CHANGED");
      for (const mutation of staged.mutations) changed += mutation.type === "delete" ? applyWorkoutDelete(db, account!.identity, mutation.externalId, mutation.sourceUpdatedAt, lease.runVersion) : applyWorkout(db, account!.identity, mutation.workout, mutation.sourceUpdatedAt, lease.runVersion);
      for (const measurement of staged.measurements) changed += applyMeasurement(db, account!.identity, measurement, lease.runVersion);
      if (staged.reconcileAll) changed += reconcileWorkouts(db, account!.identity, new Set(staged.mutations.filter((item): item is Extract<WorkoutMutation, { type: "upsert" }> => item.type === "upsert").map((item) => item.workout.externalId)), boundary, lease.runVersion);
      changed += reconcileMeasurements(db, account!.identity, new Set(staged.measurements.map((item) => item.externalId)), boundary, lease.runVersion);
      const success = clock();
      db.prepare(`UPDATE health_sync_state SET
        cursor=CASE WHEN cursor IS NULL OR cursor<=? THEN ? ELSE cursor END,
        last_attempt_at=CASE WHEN last_attempt_at IS NULL OR last_attempt_at<=? THEN ? ELSE last_attempt_at END,
        last_success_at=CASE WHEN last_success_at IS NULL OR last_success_at<=? THEN ? ELSE last_success_at END,
        last_error=NULL,records_seen=?,records_changed=?,updated_at=CASE WHEN updated_at<=? THEN ? ELSE updated_at END
        WHERE source='hevy' AND lease_token=? AND run_version=?`)
        .run(boundary,boundary,attempt,attempt,success,success,staged.seen,changed,success,success,lease.token,lease.runVersion);
    }).immediate();
    const committed = get<any>("SELECT cursor,last_success_at lastSuccessAt FROM health_sync_state WHERE source='hevy'");
    return { status: "healthy" as const, detail: "Hevy sync complete", seen: staged.seen, changed, cursor: committed?.cursor ?? boundary, lastSuccessAt: committed?.lastSuccessAt ?? null };
  } catch (error) {
    const code = sanitizeHevyError(error) ?? "HEVY_SYNC_FAILED";
    const db = getDb(), currentKey = secret("HEVY_API_KEY");
    if (currentKey && credentialIdentity(currentKey) === keyIdentity && sourceEnabled(db) && sourceLeaseStillCurrent(db,"hevy",lease,clock())) {
      if (account && generation != null) db.prepare("UPDATE health_sync_state SET last_attempt_at=CASE WHEN last_attempt_at IS NULL OR last_attempt_at<=? THEN ? ELSE last_attempt_at END,last_error=?,updated_at=CASE WHEN updated_at<=? THEN ? ELSE updated_at END WHERE source='hevy' AND account_identity=? AND generation=? AND lease_token=? AND run_version=?").run(attempt,attempt,code,attempt,attempt,account.identity,generation,lease.token,lease.runVersion);
      else db.prepare("UPDATE health_sync_state SET last_attempt_at=CASE WHEN last_attempt_at IS NULL OR last_attempt_at<=? THEN ? ELSE last_attempt_at END,last_error=?,updated_at=CASE WHEN updated_at<=? THEN ? ELSE updated_at END WHERE source='hevy' AND lease_token=? AND run_version=?").run(attempt,attempt,code,attempt,attempt,lease.token,lease.runVersion);
    }
    return { status: "broken" as const, detail: hevyConnectionDetail(code)!, errorCode: code, seen: 0, changed: 0 };
  } finally {
    releaseSourceLease(getDb(), "hevy", lease);
  }
}

type CachedHealthCheck = { checkedAt: number; result: { ok: boolean; detail: string; errorCode?: string } };
const hevyGlobal = globalThis as any;
function healthCheckCache(): Map<string, CachedHealthCheck> {
  if (!hevyGlobal.__rw_hevy_health_checks) hevyGlobal.__rw_hevy_health_checks = new Map();
  return hevyGlobal.__rw_hevy_health_checks;
}
export function invalidateHealthCheckCache() { healthCheckCache().clear(); }

export async function healthCheck(options: { request?: Requester; baseUrl?: string; timeoutMs?: number; force?: boolean; nowMs?: number } = {}) {
  if (!isConnectionEnabled("hevy")) return { ok: false, detail: "disabled by user" };
  const apiKey = secret("HEVY_API_KEY"); if (!apiKey) return { ok: false, detail: "HEVY_API_KEY not configured" };
  const now = options.nowMs ?? Date.now();
  const cacheKey = `${credentialIdentity(apiKey)}:${options.baseUrl ?? API}`;
  const cached = healthCheckCache().get(cacheKey);
  if (!options.force && cached && now - cached.checkedAt < HEALTH_CHECK_TTL_MS) return cached.result;
  let result: CachedHealthCheck["result"];
  try { await new HevyClient(apiKey, options.request, options.baseUrl, options.timeoutMs).userInfo(); result = { ok: true, detail: "official Hevy API verified" }; }
  catch (error) { const code=sanitizeHevyError(error)??"HEVY_SYNC_FAILED";result = { ok: false, detail: hevyConnectionDetail(code)!, errorCode:code }; }
  healthCheckCache().set(cacheKey, { checkedAt: now, result });
  return result;
}

export function configured() { return hasSecret("HEVY_API_KEY"); }