// Internal server-only helpers. Callers own an IMMEDIATE transaction around each operation.
import { getDb, nowIso } from "@/db";
import { entityTable, logChange, logCreate, newBatchId, type AuditMeta } from "@/lib/stern/audit";
import type { AuditEntityType } from "@/lib/stern-types";
import { SternError } from "@/lib/stern/errors";
export type Row = Record<string, string | number>;
export type ChangeMeta = Partial<AuditMeta>;
export function meta(input: ChangeMeta = {}): AuditMeta { return { ...input, source: input.source || "manual", batchId: input.batchId || newBatchId("recruiting") }; }
export function id(value: unknown, label = "id"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new SternError(400, `${label} must be a positive integer`);
  return value;
}
export function row<T>(entity: AuditEntityType, value: number): T {
  const found = getDb().prepare(`SELECT * FROM ${entityTable(entity)} WHERE id = ?`).get(id(value));
  if (!found) throw new SternError(404, `${entity} not found`);
  return found as T;
}
export function insert(entity: AuditEntityType, fields: Row, audit: AuditMeta): number {
  const keys = Object.keys(fields);
  const result = getDb().prepare(`INSERT INTO ${entityTable(entity)} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(fields));
  const value = Number(result.lastInsertRowid);
  logCreate(entity, value, row(entity, value), audit);
  return value;
}
export function patch(entity: AuditEntityType, value: number, fields: Row, audit: AuditMeta): void {
  const previous = row<Row>(entity, value);
  const changed = Object.entries(fields).filter(([key, next]) => previous[key] !== next);
  if (!changed.length) return;
  if ("updated_at" in previous && !changed.some(([key]) => key === "updated_at")) changed.push(["updated_at", nowIso()]);
  for (const [field, after] of changed) {
    // logChange validates the column name before it reaches UPDATE.
    logChange({ ...audit, entityType: entity, entityId: value, action: "update", field, before: previous[field], after });
    getDb().prepare(`UPDATE ${entityTable(entity)} SET ${field} = ? WHERE id = ?`).run(after, value);
  }
}
export function textFields(input: Record<string, unknown>, allowed: readonly string[]): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new SternError(400, `unknown field: ${key}`);
    if (typeof value !== "string" || value.length > 30000) throw new SternError(400, `${key} must be text (up to 30000 characters)`);
    out[key] = value.trim();
  }
  return out;
}
export function httpUrl(value: string): void {
  if (!value) return;
  try { const url = new URL(value); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return; } catch {}
  throw new SternError(400, "Links must be http or https URLs");
}
