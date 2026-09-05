// Server-only, audited writes shared by WP4 domains. Call inside write().
import { getDb, nowIso } from '@/db';
import { entityTable, logChange, logCreate, logDelete, newBatchId, type AuditMeta } from './audit';
import { SternError } from './errors';
import type { AuditEntityType } from '@/lib/stern-types';
export type Input = Record<string, unknown>;
export type Values = Record<string, string | number | null>;
export function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SternError(400, 'Expected an object');
  return value as Input;
}
export function text(value: unknown, name: string, required = false): string {
  if (typeof value !== 'string' || (required && !value.trim())) throw new SternError(400, `${name} must be ${required ? 'non-empty ' : ''}text`);
  return value.trim();
}
export function number(value: unknown, name: string, min = 0, max = Infinity, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new SternError(400, `Invalid ${name}`);
  return value;
}
export function choice(value: unknown, choices: readonly string[], name: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new SternError(400, `Invalid ${name}`);
  return value;
}
export function meta(m?: AuditMeta): AuditMeta { return m ?? { source: 'manual', batchId: newBatchId('manual') }; }
export function write<T>(fn: () => T): T {
  try { return getDb().transaction(fn).immediate(); }
  catch (e) { if (e instanceof Error && /UNIQUE constraint/.test(e.message)) throw new SternError(409, 'A matching record already exists'); throw e; }
}
export function row<T>(entity: AuditEntityType, id: number): T {
  number(id, 'id', 1, Infinity, true);
  const result = getDb().prepare(`SELECT * FROM ${entityTable(entity)} WHERE id=?`).get(id);
  if (!result) throw new SternError(404, `${entity} not found`);
  return result as T;
}
export function insert<T>(entity: AuditEntityType, values: Values, m: AuditMeta): T {
  const keys = Object.keys(values);
  const id = Number(getDb().prepare(`INSERT INTO ${entityTable(entity)} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
  const result = row<T>(entity, id); logCreate(entity, id, result, m); return result;
}
export function patch<T>(entity: AuditEntityType, id: number, values: Values, m: AuditMeta): T {
  const before = row<Values>(entity, id);
  const changed = Object.entries(values).filter(([key, value]) => before[key] !== value);
  if (!changed.length) return before as T;
  if ('updated_at' in before) changed.push(['updated_at', nowIso()]);
  for (const [field, after] of changed) {
    getDb().prepare(`UPDATE ${entityTable(entity)} SET ${field}=? WHERE id=?`).run(after, id);
    logChange({ ...m, entityType: entity, entityId: id, action: 'update', field, before: before[field], after });
  }
  return row<T>(entity, id);
}
export function remove(entity: AuditEntityType, id: number, m: AuditMeta) {
  const before = row(entity, id);
  getDb().prepare(`DELETE FROM ${entityTable(entity)} WHERE id=?`).run(id);
  logDelete(entity, id, before, m);
}
