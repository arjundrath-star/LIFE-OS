import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb, nowIso } from "@/db";

export type SourceState = { source: string; accountIdentity: string | null; generation: number };
export type SourceLease = { token: string; runVersion: number; expiresAt: string };

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 10 * 60_000;

export function sourceIdentity(namespace: string, externalId: string | number): string {
  return crypto.createHash("sha256").update(`${namespace}\0${String(externalId)}`).digest("hex");
}

export function credentialIdentity(value: string): string {
  return sourceIdentity("credential", value);
}

export function readSourceState(source: string): SourceState {
  const row = getDb().prepare("SELECT account_identity accountIdentity,generation FROM health_sync_state WHERE source=?").get(source) as any;
  return { source, accountIdentity: row?.accountIdentity ?? null, generation: Number(row?.generation ?? 0) };
}

export function ensureSourceState(db: Database.Database, source: string): SourceState {
  db.prepare(`INSERT INTO health_sync_state (source,updated_at) VALUES (?,?) ON CONFLICT(source) DO NOTHING`).run(source, nowIso());
  const row = db.prepare("SELECT account_identity accountIdentity,generation FROM health_sync_state WHERE source=?").get(source) as any;
  return { source, accountIdentity: row?.accountIdentity ?? null, generation: Number(row?.generation ?? 0) };
}

export function bumpSourceGeneration(db: Database.Database, source: string): number {
  ensureSourceState(db, source);
  db.prepare("UPDATE health_sync_state SET generation=generation+1,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE source=?").run(nowIso(), source);
  return Number((db.prepare("SELECT generation FROM health_sync_state WHERE source=?").get(source) as any).generation);
}

export function acquireSourceLease(
  db: Database.Database,
  source: string,
  options: { now?: string; ttlMs?: number } = {}
): SourceLease | null {
  const now = options.now ?? nowIso();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid source lease clock");
  const ttlMs = Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, options.ttlMs ?? 2 * 60_000));
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const token = crypto.randomUUID();
  let runVersion = 0;
  const acquired = db.transaction(() => {
    ensureSourceState(db, source);
    const changed = db.prepare(`UPDATE health_sync_state
      SET lease_token=?,lease_expires_at=?,run_version=run_version+1,
          updated_at=CASE WHEN updated_at<=? THEN ? ELSE updated_at END
      WHERE source=? AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)`)
      .run(token, expiresAt, now, now, source, now).changes;
    if (!changed) return false;
    runVersion = Number((db.prepare("SELECT run_version FROM health_sync_state WHERE source=?").get(source) as any).run_version);
    return true;
  }).immediate();
  return acquired ? { token, runVersion, expiresAt } : null;
}

export function sourceLeaseStillCurrent(
  db: Database.Database,
  source: string,
  lease: SourceLease,
  at = nowIso()
): boolean {
  const row = db.prepare("SELECT lease_token token,lease_expires_at expiresAt,run_version runVersion FROM health_sync_state WHERE source=?").get(source) as any;
  return row?.token === lease.token && Number(row?.runVersion) === lease.runVersion && typeof row?.expiresAt === "string" && row.expiresAt > at;
}

export function releaseSourceLease(db: Database.Database, source: string, lease: SourceLease): void {
  db.prepare(`UPDATE health_sync_state SET lease_token=NULL,lease_expires_at=NULL
    WHERE source=? AND lease_token=? AND run_version=?`).run(source, lease.token, lease.runVersion);
}

export function sourceCommitStillCurrent(
  db: Database.Database,
  source: string,
  generation: number,
  accountIdentity: string,
  enabled: boolean
): boolean {
  if (!enabled) return false;
  const row = db.prepare("SELECT account_identity accountIdentity,generation FROM health_sync_state WHERE source=?").get(source) as any;
  return Number(row?.generation ?? -1) === generation && row?.accountIdentity === accountIdentity;
}

export function archiveWhoopDailyRows(
  db: Database.Database,
  accountIdentity: string,
  reason: "account_replaced" | "disconnect",
  at = nowIso()
): number {
  if (!accountIdentity) throw new Error("WHOOP archive requires an account identity");
  const rows = db.prepare("SELECT * FROM whoop_daily ORDER BY day").all() as Record<string, unknown>[];
  const insert = db.prepare(`INSERT INTO health_whoop_daily_archive
    (source,account_identity,reason,day,payload_json,archived_at) VALUES ('whoop',?,?,?,?,?)`);
  for (const row of rows) insert.run(accountIdentity, reason, String(row.day), JSON.stringify(row), at);
  return rows.length;
}

export function quarantineImportedRows(
  db: Database.Database,
  source: "hevy" | "whoop",
  at = nowIso(),
  whoopArchive?: { accountIdentity: string; reason: "account_replaced" | "disconnect" }
): void {
  db.prepare("UPDATE health_workouts SET deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE source=?").run(at, at, source);
  db.prepare("UPDATE health_body_measurements SET deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE source=?").run(at, at, source);
  if (source === "whoop") {
    if (!whoopArchive) throw new Error("WHOOP quarantine requires recoverable archive metadata");
    archiveWhoopDailyRows(db, whoopArchive.accountIdentity, whoopArchive.reason, at);
    db.prepare("DELETE FROM whoop_daily").run();
  }
}
