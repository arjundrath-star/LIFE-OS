// Server-only people domain. All mutations and audit rows share an IMMEDIATE transaction.
import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { HOW_MET, PERSON_SOURCES, PERSON_STATUSES, RELATIONSHIP_TYPES, SPHERES, TOUCHPOINT_KINDS, TOUCHPOINT_SOURCES, type Person, type PersonDetail, type Affiliation, type Touchpoint, type PeopleFilters, type NetworkSnapshot, type AuditEntityType } from "@/lib/stern-types";
import { logChange, logCreate, logDelete, newBatchId, type AuditMeta, ENTITY_TABLES } from "./audit";
import { SternError } from "./errors";
import { writePersonNote } from "./people-note";

// Defer vault writes until the outermost domain/API transaction commits.
let writeDepth = 0;
let pendingNotes = new Set<number>();
export function peopleWrite<T>(fn: () => T): T {
  const outer = writeDepth === 0;
  if (outer) pendingNotes = new Set();
  writeDepth++;
  let result: T;
  try { result = getDb().transaction(fn).immediate(); }
  catch (error) { if (outer) pendingNotes.clear(); throw error; }
  finally { writeDepth--; }
  if (outer) {
    const ids = [...pendingNotes]; pendingNotes.clear();
    for (const id of ids) {
      try { syncPersonNote(personRow(id)); } catch { console.error("[stern] vault sync failed"); }
    }
  }
  return result;
}

type Input = Record<string, unknown>;
export type WriteOptions = Partial<AuditMeta> & { overwrite?: boolean };
export const EDITABLE = ["first_name", "last_name", "display_name", "year", "major", "org", "title", "sphere", "relationship_type", "strength", "status", "how_met", "met_at", "met_event", "email", "email_alt", "phone", "instagram", "linkedin", "hometown", "dorm", "next_action", "next_action_at", "notes"] as const;
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
function bounded(v: unknown, max: number, field: string): string {
  const value = text(v);
  if (value.length > max) throw new SternError(400, `${field} is too long`);
  return value;
}
const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
export const normalizeEmail = (v: unknown): string => text(v).toLowerCase();
export function dedupeKeyFor(input: Input): string {
  return normalizeEmail(input.email) || `name:${normalize(text(input.display_name) || text(input.name) || `${text(input.first_name)} ${text(input.last_name)}`.trim())}:${normalize(text(input.org))}`;
}
function meta(options: WriteOptions = {}): AuditMeta { return { ...options, source: options.source || "manual", batchId: options.batchId || newBatchId("people") }; }
function object(input: unknown): asserts input is Input {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SternError(400, "Expected an object");
}
function enumValue(value: unknown, values: readonly string[], field: string): string {
  if (typeof value !== "string" || !values.includes(value)) throw new SternError(400, `Invalid ${field}`);
  return value;
}
function integer(value: unknown, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new SternError(400, `Invalid ${field}`);
  return n;
}
function date(value: unknown): string {
  const s = text(value);
  if (!s) return "";
  if (!Number.isFinite(Date.parse(s))) throw new SternError(400, "Invalid date");
  return new Date(s).toISOString();
}
function personRow(id: number): Person {
  integer(id, 1, Number.MAX_SAFE_INTEGER, "person id");
  const p = getDb().prepare("SELECT * FROM people WHERE id = ?").get(id) as Person | undefined;
  if (!p) throw new SternError(404, "Person not found");
  return p;
}
function row<T>(entity: AuditEntityType, id: number): T {
  const value = getDb().prepare(`SELECT * FROM ${ENTITY_TABLES[entity]} WHERE id = ?`).get(id);
  if (!value) throw new SternError(404, `${entity} not found`);
  return value as T;
}
function patchRow(entity: AuditEntityType, id: number, patch: Input, m: AuditMeta) {
  const before = row<Input>(entity, id);
  for (const [field, value] of Object.entries(patch)) {
    if (before[field] === value) continue;
    // logChange validates the field against the entity table before SQL interpolation.
    logChange({ ...m, entityType: entity, entityId: id, action: "update", field, before: before[field], after: value });
    getDb().prepare(`UPDATE ${ENTITY_TABLES[entity]} SET ${field} = ? WHERE id = ?`).run(value, id);
  }
}
function insert(entity: AuditEntityType, values: Input, m: AuditMeta): number {
  const keys = Object.keys(values);
  const result = getDb().prepare(`INSERT INTO ${ENTITY_TABLES[entity]} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(values));
  const id = Number(result.lastInsertRowid);
  logCreate(entity, id, row(entity, id), m);
  return id;
}
function remove(entity: AuditEntityType, id: number, m: AuditMeta) {
  logDelete(entity, id, row(entity, id), m);
  getDb().prepare(`DELETE FROM ${ENTITY_TABLES[entity]} WHERE id = ?`).run(id);
}
// Stable id-based slugs survive name edits and distinguish people with identical names.
export function syncPersonNote(p: Person) {
  if (writeDepth > 0) { pendingNotes.add(p.id); return; }
  try { return writePersonNote(p); } catch { console.error("[stern] vault sync failed"); }
}
function normalized(input: Input): Input {
  object(input);
  const patch: Input = {};
  for (const key of EDITABLE) {
    if (!(key in input)) continue;
    const v = input[key];
    if (key === "strength") patch[key] = integer(v, 1, 5, key);
    else {
      if (typeof v !== "string") throw new SternError(400, `${key} must be text`);
      if (v.length > (key === "notes" ? 50000 : 2000)) throw new SternError(400, `${key} is too long`);
      patch[key] = key === "notes" ? v : text(v);
    }
  }
  for (const [key, values] of Object.entries({ sphere: SPHERES, relationship_type: RELATIONSHIP_TYPES, status: PERSON_STATUSES, how_met: ["", ...HOW_MET] })) {
    if (key in patch) patch[key] = enumValue(patch[key], values, key);
  }
  for (const key of ["email", "email_alt"]) if (key in patch) {
    patch[key] = normalizeEmail(patch[key]);
    if (patch[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(patch[key]))) throw new SternError(400, "Invalid email");
  }
  for (const key of ["met_at", "next_action_at"]) if (key in patch) patch[key] = date(patch[key]);
  if ("instagram" in patch) patch.instagram = text(patch.instagram).replace(/^@/, "");
  return patch;
}
export function canSetPersonStatus(from: string, to: string): boolean {
  return PERSON_STATUSES.includes(to as Person["status"]) && (from === to || to === "need_to_reach_out" || to === "dormant" || PERSON_STATUSES.indexOf(to as Person["status"]) === PERSON_STATUSES.indexOf(from as Person["status"]) + 1);
}
function updateInside(id: number, patch: Input, m: AuditMeta): Person {
  const before = personRow(id);
  if (patch.status && !canSetPersonStatus(before.status, String(patch.status))) throw new SternError(409, `Cannot change ${before.status} to ${patch.status}`);
  const after = { ...before, ...patch };
  if (!text(after.display_name)) throw new SternError(400, "Name is required");
  const key = before.archived === 1 && before.dedupe_key.startsWith("merged:") ? before.dedupe_key : dedupeKeyFor(after);
  const duplicate = getDb().prepare("SELECT id FROM people WHERE dedupe_key = ? AND id <> ?").get(key, id);
  if (duplicate) throw new SternError(409, "A person with this identity exists; merge the records first");
  if (Object.entries(patch).some(([k, v]) => (before as unknown as Input)[k] !== v) || key !== before.dedupe_key) {
    patchRow("person", id, { ...patch, dedupe_key: key, updated_at: nowIso() }, m);
  }
  return personRow(id);
}
export function createPerson(input: Input, options: WriteOptions = {}): { person: Person; created: boolean } {
  object(input);
  const m = meta(options);
  const result = peopleWrite(() => {
    const fields = normalized({ ...input, display_name: input.display_name || input.name || `${text(input.first_name)} ${text(input.last_name)}`.trim() });
    fields.display_name = text(fields.display_name) || bounded(input.name, 2000, "name") || `${text(fields.first_name)} ${text(fields.last_name)}`.trim();
    if (!fields.display_name) throw new SternError(400, "Name is required");
    if (!fields.first_name && !fields.last_name) {
      const [first, ...last] = String(fields.display_name).split(/\s+/); fields.first_name = first; fields.last_name = last.join(" ");
    }
    const key = dedupeKeyFor(fields);
    // Enrich a prior name-only capture when its email becomes known, without joining two email identities.
    let existing = (getDb().prepare("SELECT * FROM people WHERE dedupe_key = ?").get(key)
      || (fields.email && getDb().prepare("SELECT * FROM people WHERE email_alt = ? AND archived = 0 ORDER BY id LIMIT 1").get(key))
      || (fields.email && getDb().prepare("SELECT * FROM people WHERE archived=1 AND dedupe_key LIKE 'merged:%' AND (email=? OR email_alt=?) ORDER BY id LIMIT 1").get(key, key))
      || (fields.email && getDb().prepare("SELECT * FROM people WHERE dedupe_key = ? AND email = ''").get(dedupeKeyFor({ ...fields, email: "" })))) as Person | undefined;
    // Tombstones also resolve older aliases when the survivor's alternate email is occupied.
    const seen = new Set<number>();
    while (existing && existing.dedupe_key.startsWith("merged:")) {
      if (seen.has(existing.id)) throw new SternError(409, "Invalid merge chain");
      seen.add(existing.id);
      existing = personRow(Number(existing.dedupe_key.split(":")[2]));
    }
    if (existing) {
      if (existing.archived) patchRow("person", existing.id, { archived: 0, updated_at: nowIso() }, m);
      const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => options.overwrite || ((existing as unknown as Input)[k] === "" && v !== "")));
      return { person: updateInside(existing.id, patch, m), created: false };
    }
    const source = enumValue(input.source ?? (PERSON_SOURCES.includes(m.source as Person["source"]) ? m.source : "manual"), PERSON_SOURCES, "source");
    const id = insert("person", { ...fields, dedupe_key: key, source, met_at: fields.met_at || nowIso() }, m);
    return { person: personRow(id), created: true };
  });
  syncPersonNote(result.person);
  return result;
}
export function updatePerson(id: number, input: Input, options: WriteOptions = {}): Person {
  const m = meta(options);
  const person = peopleWrite(() => updateInside(id, normalized(input), m));
  syncPersonNote(person);
  return person;
}
export function setStatus(id: number, status: unknown, options: WriteOptions = {}) { return updatePerson(id, { status }, options); }
export function setRelationship(id: number, type: unknown, strength: unknown, options: WriteOptions = {}) { return updatePerson(id, { relationship_type: type, strength }, options); }
export function upgradeToFriend(id: number, options: WriteOptions = {}) { return updatePerson(id, { relationship_type: "friend" }, options); }
export function archivePerson(id: number, options: WriteOptions = {}) {
  return peopleWrite(() => { personRow(id); patchRow("person", id, { archived: 1, updated_at: nowIso() }, meta(options)); return personRow(id); });
}
function affiliationFields(input: Input): Input {
  object(input);
  const fields: Input = {};
  if ("clubId" in input || "club_id" in input) {
    const club = integer(input.clubId ?? input.club_id, 0, Number.MAX_SAFE_INTEGER, "club id");
    fields.club_id = club;
    if (club) {
      const found = getDb().prepare("SELECT name FROM stern_clubs WHERE id = ?").get(club) as { name: string } | undefined;
      if (!found) throw new SternError(404, "Club not found");
      fields.org = found.name;
    }
  }
  if (!fields.club_id && "org" in input) fields.org = bounded(input.org, 240, "org");
  if ("role" in input) fields.role = bounded(input.role, 120, "role");
  for (const [camel, snake] of [["isEboard", "is_eboard"], ["relevantForRecruiting", "relevant_for_recruiting"]]) {
    if (camel in input || snake in input) {
      const v = input[camel] ?? input[snake];
      if (![true, false, 0, 1].includes(v as boolean)) throw new SternError(400, `Invalid ${camel}`);
      fields[snake] = v ? 1 : 0;
    }
  }
  return fields;
}
export function addAffiliation(personId: number, input: Input, options: WriteOptions = {}): Affiliation {
  return peopleWrite(() => {
    personRow(personId);
    const fields = { club_id: 0, org: "", ...affiliationFields(input) };
    if (!fields.org && !fields.club_id) throw new SternError(400, "Club or organization is required");
    const existing = getDb().prepare("SELECT * FROM people_affiliations WHERE person_id = ? AND club_id = ? AND org = ?").get(personId, fields.club_id, fields.org) as Affiliation | undefined;
    if (existing) return existing;
    return row<Affiliation>("affiliation", insert("affiliation", { person_id: personId, ...fields }, meta(options)));
  });
}
export function updateAffiliation(id: number, input: Input, options: WriteOptions = {}): Affiliation {
  return peopleWrite(() => {
    object(input);
    const before = row<Affiliation>("affiliation", id);
    const fields = affiliationFields({ ...input, clubId: input.clubId ?? input.club_id ?? before.club_id });
    const after = { ...before, ...fields };
    if (!after.club_id && !after.org) throw new SternError(400, "Club or organization is required");
    if (getDb().prepare("SELECT id FROM people_affiliations WHERE person_id=? AND club_id=? AND org=? AND id<>?").get(before.person_id, after.club_id, after.org, id)) throw new SternError(409, "Affiliation already exists");
    patchRow("affiliation", id, fields, meta(options)); return row<Affiliation>("affiliation", id);
  });
}
export function removeAffiliation(id: number, options: WriteOptions = {}) { return peopleWrite(() => remove("affiliation", id, meta(options))); }
function refreshContact(id: number, m: AuditMeta) {
  const latest = getDb().prepare("SELECT occurred_at FROM people_touchpoints WHERE person_id = ? ORDER BY julianday(occurred_at) DESC, id DESC LIMIT 1").get(id) as { occurred_at: string } | undefined;
  patchRow("person", id, { last_contact_at: latest?.occurred_at || "", updated_at: nowIso() }, m);
}
export function addTouchpoint(personId: number, kind: unknown, input: Input = {}, options: WriteOptions = {}): Touchpoint {
  return peopleWrite(() => {
    object(input); personRow(personId);
    const source = enumValue(input.source ?? "manual", TOUCHPOINT_SOURCES, "touchpoint source");
    const external = source === "gmail";
    const gmailAccount = external ? text(input.gmailAccount ?? input.gmail_account) : "";
    const gmailMessageId = external ? text(input.gmailMessageId ?? input.gmail_message_id) : "";
    const m = meta({ ...options, source: options.source || (source === "gmail" ? "auto_email" : source === "calendar" ? "auto_calendar" : source), gmailAccount, gmailMessageId });
    const fields = {
      person_id: personId, kind: enumValue(kind, TOUCHPOINT_KINDS, "touchpoint kind"), source,
      occurred_at: date(input.occurredAt ?? input.occurred_at) || nowIso(),
      gmail_account: gmailAccount,
      // The shipped UNIQUE includes blank gmail refs. Local captures need a unique reference.
      gmail_message_id: gmailMessageId || `local:${crypto.randomUUID()}`,
      summary: bounded(input.summary, 500, "summary"), detail: bounded(input.detail, 5000, "detail"),
    };
    const prior = getDb().prepare("SELECT * FROM people_touchpoints WHERE person_id = ? AND gmail_account = ? AND gmail_message_id = ? AND kind = ?").get(personId, fields.gmail_account, fields.gmail_message_id, fields.kind) as Touchpoint | undefined;
    if (prior) return prior;
    const id = insert("touchpoint", fields, m);
    refreshContact(personId, m);
    return row<Touchpoint>("touchpoint", id);
  });
}
export function mergePeople(keepId: number, dropId: number, options: WriteOptions = {}): PersonDetail {
  const m = meta(options);
  peopleWrite(() => {
    if (keepId === dropId) throw new SternError(400, "Choose two different people");
    const keep = personRow(keepId), drop = personRow(dropId);
    const blanks = Object.fromEntries(EDITABLE.filter(k => keep[k] === "" && drop[k] !== "").map(k => [k, drop[k]]));
    // Transfer a missing email/identity to the survivor, releasing the archived row's
    // unique key first. Both changes are audited so undo restores the two identities.
    if (keep.archived || drop.archived) throw new SternError(409, "Restore archived people before merging");
    patchRow("person", dropId, { dedupe_key: `merged:${dropId}:${keepId}` }, m);
    if (keep.email && !keep.email_alt && drop.email && drop.email !== keep.email) blanks.email_alt = drop.email;
    if (drop.notes && keep.notes && !keep.notes.includes(drop.notes)) blanks.notes = `${keep.notes}\n\n${drop.notes}`;
    updateInside(keepId, blanks, m);
    for (const entity of ["affiliation", "touchpoint"] as const) {
      const children = getDb().prepare(`SELECT * FROM ${ENTITY_TABLES[entity]} WHERE person_id = ? ORDER BY id`).all(dropId) as (Input & { id: number })[];
      for (const child of children) {
        const duplicate = (entity === "affiliation"
          ? getDb().prepare("SELECT * FROM people_affiliations WHERE person_id=? AND club_id=? AND org=?").get(keepId, child.club_id, child.org)
          : getDb().prepare("SELECT * FROM people_touchpoints WHERE person_id=? AND gmail_account=? AND gmail_message_id=? AND kind=?").get(keepId, child.gmail_account, child.gmail_message_id, child.kind)) as (Input & { id: number }) | undefined;
        if (duplicate) {
          const patch: Input = {};
          for (const key of entity === "affiliation" ? ["role", "is_eboard", "relevant_for_recruiting"] : ["summary", "detail"]) if (!duplicate[key] && child[key]) patch[key] = child[key];
          patchRow(entity, duplicate.id, patch, m);
          remove(entity, child.id, m);
        } else patchRow(entity, child.id, { person_id: keepId }, m);
      }
    }
    refreshContact(keepId, m); refreshContact(dropId, m);
    // Never cascade-delete a person: coffee chats and drafts belong to WP1 and remain read-only.
    archivePerson(dropId, m);
  });
  syncPersonNote(personRow(keepId));
  return getPerson(keepId);
}
export function getPerson(id: number): PersonDetail {
  const person = personRow(id), db = getDb();
  return { ...person,
    // Read-only links preserve access to WP1 records without moving their rows or changing schema.
    mergedRecords: db.prepare(`WITH RECURSIVE merged(id) AS (
      SELECT id FROM people WHERE dedupe_key = 'merged:' || id || ':' || CAST(? AS INTEGER)
      UNION SELECT p.id FROM people p JOIN merged m ON p.dedupe_key = 'merged:' || p.id || ':' || m.id
    ) SELECT id, display_name FROM people WHERE id IN (SELECT id FROM merged) ORDER BY id`).all(id) as PersonDetail["mergedRecords"],
    affiliations: db.prepare("SELECT a.*, c.name club_name FROM people_affiliations a LEFT JOIN stern_clubs c ON c.id=a.club_id WHERE person_id=? ORDER BY is_eboard DESC, a.id").all(id) as Affiliation[],
    touchpoints: (db.prepare("SELECT * FROM people_touchpoints WHERE person_id=? ORDER BY id DESC LIMIT 50").all(id) as Touchpoint[]).reverse().map(t => ({ ...t, gmail_message_id: t.gmail_message_id.startsWith("local:") ? "" : t.gmail_message_id })),
    coffeeChats: db.prepare("SELECT * FROM coffee_chats WHERE person_id=? ORDER BY id DESC").all(id) as PersonDetail["coffeeChats"],
    drafts: db.prepare("SELECT * FROM stern_drafts WHERE person_id=? ORDER BY id DESC").all(id) as PersonDetail["drafts"],
  };
}
export function clubPicker() { return getDb().prepare("SELECT id, name, short_name FROM stern_clubs ORDER BY name COLLATE NOCASE, id").all() as { id: number; name: string; short_name: string }[]; }
function where(filters: PeopleFilters) {
  const clauses = ["p.archived = ?"], values: (string | number)[] = [filters.archived ? 1 : 0];
  if (filters.q) { clauses.push("(p.display_name LIKE ? ESCAPE '\\' OR p.org LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\' OR p.instagram LIKE ? ESCAPE '\\')"); const q = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`; values.push(q, q, q, q); }
  for (const [key, column, valid] of [["relationshipType", "relationship_type", RELATIONSHIP_TYPES], ["status", "status", PERSON_STATUSES]] as const) {
    const selected = filters[key];
    if (selected?.length) { selected.forEach(v => enumValue(v, valid, key)); clauses.push(`p.${column} IN (${selected.map(() => "?").join(",")})`); values.push(...selected); }
  }
  if (filters.strengthMin !== undefined) { clauses.push("p.strength >= ?"); values.push(integer(filters.strengthMin, 1, 5, "strength")); }
  if (filters.clubId !== undefined) { clauses.push("EXISTS (SELECT 1 FROM people_affiliations a WHERE a.person_id=p.id AND a.club_id=?)"); values.push(integer(filters.clubId, 1, Number.MAX_SAFE_INTEGER, "club")); }
  if (filters.sphere) { clauses.push("p.sphere = ?"); values.push(enumValue(filters.sphere, SPHERES, "sphere")); }
  if (filters.followUpOwed) clauses.push("p.status = 'follow_up_owed'");
  return { sql: clauses.join(" AND "), values };
}
const SORTS = { name: "p.display_name COLLATE NOCASE, p.id", recent: "p.id DESC", strength: "p.strength DESC, p.id DESC", last_contact: "julianday(p.last_contact_at) DESC, p.id DESC" };
export function listPeople(filters: PeopleFilters = {}) {
  const { sql, values } = where(filters), db = getDb();
  const page = integer(filters.page ?? 1, 1, 1000000, "page"), pageSize = 25;
  if (filters.sort && !Object.prototype.hasOwnProperty.call(SORTS, filters.sort)) throw new SternError(400, "Invalid sort");
  const total = (db.prepare(`SELECT COUNT(*) n FROM people p WHERE ${sql}`).get(...values) as { n: number }).n;
  const people = db.prepare(`SELECT p.* FROM people p WHERE ${sql} ORDER BY ${SORTS[filters.sort || "name"]} LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Person[];
  const affiliations = people.length ? db.prepare(`SELECT a.*, c.name club_name FROM people_affiliations a LEFT JOIN stern_clubs c ON c.id=a.club_id WHERE person_id IN (${people.map(() => "?").join(",")}) ORDER BY is_eboard DESC,a.id`).all(...people.map(p => p.id)) as Affiliation[] : [];
  return { people: people.map(p => ({ ...p, affiliations: affiliations.filter(a => a.person_id === p.id) })), total, page, pageSize };
}
export function exportPeople(format: "json" | "csv", filters: PeopleFilters = {}): string {
  const { sql, values } = where(filters);
  const people = getDb().prepare(`SELECT p.* FROM people p WHERE ${sql} ORDER BY p.id`).all(...values) as Person[];
  if (format === "json") return JSON.stringify(people, null, 2);
  if (format !== "csv") throw new SternError(400, "Invalid export format");
  const keys = ["id", ...EDITABLE, "last_contact_at", "archived"] as const;
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&").replace(/"/g, '""')}"`;
  return [keys.join(","), ...people.map(p => keys.map(k => cell(p[k])).join(","))].join("\r\n");
}
export function importPeople(input: unknown, options: WriteOptions = {}) {
  if (!Array.isArray(input) || input.length > 5000) throw new SternError(400, "Expected an array of at most 5000 people");
  const m = meta(options);
  // Validate before creating any notes; database work itself is one atomic batch.
  for (const item of input) { object(item); normalized(item); if (!text(item.display_name) && !text(item.name) && !text(item.first_name) && !text(item.last_name)) throw new SternError(400, "Name is required"); }
  return peopleWrite(() => input.map(item => createPerson({ ...item, source: "import" }, m)));
}
export function networkSnapshot(): NetworkSnapshot {
  const db = getDb();
  const counts = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(status='follow_up_owed'),0) followUpsOwed, COALESCE(SUM(status='need_to_reach_out'),0) needToReachOut FROM people WHERE archived=0").get() as NetworkSnapshot["counts"];
  counts.byRelationshipType = Object.fromEntries(RELATIONSHIP_TYPES.map(k => [k, 0])) as NetworkSnapshot["counts"]["byRelationshipType"];
  for (const r of db.prepare("SELECT relationship_type type,COUNT(*) n FROM people WHERE archived=0 GROUP BY relationship_type").all() as { type: Person["relationship_type"]; n: number }[]) counts.byRelationshipType[r.type] = r.n;
  // Audited changes cover same-millisecond edits, child deletion and undo. SQL row markers
  // also cover trusted direct writers and read-only drawer data; unrelated tasks/programs do not.
  const marker = db.prepare(`SELECT
    (SELECT COALESCE(MAX(id),0) FROM stern_audit_log WHERE entity_type IN ('person','affiliation','touchpoint','coffee_chat','draft')) audit,
    (SELECT json_group_array(json_array(id,updated_at,archived)) FROM (SELECT * FROM people ORDER BY id)) people,
    (SELECT json_group_array(json_array(id,person_id,club_id,org,role,is_eboard,relevant_for_recruiting)) FROM (SELECT * FROM people_affiliations ORDER BY id)) affiliations,
    (SELECT json_group_array(json_array(id,person_id,occurred_at,summary,detail)) FROM (SELECT * FROM people_touchpoints ORDER BY id)) touchpoints,
    (SELECT json_group_array(json_array(id,person_id,updated_at)) FROM (SELECT * FROM coffee_chats ORDER BY id)) chats,
    (SELECT json_group_array(json_array(id,person_id,updated_at)) FROM (SELECT * FROM stern_drafts ORDER BY id)) drafts,
    (SELECT json_group_array(json_array(id,name,short_name)) FROM (SELECT * FROM stern_clubs ORDER BY id)) clubs`).get();
  const version = crypto.createHash("sha256").update(JSON.stringify(marker)).digest("hex");
  return { version, counts, recent: db.prepare("SELECT * FROM people WHERE archived=0 ORDER BY id DESC LIMIT 10").all() as Person[] };
}
