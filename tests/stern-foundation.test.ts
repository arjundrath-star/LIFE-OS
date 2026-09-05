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

  const skippedStatus = cli(["set-person-status", "--source", "agent", "--json", JSON.stringify({ person: created.json.id, status: "chatted" })]);
  assert.equal(skippedStatus.code, 1);
  assert.match(skippedStatus.json.error, /Cannot change/);
  assert.equal((db.prepare("SELECT status FROM people WHERE id=?").get(created.json.id) as any).status, "need_to_reach_out");

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
  // WP4 migrates the legacy seed todos too; assert the delta from that real baseline.
  const overdueBefore = sternSnapshot(new Date("2026-09-05T03:30:00Z")).counts.tasksOverdue;
  db.prepare("INSERT INTO stern_tasks (title, domain, source, dedupe_key, due_at) VALUES ('Overdue placeholder', 'academic', 'manual', 'test:overdue', '2026-01-01T12:00:00-05:00')").run();
  const snap = sternSnapshot(new Date("2026-09-05T03:30:00Z"));
  assert.equal(snap.counts.followUpsOwed, 1);
  assert.ok(snap.counts.people >= 2);
  assert.equal(snap.counts.tasksOverdue, overdueBefore + 1);
  assert.equal(snap.counts.tasksDueToday, 0);
  assert.equal(snap.counts.suggestionsPending, 0);
  assert.equal(snap.automation.lastScanAt, "");
  assert.equal(snap.automation.accountsScanned, 0);
  assert.deepEqual(snap.recruiting.clubs, []);
  assert.deepEqual(snap.needsYou, []);
  assert.ok(snap.updatedAt);
});

test("undoBatch refuses cascade deletes from other batches, skips stale updates, and restores NULL", async () => {
  const { getDb, audit, errors } = await setup();
  const db = getDb();
  // Batch A creates a person; batch B adds a touchpoint later. Undoing A alone must not cascade B away.
  const A = audit.newBatchId("a");
  const pid = Number(db.prepare("INSERT INTO people (dedupe_key, display_name, status) VALUES (?, ?, 'met')").run("name:undo test person:placeholder club", "Undo Test Person").lastInsertRowid);
  audit.logCreate("person", pid, { id: pid, display_name: "Undo Test Person" }, { batchId: A, source: "imessage" });
  const B = audit.newBatchId("b");
  const tid = Number(db.prepare("INSERT INTO people_touchpoints (person_id, kind, source, gmail_message_id, summary) VALUES (?, 'note', 'manual', 'local:undo-test-1', 'later note')").run(pid).lastInsertRowid);
  audit.logCreate("touchpoint", tid, { id: tid }, { batchId: B, source: "manual" });
  assert.throws(() => audit.undoBatch(A), (e: any) => e instanceof errors.SternError && e.status === 409, "cascade refused with 409");
  assert.ok(db.prepare("SELECT id FROM people WHERE id = ?").get(pid), "person survives the refused undo");
  assert.ok(db.prepare("SELECT id FROM people_touchpoints WHERE id = ?").get(tid), "child survives the refused undo");
  assert.equal((db.prepare("SELECT undone_at FROM stern_audit_log WHERE batch_id = ? AND action = 'create'").get(A) as any).undone_at, "", "refused row not stamped");
  assert.equal(audit.undoBatch(B).reverted, 1);
  assert.equal(audit.undoBatch(A).reverted, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM people WHERE id = ?").get(pid) as any).n, 0);

  // Batch C changes status met -> replied, batch D replied -> chatted. Undoing C first is a no-op skip.
  const pid2 = Number(db.prepare("INSERT INTO people (dedupe_key, display_name, status) VALUES (?, ?, 'met')").run("name:stale update person:placeholder club", "Stale Update Person").lastInsertRowid);
  const C = audit.newBatchId("c");
  db.prepare("UPDATE people SET status = 'replied' WHERE id = ?").run(pid2);
  audit.logChange({ entityType: "person", entityId: pid2, action: "update", field: "status", before: "met", after: "replied", batchId: C, source: "auto_email" });
  const D = audit.newBatchId("d");
  db.prepare("UPDATE people SET status = 'chatted' WHERE id = ?").run(pid2);
  audit.logChange({ entityType: "person", entityId: pid2, action: "update", field: "status", before: "replied", after: "chatted", batchId: D, source: "manual" });
  const stale = audit.undoBatch(C);
  assert.deepEqual([stale.reverted, stale.skipped], [0, 1]);
  assert.equal((db.prepare("SELECT status FROM people WHERE id = ?").get(pid2) as any).status, "chatted", "later change wins");
  assert.equal((db.prepare("SELECT undone_at FROM stern_audit_log WHERE batch_id = ?").get(C) as any).undone_at, "", "skipped row stays eligible");
  assert.equal(audit.undoBatch(D).reverted, 1);
  assert.equal(audit.undoBatch(C).reverted, 1);
  assert.equal((db.prepare("SELECT status FROM people WHERE id = ?").get(pid2) as any).status, "met");

  // Nullable REAL: a grade set from NULL to 18 restores to NULL, not ''.
  const cid = Number(db.prepare("INSERT INTO courses (code, title, term) VALUES ('TEST-UB 1', 'Placeholder course', 'Test term')").run().lastInsertRowid);
  const aid = Number(db.prepare("INSERT INTO assignments (course_id, title, dedupe_key) VALUES (?, 'Quiz 0', 'test-ub 1:quiz 0')").run(cid).lastInsertRowid);
  const E = audit.newBatchId("e");
  db.prepare("UPDATE assignments SET points_earned = 18 WHERE id = ?").run(aid);
  audit.logChange({ entityType: "assignment", entityId: aid, action: "update", field: "points_earned", before: null, after: 18, batchId: E, source: "auto_email" });
  assert.equal(audit.undoBatch(E).reverted, 1);
  assert.equal((db.prepare("SELECT points_earned FROM assignments WHERE id = ?").get(aid) as any).points_earned, null);
  assert.throws(() => audit.logChange({ entityType: "person", entityId: pid2, action: "update", field: "id", before: 1, after: 2, batchId: E }), (e: any) => e instanceof errors.SternError && e.status === 400, "id is never an updatable field");
});

test("date-only due dates count as due today, not overdue, in the New York day", async () => {
  const { getDb } = await setup();
  const db = getDb();
  const { sternSnapshot } = await import("@/lib/stern/snapshot");
  const { nyDayBounds } = await import("@/lib/stern/time");
  const now = new Date();
  const today = nyDayBounds(now);
  const yesterday = nyDayBounds(now, -1);
  const before = sternSnapshot(now).counts;
  const insert = db.prepare("INSERT INTO stern_tasks (title, due_at, status, dedupe_key) VALUES (?, ?, 'open', ?)");
  insert.run("Date-only due today", today.dateKey, "test:date-only-today");
  insert.run("Date-only due yesterday", yesterday.dateKey, "test:date-only-yesterday");
  insert.run("Instant due today", new Date(Date.parse(today.startIso) + 60 * 60 * 1000).toISOString(), "test:instant-today");
  insert.run("Instant with offset due today", new Date(Date.parse(today.endIso) - 30 * 60 * 1000).toISOString().replace("Z", "+00:00"), "test:instant-offset-today");
  const after = sternSnapshot(now).counts;
  assert.equal(after.tasksDueToday - before.tasksDueToday, 3, "two instants and the date-only key are due today");
  assert.equal(after.tasksOverdue - before.tasksOverdue, 1, "only yesterday's date-only task is overdue");
  db.prepare("DELETE FROM stern_tasks WHERE dedupe_key LIKE 'test:%'").run();
});

test("broadcastStern sends the stern channel only when the snapshot changed", async () => {
  const { getDb } = await setup();
  const { broadcastStern, sternSnapshot } = await import("@/lib/stern/snapshot");
  const { getHub } = await import("@/server/live");
  const strip = (v: unknown) => JSON.stringify(v, (k, x) => (k === "updatedAt" ? undefined : x));
  const k1 = strip(sternSnapshot());
  const k2 = strip(sternSnapshot());
  if (k1 !== k2) {
    let i = 0;
    while (i < k1.length && k1[i] === k2[i]) i++;
    assert.fail(`snapshot differs between consecutive calls near: ${k1.slice(Math.max(0, i - 150), i + 60)} || ${k2.slice(Math.max(0, i - 150), i + 60)}`);
  }
  const hub = getHub();
  const sent: string[] = [];
  const original = hub.broadcast;
  hub.broadcast = (channel: string, payload: unknown) => { sent.push(channel); original.call(hub, channel, payload); };
  try {
    broadcastStern({ force: true });
    broadcastStern();
    broadcastStern();
    assert.equal(sent.filter((c) => c === "stern").length, 1, "unchanged snapshots are not re-sent");
    const probe = Number(getDb().prepare("INSERT INTO people (dedupe_key, display_name) VALUES ('name:broadcast probe person:placeholder', 'Broadcast Probe Person')").run().lastInsertRowid);
    broadcastStern();
    assert.equal(sent.filter((c) => c === "stern").length, 2, "a real change is sent");
    getDb().prepare("DELETE FROM people WHERE id = ?").run(probe);
    broadcastStern();
    assert.equal(sent.filter((c) => c === "stern").length, 3);
  } finally {
    hub.broadcast = original;
  }
});

test("undoBatch refuses seed batches", async () => {
  const { getDb, audit, errors } = await setup();
  const db = getDb();
  const seed = audit.newBatchId("seed");
  const cid = Number(db.prepare("INSERT INTO courses (code, title, term) VALUES ('SEED-UB 9', 'Seed probe course', 'Test term')").run().lastInsertRowid);
  audit.logCreate("course", cid, { id: cid }, { batchId: seed, source: "seed" });
  assert.throws(() => audit.undoBatch(seed), (e: any) => e instanceof errors.SternError && e.status === 400 && /seed/.test(e.message), "catalog seed refused");
  assert.ok(db.prepare("SELECT id FROM courses WHERE id = ?").get(cid), "seeded course survives");
  db.prepare("DELETE FROM courses WHERE id = ?").run(cid);
  // Row-level seeds (for example the legacy todo import) remain undoable.
  const rowSeed = audit.newBatchId("seedrow");
  const tid = Number(db.prepare("INSERT INTO stern_tasks (title, source, dedupe_key) VALUES ('Legacy probe', 'seed', 'legacy-todo:probe')").run().lastInsertRowid);
  audit.logCreate("task", tid, { id: tid }, { batchId: rowSeed, source: "seed" });
  assert.equal(audit.undoBatch(rowSeed).reverted, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM stern_tasks WHERE id = ?").get(tid) as any).n, 0);
});

test("calendar touchpoints dedupe on the event id; manual notes without a reference stay distinct", async () => {
  const { getDb } = await setup();
  const people = await import("@/lib/stern/people");
  const { person } = people.createPerson({ name: "Calendar Dedupe Person", org: "Placeholder Club", email: "calendar.dedupe@example.com" }, { source: "manual" });
  for (let i = 0; i < 3; i++) people.addTouchpoint(person.id, "calendar", { source: "calendar", gmail_account: "netid@stern.nyu.edu", gmail_message_id: "calendar:evt-1:scheduled", summary: "Coffee chat scheduled" });
  assert.equal((getDb().prepare("SELECT COUNT(*) n FROM people_touchpoints WHERE person_id = ? AND kind = 'calendar'").get(person.id) as any).n, 1, "repeated syncs keep one row");
  people.addTouchpoint(person.id, "note", { source: "manual", summary: "note one" });
  people.addTouchpoint(person.id, "note", { source: "manual", summary: "note two" });
  assert.equal((getDb().prepare("SELECT COUNT(*) n FROM people_touchpoints WHERE person_id = ? AND kind = 'note'").get(person.id) as any).n, 2);
});

test("undoing a person create refuses while a draft still references the person", async () => {
  const { getDb, audit, errors } = await setup();
  const db = getDb();
  const A = audit.newBatchId("a");
  const pid = Number(db.prepare("INSERT INTO people (dedupe_key, display_name) VALUES ('name:draft link person:placeholder', 'Draft Link Person')").run().lastInsertRowid);
  audit.logCreate("person", pid, { id: pid }, { batchId: A, source: "auto_email" });
  const did = Number(db.prepare("INSERT INTO stern_drafts (person_id, kind, to_email, subject, body) VALUES (?, 'request', 'draft.link@example.com', 'Coffee chat', 'placeholder')").run(pid).lastInsertRowid);
  assert.throws(() => audit.undoBatch(A), (e: any) => e instanceof errors.SternError && e.status === 409 && /stern_drafts/.test(e.message));
  assert.ok(db.prepare("SELECT id FROM people WHERE id = ?").get(pid), "person survives the refused undo");
  db.prepare("DELETE FROM stern_drafts WHERE id = ?").run(did);
  assert.equal(audit.undoBatch(A).reverted, 1);
});

test("unexpected errors never reach the client verbatim", async () => {
  const { errors } = await setup();
  const out = errors.toErrorResponse(new Error("SQLITE_ERROR at /tmp/secret/path.db"));
  assert.deepEqual(out, { status: 500, message: "Stern request failed" });
  assert.deepEqual(errors.toErrorResponse(new errors.SternError(409, "kept")), { status: 409, message: "kept" });
});

test("vault writer refuses a symlinked directory that escapes Stern/", async () => {
  const { vault, errors } = await setup();
  const sternDir = path.join(VAULT, "Stern");
  fs.mkdirSync(sternDir, { recursive: true });
  const outside = fs.mkdtempSync(path.join(tmp, "outside-"));
  const link = path.join(sternDir, "Escape");
  try { fs.unlinkSync(link); } catch {}
  fs.symlinkSync(outside, link, "dir");
  assert.throws(() => vault.upsertNote("Escape/x.md", { name: "x" }, "body"), (e: any) => e instanceof errors.SternError && e.status === 400 && /symlink/.test(e.message));
  assert.equal(fs.existsSync(path.join(outside, "x.md")), false, "nothing written outside");
  fs.unlinkSync(link);
});

test("stern-cli rejects zone-less due dates and accepts date-only and offset forms", async () => {
  await setup();
  const bad = cli(["add-task", "--source", "imessage", "--json", JSON.stringify({ title: "Zone-less due", due_at: "2026-09-05T17:00" })]);
  assert.equal(bad.code, 1); assert.equal(bad.json?.ok, false);
  const day = cli(["add-task", "--source", "imessage", "--json", JSON.stringify({ title: "Date-only due", due_at: "2026-09-05", dedupe_key: "test:date-only-cli" })]);
  assert.equal(day.code, 0, JSON.stringify(day.json));
  const offset = cli(["add-task", "--source", "imessage", "--json", JSON.stringify({ title: "Offset due", due_at: "2026-09-05T17:00:00-04:00", dedupe_key: "test:offset-cli" })]);
  assert.equal(offset.code, 0, JSON.stringify(offset.json));
});

test("rules pass creates to_request coffee chats with no Google account connected and the LLM off", async () => {
  const { getDb } = await setup();
  const prev = process.env.STERN_LLM_MODE; process.env.STERN_LLM_MODE = "off";
  try {
    const recruiting = await import("@/lib/stern/recruiting");
    const people = await import("@/lib/stern/people");
    const { runRulesPass } = await import("@/lib/stern/rules-pass");
    recruiting.seedClubCatalog();
    const club = getDb().prepare("SELECT id FROM stern_clubs WHERE name LIKE 'Strategic Venture%' LIMIT 1").get() as { id: number };
    recruiting.setInterested(club.id, true);
    const { person } = people.createPerson({ name: "Rules Pass Person", org: "Strategic Venture Society", email: "rules.pass@example.com" });
    people.addAffiliation(person.id, { clubId: club.id, club_id: club.id, role: "VP", isEboard: true, is_eboard: 1, relevantForRecruiting: true, relevant_for_recruiting: 1 });
    people.setStatus(person.id, "need_to_reach_out");
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM google_accounts").get() as any).n, 0, "no Google account connected");
    const result = await runRulesPass();
    assert.equal(result.drafts, 0, "no drafts without an LLM");
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM coffee_chats WHERE person_id = ? AND state = 'to_request'").get(person.id) as any).n, 1);
  } finally { if (prev === undefined) delete process.env.STERN_LLM_MODE; else process.env.STERN_LLM_MODE = prev; }
});
