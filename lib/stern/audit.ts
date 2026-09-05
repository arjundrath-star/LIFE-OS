// Stern audit log: every automated or manual change writes one row per field so the
// Automation page can show before -> after with evidence, and undoBatch() can revert a
// whole message's worth of changes at once. Server-only (imports @/db).
//
// Rules: entity tables are enumerated explicitly (never trust a caller's table name);
// field names are validated against PRAGMA table_info before they reach SQL; undo runs
// in one IMMEDIATE transaction so a second process (stern-cli) cannot interleave.
import crypto from "node:crypto";
import { writePersonNote } from "./people-note";
import type { Person } from "@/lib/stern-types";
import { getDb, nowIso } from "@/db";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_SOURCES, type AuditAction, type AuditEntityType, type AuditSource } from "@/lib/stern-types";
import { SternError } from "@/lib/stern/errors";

export const ENTITY_TABLES: Record<AuditEntityType, string> = {
  process: "stern_processes",
  interview_prep: "stern_interview_prep",
  person: "people",
  affiliation: "people_affiliations",
  touchpoint: "people_touchpoints",
  coffee_chat: "coffee_chats",
  program: "stern_programs",
  club: "stern_clubs",
  checklist_item: "stern_checklist_items",
  assignment: "assignments",
  task: "stern_tasks",
  calendar_event: "stern_calendar_events",
  draft: "stern_drafts",
  course: "courses",
  course_meeting: "course_meetings",
  grade_category: "grade_categories",
  suggestion: "stern_suggestions",
};

const ENTITY_SET = new Set<string>(AUDIT_ENTITY_TYPES);
const ACTION_SET = new Set<string>(AUDIT_ACTIONS);
const SOURCE_SET = new Set<string>(AUDIT_SOURCES);

export type AuditRow = {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  field: string;
  before_value: string;
  after_value: string;
  source: string;
  confidence: number;
  evidence_type: string;
  gmail_account: string;
  gmail_message_id: string;
  evidence_excerpt: string;
  batch_id: string;
  undone_at: string;
  undo_of: number;
  created_at: string;
};

export type LogChangeInput = {
  entityType: AuditEntityType | string;
  entityId: number;
  action: AuditAction | string;
  field?: string;
  before?: unknown;
  after?: unknown;
  source?: AuditSource | string;
  confidence?: number;
  evidenceType?: string;
  gmailAccount?: string;
  gmailMessageId?: string;
  evidenceExcerpt?: string;
  batchId: string;
};

export type AuditMeta = Omit<LogChangeInput, "entityType" | "entityId" | "action" | "field" | "before" | "after">;

/** Server-generated batch id. Clients never choose these; they can only reference them. */
export function newBatchId(prefix = "batch"): string {
  const safe = String(prefix).replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "batch";
  return `${safe}:${crypto.randomUUID()}`;
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// Column lists per table, read once from SQLite so field names can never be injected.
// Only the enumerated entity tables may be inspected (the name is interpolated into PRAGMA).
const TABLE_SET = new Set<string>(Object.values(ENTITY_TABLES));
const columnCache = new Map<string, Map<string, { notnull: boolean }>>();
export function tableColumnInfo(table: string): Map<string, { notnull: boolean }> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  if (!TABLE_SET.has(table)) throw new SternError(400, `unknown audit table: ${table}`);
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
  const map = new Map(rows.map((r) => [r.name, { notnull: !!r.notnull }]));
  columnCache.set(table, map);
  return map;
}
export function tableColumns(table: string): Set<string> {
  return new Set(tableColumnInfo(table).keys());
}

export function entityTable(entityType: string): string {
  if (!ENTITY_SET.has(entityType)) throw new SternError(400, `unknown audit entity type: ${entityType}`);
  return ENTITY_TABLES[entityType as AuditEntityType];
}

function assertField(entityType: string, field: string) {
  if (!field) return;
  const table = entityTable(entityType);
  if (field === "id" || !/^[a-z_][a-z0-9_]*$/.test(field) || !tableColumns(table).has(field)) {
    throw new SternError(400, `unknown field ${field} for ${entityType}`);
  }
}

/** Insert one audit row. Throws SternError 400 on any invalid enum or field. */
export function logChange(input: LogChangeInput): number {
  const entityType = String(input.entityType || "");
  const action = String(input.action || "");
  const source = String(input.source || "manual");
  if (!ENTITY_SET.has(entityType)) throw new SternError(400, `unknown audit entity type: ${entityType}`);
  if (!ACTION_SET.has(action)) throw new SternError(400, `unknown audit action: ${action}`);
  if (!SOURCE_SET.has(source)) throw new SternError(400, `unknown audit source: ${source}`);
  if (!Number.isInteger(input.entityId) || input.entityId < 0) throw new SternError(400, "audit entity id must be a non-negative integer");
  if (!input.batchId || typeof input.batchId !== "string") throw new SternError(400, "audit batchId is required");
  const field = input.field ? String(input.field) : "";
  if (action === "update") assertField(entityType, field);
  const confidence = Number.isFinite(input.confidence) ? Number(input.confidence) : 0;
  const result = getDb()
    .prepare(
      `INSERT INTO stern_audit_log
         (entity_type, entity_id, action, field, before_value, after_value, source, confidence,
          evidence_type, gmail_account, gmail_message_id, evidence_excerpt, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entityType,
      input.entityId,
      action,
      field,
      serialize(input.before),
      serialize(input.after),
      source,
      confidence,
      String(input.evidenceType || ""),
      String(input.gmailAccount || ""),
      String(input.gmailMessageId || ""),
      String(input.evidenceExcerpt || "").slice(0, 300),
      input.batchId
    );
  return Number(result.lastInsertRowid);
}

/** One 'create' row whose after_value is the JSON snapshot of the new entity. */
export function logCreate(entityType: AuditEntityType | string, entityId: number, rowSnapshot: unknown, meta: AuditMeta): number {
  return logChange({ ...meta, entityType, entityId, action: "create", field: "", before: "", after: rowSnapshot ?? {} });
}

/** One 'delete' row whose before_value is the JSON snapshot of the removed entity (so undo can re-insert). */
export function logDelete(entityType: AuditEntityType | string, entityId: number, rowSnapshot: unknown, meta: AuditMeta): number {
  return logChange({ ...meta, entityType, entityId, action: "delete", field: "", before: rowSnapshot ?? {}, after: "" });
}

export type UndoResult = { batchId: string; reverted: number; skipped: number };

/**
 * Revert every not-yet-undone row in a batch, newest first, inside one IMMEDIATE transaction.
 * update -> restore before_value; create -> delete the entity; delete -> re-insert from before_value.
 * Each reverted row is stamped undone_at and mirrored by an 'undo' row (undo_of = original id).
 */
export function undoBatch(batchId: string, options: { source?: AuditSource | string } = {}): UndoResult {
  if (!batchId || typeof batchId !== "string") throw new SternError(400, "batchId is required");
  const source = String(options.source || "undo");
  if (!SOURCE_SET.has(source)) throw new SternError(400, `unknown audit source: ${source}`);
  const db = getDb();
  const tx = db.transaction((): UndoResult => {
    const rows = db
      .prepare("SELECT * FROM stern_audit_log WHERE batch_id = ? AND undone_at = '' AND action <> 'undo' ORDER BY id DESC")
      .all(batchId) as AuditRow[];
    if (!rows.length) throw new SternError(404, "nothing to undo for this batch");
    // Catalog seeds (club, process, course rows) are re-runnable loads, never user changes; undoing
    // one would drop whole tables. Row-level seeds such as the legacy todo import stay undoable.
    const CATALOG_SEED_TYPES = new Set(["club", "process", "course"]);
    if (rows.some((r) => r.source === "seed" && r.action === "create" && CATALOG_SEED_TYPES.has(r.entity_type))) {
      throw new SternError(400, "catalog seed batches are not undoable; re-run the seed instead");
    }
    let reverted = 0;
    let skipped = 0;
    const ts = nowIso();
    const totalChanges = () => Number((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
    for (const row of rows) {
      const table = entityTable(row.entity_type);
      let changes = 0;
      if (row.action === "update") {
        assertField(row.entity_type, row.field);
        if (row.field) {
          // Restore only when the row still holds the value this batch wrote; a later change
          // by another batch wins and this row is reported as skipped (not stamped undone).
          const info = tableColumnInfo(table).get(row.field);
          const restore = row.before_value === "" && info && !info.notnull ? null : row.before_value;
          const expected = row.after_value === "" && info && !info.notnull ? null : row.after_value;
          changes = db
            .prepare(`UPDATE ${table} SET ${row.field} = ? WHERE id = ? AND ${row.field} IS ?`)
            .run(restore, row.entity_id, expected).changes;
        }
      } else if (row.action === "create") {
        // Foreign keys cascade on delete. Refuse when the delete would take dependent rows
        // this batch did not create (they would vanish with no audit snapshot to restore).
        const before = totalChanges();
        changes = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.entity_id).changes;
        const cascaded = totalChanges() - before - changes;
        if (cascaded > 0) {
          throw new SternError(409, `${row.entity_type} ${row.entity_id} has ${cascaded} dependent row(s) created outside this batch; undo the newer batches first`);
        }
      } else if (row.action === "delete") {
        let snapshot: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(row.before_value || "null");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) snapshot = parsed;
        } catch {
          snapshot = null;
        }
        if (snapshot) {
          const columns = tableColumns(table);
          const keys = Object.keys(snapshot).filter((k) => columns.has(k) && /^[a-z_][a-z0-9_]*$/.test(k));
          if (keys.length) {
            const values = keys.map((k) => {
              const v = snapshot![k];
              if (v === null || v === undefined) return null;
              if (typeof v === "boolean") return v ? 1 : 0;
              return typeof v === "object" ? JSON.stringify(v) : (v as string | number);
            });
            try {
              changes = db
                .prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
                .run(...values).changes;
            } catch (e) {
              // A parent row that no longer exists makes the re-insert impossible; report it as skipped.
              if (!/FOREIGN KEY|constraint/i.test(String((e as Error).message))) throw e;
              changes = 0;
            }
          }
        }
      }
      if (changes > 0) reverted += 1;
      else {
        skipped += 1;
        continue; // leave the row eligible for a later undo; nothing was reverted
      }
      db.prepare("UPDATE stern_audit_log SET undone_at = ? WHERE id = ?").run(ts, row.id);
      db.prepare(
        `INSERT INTO stern_audit_log
           (entity_type, entity_id, action, field, before_value, after_value, source, confidence, evidence_type, batch_id, undo_of)
         VALUES (?, ?, 'undo', ?, ?, ?, ?, 0, 'manual', ?, ?)`
      ).run(row.entity_type, row.entity_id, row.field, row.after_value, row.before_value, source, batchId, row.id);
    }
    return { batchId, reverted, skipped };
  });
  const result = tx.immediate();
  // The database transaction is committed before reflecting restored people in the vault.
  const personIds = db.prepare("SELECT DISTINCT entity_id FROM stern_audit_log WHERE batch_id=? AND entity_type='person'").all(batchId) as { entity_id: number }[];
  for (const { entity_id: id } of personIds) {
    const person = db.prepare("SELECT * FROM people WHERE id=?").get(id) as Person | undefined;
    if (person) writePersonNote(person, false, true);
    else {
      const capture = db.prepare("SELECT after_value FROM stern_audit_log WHERE batch_id=? AND entity_type='person' AND entity_id=? AND action='create' ORDER BY id DESC LIMIT 1").get(batchId, id) as { after_value: string } | undefined;
      if (capture) {
        const prior = JSON.parse(capture.after_value) as Person;
        if (prior.display_name !== undefined) writePersonNote({ ...prior, id }, true);
      }
    }
  }
  return result;
}

/** Live tail of the audit log (newest N, returned oldest-first for rendering). */
export function auditTail(limit = 50): AuditRow[] {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = getDb().prepare("SELECT * FROM stern_audit_log ORDER BY id DESC LIMIT ?").all(n) as AuditRow[];
  rows.reverse();
  return rows;
}

export function auditForEntity(entityType: AuditEntityType | string, entityId: number, limit = 100): AuditRow[] {
  entityTable(String(entityType));
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = getDb()
    .prepare("SELECT * FROM stern_audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?")
    .all(String(entityType), entityId, n) as AuditRow[];
  rows.reverse();
  return rows;
}

export function batchRows(batchId: string): AuditRow[] {
  const rows = getDb().prepare("SELECT * FROM stern_audit_log WHERE batch_id = ? ORDER BY id DESC").all(batchId) as AuditRow[];
  rows.reverse();
  return rows;
}
