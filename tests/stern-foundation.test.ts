import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rath-stern-foundation-"));
const DB = path.join(tmp, "stern.db");
const VAULT = path.join(tmp, "vault");
process.env.RATHWORKSPACE_DB = DB;
process.env.COMMAND_CENTER_VAULT = VAULT;
process.env.STERN_VAULT_WRITE = "1";

const STERN_TABLES = [
  "stern_processes", "stern_clubs", "stern_programs", "stern_checklist_items", "people", "people_affiliations", "people_touchpoints",
  "coffee_chats", "stern_drafts", "stern_tasks", "courses", "course_meetings", "grade_categories", "assignments", "stern_scan_state",
  "stern_email_messages", "stern_calendar_events", "stern_suggestions", "stern_audit_log", "stern_reminders",
];

type Loaded = {
  getDb: typeof import("@/db")["getDb"];
  audit: typeof import("@/lib/stern/audit");
  vault: typeof import("@/lib/stern/vault-write");
  errors: typeof import("@/lib/stern/errors");
};
let loaded: Promise<Loaded> | null = null;
function setup() {
  if (!loaded) {
    loaded = Promise.all([import("@/db"), import("@/lib/stern/audit"), import("@/lib/stern/vault-write"), import("@/lib/stern/errors")]).then(
      ([db, audit, vault, errors]) => ({ getDb: db.getDb, audit, vault, errors })
    );
  }
  return loaded;
}

function cli(args: string[]): { code: number; json: any } {
  try {
    const stdout = execFileSync("node_modules/.bin/tsx", ["scripts/stern-cli.ts", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, RATHWORKSPACE_DB: DB },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, json: JSON.parse(stdout.trim().split("\n").pop() || "{}") };
  } catch (error: any) {
    const stdout = String(error.stdout || "").trim();
    return { code: Number(error.status ?? 1), json: stdout ? JSON.parse(stdout.split("\n").pop() || "{}") : { ok: false, error: String(error.stderr || error.message) } };
  }
}

test.after(async () => {
  const { getDb } = await setup();
  try { getDb().close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("0029_stern migration applies once and stays idempotent across a second process", async () => {
  const { getDb } = await setup();
  const db = getDb();
  const applied = db.prepare("SELECT COUNT(*) n FROM _migrations WHERE name = '0029_stern.sql'").get() as any;
  assert.equal(applied.n, 1);
  for (const table of STERN_TABLES) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `${table} should exist`);
  }
  const registry = db.prepare("SELECT slug FROM agent_registry WHERE slug = 'stern-automation'").get();
  assert.ok(registry, "stern-automation agent registry row seeded");
  // Second process, same DB: nothing to apply, no errors, still exactly one row.
  const out = execFileSync("node_modules/.bin/tsx", ["db/index.ts", "--migrate-only"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, RATHWORKSPACE_DB: DB } });
  assert.match(out, /migrations up to date/);
  assert.doesNotMatch(out, /applied migration 0029/);
  const again = db.prepare("SELECT COUNT(*) n FROM _migrations WHERE name = '0029_stern.sql'").get() as any;
  assert.equal(again.n, 1);
});

test("audit log records changes and undoBatch restores updates, deletes creates, and mirrors undo rows", async () => {
  const { getDb, audit, errors } = await setup();
  const db = getDb();
  const personId = Number(db.prepare("INSERT INTO people (dedupe_key, display_name, status) VALUES ('name:audit person:', 'Audit Person', 'met')").run().lastInsertRowid);
  const batch = audit.newBatchId("test");
  assert.match(batch, /^test:[0-9a-f-]{36}$/);
  const rowId = audit.logChange({ entityType: "person", entityId: personId, action: "update", field: "status", before: "met", after: "replied", source: "auto_email", confidence: 0.92, batchId: batch, evidenceExcerpt: "placeholder evidence" });
  db.prepare("UPDATE people SET status = 'replied' WHERE id = ?").run(personId);
  assert.ok(rowId > 0);
  const taskId = Number(db.prepare("INSERT INTO stern_tasks (title, domain, source, dedupe_key) VALUES ('Prep for placeholder interview', 'professional', 'auto', 'test:prep')").run().lastInsertRowid);
  audit.logCreate("task", taskId, { id: taskId, title: "Prep for placeholder interview" }, { batchId: batch, source: "auto_email" });

  const result = audit.undoBatch(batch);
  assert.deepEqual(result, { batchId: batch, reverted: 2, skipped: 0 });
  assert.equal((db.prepare("SELECT status FROM people WHERE id = ?").get(personId) as any).status, "met");
  assert.equal(db.prepare("SELECT id FROM stern_tasks WHERE id = ?").get(taskId), undefined, "created task removed by undo");
  const original = db.prepare("SELECT undone_at FROM stern_audit_log WHERE id = ?").get(rowId) as any;
  assert.notEqual(original.undone_at, "");
  const mirror = db.prepare("SELECT * FROM stern_audit_log WHERE undo_of = ?").get(rowId) as any;
  assert.equal(mirror.action, "undo");
  assert.equal(mirror.source, "undo");
  assert.equal(mirror.before_value, "replied");
  assert.equal(mirror.after_value, "met");
  assert.equal(mirror.batch_id, batch);
  assert.equal(audit.batchRows(batch).length, 4);
  assert.throws(() => audit.undoBatch(batch), (e: any) => e instanceof errors.SternError && e.status === 404, "second undo has nothing left");

  // delete -> re-insert from the snapshot
  const snapshot = db.prepare("SELECT * FROM people WHERE id = ?").get(personId) as any;
  const delBatch = audit.newBatchId("test");
  audit.logDelete("person", personId, snapshot, { batchId: delBatch, source: "manual" });
  db.prepare("DELETE FROM people WHERE id = ?").run(personId);
  assert.equal(audit.undoBatch(delBatch).reverted, 1);
  assert.equal((db.prepare("SELECT display_name FROM people WHERE id = ?").get(personId) as any).display_name, "Audit Person");

  const bad = (fn: () => unknown) => assert.throws(fn, (e: any) => e instanceof errors.SternError && e.status === 400);
  bad(() => audit.logChange({ entityType: "bogus", entityId: 1, action: "update", field: "status", batchId: batch }));
  bad(() => audit.logChange({ entityType: "person", entityId: 1, action: "update", field: "status; DROP TABLE people", batchId: batch }));
  bad(() => audit.logChange({ entityType: "person", entityId: 1, action: "update", field: "not_a_column", batchId: batch }));
  bad(() => audit.logChange({ entityType: "person", entityId: 1, action: "explode", batchId: batch }));
  bad(() => audit.logChange({ entityType: "person", entityId: 1, action: "update", field: "status", source: "hacker", batchId: batch }));
  bad(() => audit.logChange({ entityType: "person", entityId: 1, action: "update", field: "status", batchId: "" }));
  assert.equal(audit.auditTail(2).length, 2);
  assert.ok(audit.auditForEntity("person", personId).length >= 3);
});

test("vault helper writes only under Stern/, is idempotent, and no-ops when disabled or missing", async () => {
  const { vault, errors } = await setup();
  fs.mkdirSync(path.join(VAULT, "Stern"), { recursive: true });
  const first = vault.upsertNote("People/test-person.md", { name: "Test Person", org: "Placeholder: Club", strength: 3, status: "met", eboard: false }, "Likes placeholder topics.");
  assert.equal(first.written, true);
  const file = path.join(VAULT, "Stern", "People", "test-person.md");
  assert.ok(fs.existsSync(file));
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.startsWith("---\nname: Test Person\norg: \"Placeholder: Club\"\nstrength: 3\nstatus: met\neboard: false\n---\n\nLikes placeholder topics.\n"), text);
  const second = vault.upsertNote("People/test-person.md", { name: "Test Person" }, "Updated body.");
  assert.equal(second.written, true);
  const updated = fs.readFileSync(file, "utf8");
  assert.equal(updated, "---\nname: Test Person\n---\n\nUpdated body.\n");
  assert.equal(vault.readNote("People/test-person.md"), updated);
  assert.equal(fs.readdirSync(path.join(VAULT, "Stern", "People")).length, 1, "no tmp files or duplicates left behind");

  const bad = (fn: () => unknown) => assert.throws(fn, (e: any) => e instanceof errors.SternError && e.status === 400);
  bad(() => vault.upsertNote("../escape.md", {}, "x"));
  bad(() => vault.upsertNote("People/../../escape.md", {}, "x"));
  bad(() => vault.upsertNote("/etc/passwd.md", {}, "x"));
  bad(() => vault.upsertNote("People/no-extension", {}, "x"));
  assert.ok(!fs.existsSync(path.join(VAULT, "escape.md")));

  process.env.STERN_VAULT_WRITE = "0";
  const off = vault.upsertNote("People/off.md", {}, "x");
  assert.deepEqual(off, { written: false, reason: "STERN_VAULT_WRITE=0" });
  process.env.STERN_VAULT_WRITE = "1";
  assert.ok(!fs.existsSync(path.join(VAULT, "Stern", "People", "off.md")));

  const savedVault = process.env.COMMAND_CENTER_VAULT;
  process.env.COMMAND_CENTER_VAULT = path.join(tmp, "missing-vault");
  const missing = vault.upsertNote("People/missing.md", {}, "x");
  assert.equal(missing.written, false);
  assert.match((missing as any).reason, /vault root missing/);
  assert.ok(!fs.existsSync(path.join(tmp, "missing-vault")), "helper never creates the vault root itself");
  process.env.COMMAND_CENTER_VAULT = savedVault;
  assert.equal(vault.noteSlug("Priya  Náir!"), "priya-nair");
});

test("stern-cli add-person round trip: create, dedupe, audit rows, search, status, and rejection", async () => {
  const { getDb } = await setup();
  const db = getDb();
  const person = { name: "Test Person", org: "Placeholder Club", email: "test.person@example.com", role: "Placeholder VP", is_eboard: true, met_event: "Placeholder general meeting", instagram: "@test.person" };
  const created = cli(["add-person", "--source", "imessage", "--json", JSON.stringify(person)]);
  assert.equal(created.code, 0, JSON.stringify(created.json));
  assert.equal(created.json.ok, true);
  assert.equal(created.json.created, true);
  assert.equal(created.json.dedupeKey, "test.person@example.com");
  assert.equal(created.json.clubResolved, false, "no catalog seeded yet, so the org lands on the affiliation");
  assert.ok(created.json.id > 0);
  assert.ok(created.json.affiliationId > 0);
  assert.ok(created.json.touchpointId > 0);
  const stored = db.prepare("SELECT * FROM people WHERE id = ?").get(created.json.id) as any;
  assert.equal(stored.first_name, "Test");
  assert.equal(stored.last_name, "Person");
  assert.equal(stored.source, "imessage");
  assert.equal(stored.status, "met");
  assert.equal(stored.instagram, "test.person");
  assert.equal(stored.relationship_type, "club_connect");
  assert.notEqual(stored.last_contact_at, "");

  const again = cli(["add-person", "--source", "imessage", "--json", JSON.stringify({ ...person, phone: "+1 555 010 0000" })]);
  assert.equal(again.code, 0);
  assert.equal(again.json.created, false);
  assert.equal(again.json.id, created.json.id);
  assert.equal((db.prepare("SELECT phone FROM people WHERE id = ?").get(created.json.id) as any).phone, "+1 555 010 0000", "blank field filled on dedupe");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM people_touchpoints WHERE person_id = ? AND kind = 'met'").get(created.json.id) as any).n, 1, "met touchpoint written once");

  const auditRows = db.prepare("SELECT * FROM stern_audit_log WHERE batch_id = ?").all(created.json.batchId) as any[];
  assert.ok(auditRows.length >= 3, "person + affiliation + touchpoint create rows");
  assert.ok(auditRows.every((r) => r.source === "imessage"));
  assert.deepEqual(new Set(auditRows.map((r) => r.entity_type)), new Set(["person", "affiliation", "touchpoint"]));
  const fill = db.prepare("SELECT * FROM stern_audit_log WHERE batch_id = ? AND field = 'phone'").get(again.json.batchId) as any;
  assert.equal(fill.action, "update");
  assert.equal(fill.after_value, "+1 555 010 0000");

  const listed = cli(["list-people", "--q", "test"]);
  assert.equal(listed.code, 0);
  assert.equal(listed.json.count, 1);
  assert.equal(listed.json.people[0].display_name, "Test Person");

  const status = cli(["set-person-status", "--source", "agent", "--json", JSON.stringify({ person: "test.person@example.com", status: "need_to_reach_out" })]);
  assert.equal(status.code, 0, JSON.stringify(status.json));
  assert.equal(status.json.changed, true);
  assert.equal((db.prepare("SELECT status FROM people WHERE id = ?").get(created.json.id) as any).status, "need_to_reach_out");
  const statusAudit = db.prepare("SELECT source, before_value, after_value FROM stern_audit_log WHERE batch_id = ?").get(status.json.batchId) as any;
  assert.deepEqual(statusAudit, { source: "agent", before_value: "met", after_value: "need_to_reach_out" });

  const invalid = cli(["set-person-status", "--source", "agent", "--json", JSON.stringify({ person: created.json.id, status: "ghosted" })]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.json.ok, false);
  assert.match(invalid.json.error, /invalid status/);

  const task = cli(["add-task", "--source", "imessage", "--json", JSON.stringify({ title: "Email placeholder professor", domain: "academic", due_at: "2026-09-11T17:00:00-04:00", dedupe_key: "cli:test-task", person: "Test Person" })]);
  assert.equal(task.code, 0, JSON.stringify(task.json));
  assert.equal(task.json.created, true);
  const dupTask = cli(["add-task", "--source", "imessage", "--json", JSON.stringify({ title: "Email placeholder professor", dedupe_key: "cli:test-task" })]);
  assert.equal(dupTask.json.created, false);
  assert.equal(dupTask.json.id, task.json.id);
  const touch = cli(["add-touchpoint", "--source", "agent", "--json", JSON.stringify({ person: "Test Person", kind: "text", summary: "Texted about the placeholder meeting" })]);
  assert.equal(touch.code, 0, JSON.stringify(touch.json));
  assert.equal((db.prepare("SELECT source FROM people_touchpoints WHERE id = ?").get(touch.json.id) as any).source, "imessage");

  const usage = cli(["add-person", "--source", "imessage"]);
  assert.equal(usage.code, 2);
  const unknown = cli(["frobnicate"]);
  assert.equal(unknown.code, 2);
});

test("sternSnapshot counts from SQL and nyDayBounds respects America/New_York midnight", async () => {
  const { nyDayBounds, sternSnapshot } = await import("@/lib/stern/snapshot");
  const late = nyDayBounds("2026-09-05T03:30:00Z"); // 23:30 EDT on Sept 4
  assert.equal(late.dateKey, "2026-09-04");
  assert.equal(late.startIso, "2026-09-04T04:00:00.000Z");
  assert.equal(late.endIso, "2026-09-05T04:00:00.000Z");
  const winter = nyDayBounds("2026-12-15T12:00:00Z");
  assert.equal(winter.startIso, "2026-12-15T05:00:00.000Z");
  assert.equal(nyDayBounds("2026-09-05T03:30:00Z", 14).dateKey, "2026-09-18");

  const { getDb } = await setup();
  const db = getDb();
  db.prepare("UPDATE people SET status = 'follow_up_owed' WHERE display_name = 'Test Person'").run();
  db.prepare("INSERT INTO stern_tasks (title, domain, source, dedupe_key, due_at) VALUES ('Overdue placeholder', 'academic', 'manual', 'test:overdue', '2026-01-01T12:00:00-05:00')").run();
  const snap = sternSnapshot(new Date("2026-09-05T03:30:00Z"));
  assert.equal(snap.counts.followUpsOwed, 1);
  assert.ok(snap.counts.people >= 2);
  assert.equal(snap.counts.tasksOverdue, 1);
  assert.equal(snap.counts.tasksDueToday, 0);
  assert.equal(snap.counts.suggestionsPending, 0);
  assert.equal(snap.automation.lastScanAt, "");
  assert.equal(snap.automation.accountsScanned, 0);
  assert.deepEqual(snap.recruiting.clubs, []);
  assert.deepEqual(snap.needsYou, []);
  assert.ok(snap.updatedAt);
});
