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
import { STERN_NOTIFICATION_KEYS, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_SOURCES, type AuditAction, type AuditEntityType, type AuditSource } from "@/lib/stern-types";
import { SternError } from "@/lib/stern/errors";

export const ENTITY_TABLES: Record<AuditEntityType, string> = {
  email_message: "stern_email_messages",
  reminder: "stern_reminders",
  notification_setting: "kv",
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
  if (entityType === "notification_setting") {
    if (!(STERN_NOTIFICATION_KEYS as readonly string[]).includes(field)) throw new SternError(400, "Unknown notification setting");
    return;
  }
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
  if (entityType === "notification_setting" && action !== "update") throw new SternError(400, "Notification settings require field updates");
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
  const personIds = new Set<number>();
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
    const checkedReminderIds = new Set<number>();
    for (const row of rows) {
      const table = entityTable(row.entity_type);
      if (row.entity_type === "person") personIds.add(row.entity_id);
      if (row.entity_type === "touchpoint") {
        const current = db.prepare("SELECT person_id FROM people_touchpoints WHERE id=?").get(row.entity_id) as { person_id: number } | undefined;
        if (current) personIds.add(current.person_id);
        if (row.field === "person_id") { personIds.add(Number(row.before_value)); personIds.add(Number(row.after_value)); }
        for (const value of [row.before_value, row.after_value]) {
          try { const prior = JSON.parse(value); if (prior?.person_id) personIds.add(Number(prior.person_id)); } catch { /* scalar field, not a snapshot */ }
        }
      }
      if (row.entity_type === "reminder") {
        const current = db.prepare("SELECT * FROM stern_reminders WHERE id=?").get(row.entity_id) as Record<string, unknown> | undefined;
        if (!checkedReminderIds.has(row.entity_id) && current?.error === "delivery-in-progress") {
          const claim = db.prepare("SELECT created_at FROM stern_audit_log WHERE entity_type='reminder' AND entity_id=? AND field='error' AND after_value='delivery-in-progress' ORDER BY id DESC LIMIT 1").get(row.entity_id) as { created_at: string } | undefined;
          // All transport calls together are bounded below two minutes. A stale claim can be
          // undone explicitly after reviewing provider delivery; it is never retried automatically.
          if (!claim || Date.now() - Date.parse(claim.created_at) < 120_000) throw new SternError(409, "Delivery is in progress; wait two minutes and review its outcome before undo");
        }
        checkedReminderIds.add(row.entity_id);
        if (row.action === "create" && current) {
          const created = JSON.parse(row.after_value || "{}") as Record<string, unknown>;
          if (Object.entries(created).some(([key, value]) => current[key] !== value)) throw new SternError(409, "Reminder has later changes; undo the newer batches first");
        }
      }
      let changes = 0;
      if (row.entity_type === "notification_setting") {
        assertField(row.entity_type, row.field);
        if (row.action !== "update") throw new SternError(400, "Settings support update undo only");
        if (row.before_value === "") changes = db.prepare("DELETE FROM kv WHERE k=? AND v=?").run(row.field, row.after_value).changes;
        else changes = db.prepare("UPDATE kv SET v=?, updated_at=? WHERE k=? AND v=?").run(row.before_value, ts, row.field, row.after_value).changes;
      } else if (row.action === "update") {
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
        // Recruiting links in 0029 deliberately use sentinel IDs rather than foreign keys.
        // They must be protected too: SQLite cannot detect these would-be orphans.
        if (row.entity_type === "program" || row.entity_type === "club") {
          const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.entity_id) as Record<string, unknown> | undefined;
          const created = JSON.parse(row.after_value || "{}") as Record<string, unknown>;
          if (current && Object.entries(created).some(([key, value]) => key !== "updated_at" && current[key] !== value)) {
            throw new SternError(409, `${row.entity_type} ${row.entity_id} has later edits; undo the newer batches first`);
          }
          const key = row.entity_type === "program" ? "program_id" : "club_id";
          if (db.prepare(`SELECT 1 FROM coffee_chats WHERE ${key} = ? LIMIT 1`).get(row.entity_id)) {
            throw new SternError(409, `${row.entity_type} ${row.entity_id} has linked coffee chats; undo the newer batches first`);
          }
        }
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
    // Keep the ingestion identity to suppress reapplication after undo.
    db.prepare(`UPDATE stern_email_messages SET applied='ignored' WHERE EXISTS (
      SELECT 1 FROM stern_audit_log a WHERE a.batch_id=? AND a.gmail_account=stern_email_messages.gmail_account
      AND a.gmail_message_id=stern_email_messages.gmail_message_id)`).run(batchId);
    // Contact dates are derived, including when an older batch is undone out of order.
    // Keep this inside the same lock so another writer cannot race the recomputation.
    for (const id of personIds) {
      const p = db.prepare("SELECT last_contact_at FROM people WHERE id=?").get(id) as { last_contact_at: string } | undefined;
      if (!p) continue;
      const latest = db.prepare("SELECT occurred_at FROM people_touchpoints WHERE person_id=? ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 1").get(id) as { occurred_at: string } | undefined;
      const contact = latest?.occurred_at || "";
      if (contact !== p.last_contact_at) {
        db.prepare("UPDATE people SET last_contact_at=? WHERE id=?").run(contact, id);
        logChange({ entityType: "person", entityId: id, action: "undo", field: "last_contact_at", before: p.last_contact_at, after: contact, source, batchId });
      }
    }
    return { batchId, reverted, skipped };
  });
  const result = tx.immediate();
  // The database transaction is committed before reflecting restored people in the vault.
  for (const id of personIds) {
    try {
      const person = db.prepare("SELECT * FROM people WHERE id=?").get(id) as Person | undefined;
      if (person) writePersonNote(person, false, true);
      else {
        const capture = db.prepare("SELECT after_value FROM stern_audit_log WHERE batch_id=? AND entity_type='person' AND entity_id=? AND action='create' ORDER BY id DESC LIMIT 1").get(batchId, id) as { after_value: string } | undefined;
        if (capture) {
          const prior = JSON.parse(capture.after_value) as Person;
          if (prior.display_name !== undefined) writePersonNote({ ...prior, id }, true);
        }
      }
    } catch { console.error("[stern] vault sync failed"); }
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
