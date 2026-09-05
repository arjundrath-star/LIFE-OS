import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CLUB_STATUSES, CLUB_TRANSITIONS, PROGRAM_STATUSES, PROGRAM_TRANSITIONS, COFFEE_CHAT_STATES, CHAT_TRANSITIONS, type RecruitingClub, type RecruitingProgram, type CoffeeChat } from "@/lib/stern-types";
import fixture from "./fixtures/stern/recruiting.json";

// Match the foundation tests, with all test artifacts confined to this worktree.
const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-recruiting-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "test.db");
process.env.STERN_VAULT_WRITE = "0";
let db: ReturnType<typeof import("@/db")["getDb"]>;
let recruiting: typeof import("@/lib/stern/recruiting");
let coffee: typeof import("@/lib/stern/coffee");
let audit: typeof import("@/lib/stern/audit");
let SternError: typeof import("@/lib/stern/errors")["SternError"];
test.before(async () => {
  const dbModule = await import("@/db");
  recruiting = await import("@/lib/stern/recruiting");
  coffee = await import("@/lib/stern/coffee");
  audit = await import("@/lib/stern/audit");
  SternError = (await import("@/lib/stern/errors")).SternError;
  db = dbModule.getDb();
});
const n = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
const club = () => db.prepare("SELECT * FROM stern_clubs ORDER BY id LIMIT 1").get() as RecruitingClub;
const program = () => db.prepare("SELECT * FROM stern_programs ORDER BY id LIMIT 1").get() as RecruitingProgram;
const bad = (fn: () => unknown) => assert.throws(fn, e => e instanceof SternError && e.status === 400);
function reset() {
  db.transaction(() => { for (const table of ["stern_audit_log", "coffee_chats", "people", "stern_processes"]) db.prepare(`DELETE FROM ${table}`).run(); }).immediate();
  recruiting.seedClubCatalog();
  recruiting.setInterested(club().id, true);
}
function person(clubId = club().id) {
  const id = Number(db.prepare("INSERT INTO people (display_name,email) VALUES (?,?)").run(fixture.person.display_name, fixture.person.email).lastInsertRowid);
  db.prepare("INSERT INTO people_affiliations (person_id,club_id,is_eboard,relevant_for_recruiting,role) VALUES (?,?,1,1,'Placeholder officer')").run(id, clubId);
  return id;
}
test.after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("public catalog seeds twice: 32 clubs, one process, no overwritten edits or extra audits", () => {
  const a = recruiting.seedClubCatalog();
  const before = n("SELECT COUNT(*) n FROM stern_audit_log");
  assert.deepEqual(recruiting.seedClubCatalog(), a);
  assert.equal(a.clubs, 32);
  assert.equal(n("SELECT COUNT(*) n FROM stern_processes"), 1);
  assert.equal(n("SELECT COUNT(*) n FROM stern_clubs WHERE interested = 0"), 32);
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log"), before);
  recruiting.updateClub(club().id, { name: "Renamed placeholder club", website: "", notes: "My notes", priority: 1 });
  recruiting.seedClubCatalog();
  assert.equal(club().name, "Renamed placeholder club");
  assert.equal(club().website, "");
  assert.equal(club().notes, "My notes");
  assert.equal(n("SELECT COUNT(*) n FROM stern_clubs"), 32);
});

test("0030 migration is idempotent and interview prep persists, edits, and undoes", () => {
  reset();
  const migration = fs.readFileSync("db/migrations/0030_stern_interview_prep.sql", "utf8");
  db.exec(migration); db.exec(migration);
  const id = recruiting.upsertPrep({ program_id: program().id, question: fixture.question, answer: fixture.answer, sort: 2 });
  const batchId = audit.newBatchId();
  recruiting.upsertPrep({ id, answer: "Revised answer" }, { batchId });
  execFileSync("node_modules/.bin/tsx", ["db/index.ts", "--migrate-only"], { env: { ...process.env }, stdio: "pipe" });
  assert.equal((db.prepare("SELECT answer FROM stern_interview_prep WHERE id = ?").get(id) as { answer: string }).answer, "Revised answer");
  audit.undoBatch(batchId);
  assert.equal(recruiting.recruitingSnapshot().clubs[0].prep[0].answer, fixture.answer);
  bad(() => recruiting.upsertPrep({ program_id: program().id, question: "" }));
});

test("interest creates two programs and seven checklist items once; hide retains everything; undo is atomic", () => {
  reset();
  recruiting.setInterested(club().id, true);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  assert.equal(n("SELECT COUNT(*) n FROM stern_checklist_items WHERE program_id = 0"), 7);
  assert.equal(program().app_deadline_at, "2026-09-19");
  const itemId = (db.prepare("SELECT id FROM stern_checklist_items LIMIT 1").get() as { id: number }).id;
  recruiting.toggleChecklist(itemId, true); recruiting.toggleChecklist(itemId, true);
  assert.equal(recruiting.recruitingSnapshot().clubs[0].checklistDone, 1);
  recruiting.toggleChecklist(itemId, false);
  assert.equal(recruiting.recruitingSnapshot().clubs[0].checklistDone, 0);
  recruiting.setInterested(club().id, false);
  assert.equal(recruiting.recruitingSnapshot().clubs.length, 0);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  recruiting.setInterested(club().id, true);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  const other = (db.prepare("SELECT id FROM stern_clubs WHERE id <> ? LIMIT 1").get(club().id) as { id: number }).id;
  const batchId = audit.newBatchId();
  recruiting.setInterested(other, true, { batchId });
  audit.undoBatch(batchId);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs WHERE club_id = ?", other), 0);
  assert.equal(n("SELECT COUNT(*) n FROM stern_checklist_items WHERE club_id = ?", other), 0);
  bad(() => recruiting.updateClub(club().id, { interested: 1 }));
  bad(() => recruiting.updateClub(club().id, { website: "javascript:alert(1)" }));
});

test("program upsert dedupes, validates dates/ownership, and cannot bypass status machine", () => {
  reset();
  const data = { club_id: club().id, name: "Placeholder track", track: "other", app_deadline_at: "2026-09-19T23:59:00-04:00" };
  const id = recruiting.upsertProgram(data);
  assert.equal(recruiting.upsertProgram(data), id);
  recruiting.upsertProgram({ id, requirements: "Resume", dress_code: "Business casual", notes: "Draft notes" });
  assert.equal((db.prepare("SELECT requirements FROM stern_programs WHERE id = ?").get(id) as { requirements: string }).requirements, "Resume");
  bad(() => recruiting.upsertProgram({ id, status: "accepted" }));
  bad(() => recruiting.upsertProgram({ id, app_deadline_at: "2026-02-30" }));
  bad(() => recruiting.upsertProgram({ id, app_deadline_at: "2026-09-19T23:59" }));
  bad(() => recruiting.upsertProgram({ id, club_id: club().id + 1 }));
});

test("every program status pair follows the transition graph; each accepted edge audited and undoable", () => {
  reset();
  for (const from of PROGRAM_STATUSES) for (const next of PROGRAM_STATUSES) {
    db.prepare("UPDATE stern_programs SET status = ? WHERE id = ?").run(from, program().id);
    const batchId = audit.newBatchId();
    if (from === next || PROGRAM_TRANSITIONS[from].includes(next)) {
      recruiting.setProgramStatus(program().id, next, { batchId });
      assert.equal(program().status, next);
      if (from !== next) { assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE batch_id = ? AND field = 'status'", batchId), 1); audit.undoBatch(batchId); assert.equal(program().status, from); }
    } else bad(() => recruiting.setProgramStatus(program().id, next, { batchId }));
  }
  bad(() => recruiting.setProgramStatus(program().id, "invented" as never));
});

test("every club status pair is enforced; archive club/process retain data and undo", () => {
  reset();
  for (const from of CLUB_STATUSES) for (const next of CLUB_STATUSES) {
    db.prepare("UPDATE stern_clubs SET status = ? WHERE id = ?").run(from, club().id);
    if (from === next || CLUB_TRANSITIONS[from].includes(next)) recruiting.setClubStatus(club().id, next);
    else bad(() => recruiting.setClubStatus(club().id, next));
  }
  db.prepare("UPDATE stern_clubs SET status = 'applying' WHERE id = ?").run(club().id);
  const batchId = audit.newBatchId();
  recruiting.archiveProcess(club().process_id, { batchId });
  assert.equal(n("SELECT COUNT(*) n FROM stern_clubs WHERE status = 'archived'"), 32);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  bad(() => recruiting.setInterested(club().id, true));
  bad(() => recruiting.setProgramStatus(program().id, "open"));
  audit.undoBatch(batchId);
  assert.equal(club().status, "applying");
  assert.equal((db.prepare("SELECT status FROM stern_processes").get() as { status: string }).status, "active");
  recruiting.archiveClub(club().id);
  assert.equal(club().status, "archived");
  assert.equal(recruiting.recruitingSnapshot().counts.archived, 1);
});

test("missed sweep handles NY end-of-day, offsets, open/drafting only, archived exclusion and repeat scans", () => {
  reset();
  db.prepare("UPDATE stern_programs SET status = 'open'").run();
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-20T03:59:59.999Z")).missed, 0);
  const result = recruiting.markMissedPrograms(new Date("2026-09-20T04:00:00Z"));
  assert.equal(result.missed, 1);
  assert.equal(program().status, "missed");
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-20T04:00:00Z")).missed, 0);
  audit.undoBatch(result.batchId);
  assert.equal(program().status, "open");
  const auditCount = n("SELECT COUNT(*) n FROM stern_audit_log");
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-20T04:00:15Z")).missed, 0);
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log"), auditCount, "undo must not churn on every tick");
  const timeline = recruiting.recruitingSnapshot().clubs[0].timeline;
  const missedRow = timeline.find(a => a.summary.startsWith("Program: Missed"))!;
  assert.equal(missedRow.source, "auto_calendar");
  assert.match(missedRow.summary, /Application deadline passed/);
  assert.ok(timeline.filter(a => a.source === "undo").every(a => !a.batch_id));
  db.prepare("UPDATE stern_programs SET status = 'drafting', app_opens_at = '', app_deadline_at = '2026-09-10T12:00:00-04:00'").run();
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-10T16:00:01Z")).missed, 2);
  for (const state of ["not_open", "submitted", "accepted"] as const) {
    db.prepare("UPDATE stern_programs SET status = ?").run(state);
    assert.equal(recruiting.markMissedPrograms(new Date("2026-09-30T12:00:00Z")).missed, 0);
  }
  db.prepare("UPDATE stern_programs SET status = 'open'").run();
  recruiting.archiveClub(club().id);
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-30T12:00:00Z")).missed, 0);
});

test("every coffee state pair is enforced, with touchpoint, timestamp, audit and atomic undo", () => {
  reset(); const personId = person(); const chatId = coffee.createCoffeeChat(personId, club().id);
  for (const from of COFFEE_CHAT_STATES) for (const next of COFFEE_CHAT_STATES) {
    db.prepare("UPDATE coffee_chats SET state = ?, reply_needs_me = 0 WHERE id = ?").run(from, chatId);
    const batchId = audit.newBatchId(); const before = n("SELECT COUNT(*) n FROM people_touchpoints");
    const options = { batchId, at: "2026-09-07T14:00:00Z", scheduled_at: fixture.scheduled_at };
    if (from === next || CHAT_TRANSITIONS[from].includes(next)) {
      coffee.transition(chatId, next, options);
      assert.equal((db.prepare("SELECT state FROM coffee_chats WHERE id = ?").get(chatId) as CoffeeChat).state, next);
      assert.equal(n("SELECT COUNT(*) n FROM people_touchpoints"), before + (from === next ? 0 : 1));
      if (from !== next) {
        assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE batch_id = ? AND entity_type = 'touchpoint'", batchId), 1);
        assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE batch_id = ? AND field = 'state'", batchId), 1);
        const stored = db.prepare("SELECT * FROM coffee_chats WHERE id = ?").get(chatId) as CoffeeChat;
        const timeKey = ({ requested: "requested_at", reply_received: "reply_at", scheduled: "scheduled_at", done: "occurred_at", thank_you_sent: "thank_you_sent_at" } as Record<string, keyof CoffeeChat>)[next];
        if (timeKey) assert.equal(stored[timeKey], next === "scheduled" ? fixture.scheduled_at : options.at);
        audit.undoBatch(batchId);
        assert.equal(n("SELECT COUNT(*) n FROM people_touchpoints"), before);
        assert.equal((db.prepare("SELECT state FROM coffee_chats WHERE id = ?").get(chatId) as CoffeeChat).state, from);
      }
    } else bad(() => coffee.transition(chatId, next, options));
  }
});

test("coffee chat identity, terminal behavior, follow-up attempts and affiliation reconciliation are idempotent", () => {
  reset(); const personId = person(); const chatId = coffee.createCoffeeChat(personId, club().id, program().id);
  assert.equal(coffee.createCoffeeChat(personId, club().id), chatId);
  assert.deepEqual(coffee.ensureCoffeeChatsForPerson(personId), [chatId]);
  coffee.transition(chatId, "requested"); coffee.transition(chatId, "no_reply");
  assert.equal(coffee.createCoffeeChat(personId, club().id), chatId);
  coffee.transition(chatId, "requested"); coffee.transition(chatId, "no_reply"); coffee.transition(chatId, "requested");
  assert.equal((db.prepare("SELECT follow_up_count FROM coffee_chats WHERE id = ?").get(chatId) as CoffeeChat).follow_up_count, 2);
  coffee.transition(chatId, "reply_received");
  bad(() => coffee.transition(chatId, "scheduled"));
  coffee.transition(chatId, "scheduled", { scheduled_at: fixture.scheduled_at });
  coffee.transition(chatId, "done");
  assert.equal(coffee.createCoffeeChat(personId, club().id), chatId, "done retains the thank-you obligation");
  coffee.updateCoffeeChat(chatId, { prep_notes: "Ask about the program", takeaways: "Practice the case", location: "Campus" });
  coffee.transition(chatId, "thank_you_sent");
  assert.deepEqual(coffee.ensureCoffeeChatsForPerson(personId), [chatId]);
  const second = coffee.createCoffeeChat(personId, club().id);
  assert.notEqual(second, chatId);
  coffee.transition(second, "requested"); coffee.transition(second, "declined");
  assert.notEqual(coffee.createCoffeeChat(personId, club().id), second);
  bad(() => coffee.updateCoffeeChat(chatId, { state: "requested" }));
  assert.throws(() => coffee.createCoffeeChat(999999, club().id), e => e instanceof SternError && e.status === 404);
  const newPerson = person();
  assert.equal(coffee.ensureCoffeeChatsForPerson(newPerson).length, 1);
  assert.equal(coffee.ensureCoffeeChatsForPerson(newPerson).length, 1);
  assert.equal(n("SELECT COUNT(*) n FROM coffee_chats WHERE person_id = ?", newPerson), 1);
});

test("snapshot counts, E-board links, distinct completed people, catalog, activity and live payload agree", async () => {
  reset(); const personId = person(); const chatId = coffee.createCoffeeChat(personId, club().id);
  let snap = recruiting.recruitingSnapshot(new Date(fixture.now));
  assert.equal(snap.counts.coffeeChatsOwed, 1); assert.equal(snap.counts.deadlines14d, 0);
  assert.equal(snap.catalog.length, 32); assert.equal(snap.clubs[0].people[0].chat?.id, chatId);
  snap = recruiting.recruitingSnapshot(new Date("2026-09-05T04:00:00Z"));
  assert.equal(snap.counts.deadlines14d, 1);
  coffee.transition(chatId, "requested"); coffee.transition(chatId, "reply_received");
  assert.equal(recruiting.recruitingSnapshot().counts.coffeeChatsOwed, 1);
  coffee.transition(chatId, "scheduled", { scheduled_at: fixture.scheduled_at }); coffee.transition(chatId, "done"); coffee.transition(chatId, "thank_you_sent");
  const another = coffee.createCoffeeChat(personId, club().id);
  db.prepare("UPDATE coffee_chats SET state = 'done' WHERE id = ?").run(another);
  snap = recruiting.recruitingSnapshot(); assert.equal(snap.clubs[0].chatsDone, 1);
  assert.ok(snap.clubs[0].timeline.some(a => a.key.startsWith("touch-")));
  assert.ok(snap.clubs[0].timeline.every((a,i,rows) => i === 0 || Date.parse(rows[i-1].at) >= Date.parse(a.at)));
  const { sternSnapshot, broadcastStern } = await import("@/lib/stern/snapshot");
  assert.equal(sternSnapshot().recruiting.clubs[0].id, club().id);
  const { getHub } = await import("@/server/live");
  const hub = getHub(); const original = hub.broadcast; const seen: string[] = [];
  hub.broadcast = ((channel: string) => { seen.push(channel); }) as typeof hub.broadcast;
  try { broadcastStern(); assert.deepEqual(seen, ["stern"]); } finally { hub.broadcast = original; }
  recruiting.setInterested(club().id, false);
  assert.equal(recruiting.recruitingSnapshot().counts.deadlines14d, 0);
});

test("deadline day math crosses local midnight EDT and DST without UTC off-by-one", () => {
  assert.equal(recruiting.deadlineDays("2026-09-19", new Date("2026-09-05T03:59:59Z")), 15);
  assert.equal(recruiting.deadlineDays("2026-09-19", new Date("2026-09-05T04:00:00Z")), 14);
  assert.equal(recruiting.deadlineDays("2026-09-20T03:59:00Z", new Date("2026-09-19T04:00:00Z")), 0);
  assert.equal(recruiting.deadlineDays("2026-11-02", new Date("2026-11-01T04:00:00Z")), 1);
  assert.equal(recruiting.deadlineDays("2026-03-09", new Date("2026-03-08T05:00:00Z")), 1);
});


test("seed and undo activity cannot offer undo; seed API undo preserves catalog and all recruiting data", () => {
  reset();
  const seedBatch = (db.prepare("SELECT batch_id FROM stern_audit_log WHERE source = 'seed' LIMIT 1").get() as { batch_id: string }).batch_id;
  const prepId = recruiting.upsertPrep({ program_id: program().id, question: fixture.question, answer: fixture.answer });
  coffee.createCoffeeChat(person(), club().id, program().id);
  const before = db.prepare("SELECT * FROM stern_audit_log ORDER BY id").all();
  bad(() => audit.undoBatch(seedBatch));
  assert.equal(n("SELECT COUNT(*) n FROM stern_clubs"), 32);
  assert.equal(n("SELECT COUNT(*) n FROM stern_processes"), 1);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  assert.equal(n("SELECT COUNT(*) n FROM stern_checklist_items"), 7);
  assert.equal(n("SELECT COUNT(*) n FROM stern_interview_prep WHERE id = ?", prepId), 1);
  assert.equal(n("SELECT COUNT(*) n FROM coffee_chats"), 1);
  assert.deepEqual(db.prepare("SELECT * FROM stern_audit_log ORDER BY id").all(), before);
  const seeds = recruiting.recruitingSnapshot().clubs[0].timeline.filter(a => a.source === "seed");
  assert.ok(seeds.length);
  assert.ok(seeds.every(a => a.batch_id === ""));
});

test("undo program creation refuses later prep and soft-linked chats atomically", () => {
  reset();
  const interestBatch = (db.prepare("SELECT batch_id FROM stern_audit_log WHERE entity_type = 'program' AND entity_id = ? AND action = 'create'").get(program().id) as { batch_id: string }).batch_id;
  const prepBatch = audit.newBatchId();
  const prepId = recruiting.upsertPrep({ program_id: program().id, question: fixture.question, answer: fixture.answer }, { batchId: prepBatch });
  const before = db.prepare("SELECT * FROM stern_audit_log ORDER BY id").all();
  assert.throws(() => audit.undoBatch(interestBatch), e => e instanceof SternError && e.status === 409);
  assert.equal(club().interested, 1);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  assert.equal(n("SELECT COUNT(*) n FROM stern_checklist_items"), 7);
  assert.equal(n("SELECT COUNT(*) n FROM stern_interview_prep WHERE id = ?", prepId), 1);
  assert.deepEqual(db.prepare("SELECT * FROM stern_audit_log ORDER BY id").all(), before);
  const activity = recruiting.recruitingSnapshot().clubs[0].timeline.find(a => a.batch_id === interestBatch)!;
  assert.match(activity.undoSummary!, /Remove program: Exploratory program/);
  assert.match(activity.undoSummary!, /Remove checklist item/);
  audit.undoBatch(prepBatch);
  const editBatch = audit.newBatchId();
  recruiting.upsertProgram({ id: program().id, notes: "Keep this later edit" }, { batchId: editBatch });
  assert.throws(() => audit.undoBatch(interestBatch), e => e instanceof SternError && e.status === 409);
  assert.equal(program().notes, "Keep this later edit");
  audit.undoBatch(editBatch);
  const chatBatch = audit.newBatchId();
  coffee.createCoffeeChat(person(), club().id, program().id, { batchId: chatBatch });
  assert.throws(() => audit.undoBatch(interestBatch), e => e instanceof SternError && e.status === 409);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 2);
  assert.equal(n("SELECT COUNT(*) n FROM coffee_chats"), 1);
  audit.undoBatch(chatBatch);
  audit.undoBatch(interestBatch);
  assert.equal(n("SELECT COUNT(*) n FROM stern_programs"), 0);
});

test("missed applications accept late-recorded outcomes; edited deadlines re-enable the sweep", () => {
  for (const next of ["submitted", "declined", "withdrawn"] as const) {
    reset();
    recruiting.setProgramStatus(program().id, "open");
    recruiting.markMissedPrograms(new Date("2026-09-20T04:00:00Z"));
    assert.equal(program().status, "missed");
    recruiting.setProgramStatus(program().id, next);
    assert.equal(program().status, next);
    assert.equal(recruiting.markMissedPrograms(new Date("2026-09-20T04:00:15Z")).missed, 0);
  }
  reset();
  recruiting.setProgramStatus(program().id, "open");
  const result = recruiting.markMissedPrograms(new Date("2026-09-20T04:00:00Z"));
  audit.undoBatch(result.batchId);
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-20T04:00:15Z")).missed, 0);
  recruiting.upsertProgram({ id: program().id, app_deadline_at: "2026-09-21" });
  assert.equal(recruiting.markMissedPrograms(new Date("2026-09-22T04:00:00Z")).missed, 1);
});

test("reclassified and preexisting Gmail evidence is reused while every chat transition stays audited", () => {
  reset(); const personId = person(); const chatId = coffee.createCoffeeChat(personId, club().id);
  coffee.transition(chatId, "requested");
  const evidence = { source: "auto_email", gmailAccount: "student@example.com", gmailMessageId: "fixture-reply" };
  const replyBatch = audit.newBatchId();
  coffee.transition(chatId, "reply_received", { ...evidence, batchId: replyBatch });
  const declineBatch = audit.newBatchId();
  coffee.transition(chatId, "declined", { ...evidence, batchId: declineBatch });
  assert.equal(n("SELECT COUNT(*) n FROM people_touchpoints WHERE gmail_message_id = 'fixture-reply'"), 1);
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE batch_id = ? AND entity_type = 'touchpoint'", declineBatch), 0);
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE batch_id = ? AND field = 'state'", declineBatch), 1);
  audit.undoBatch(declineBatch);
  assert.equal((db.prepare("SELECT state FROM coffee_chats WHERE id = ?").get(chatId) as CoffeeChat).state, "reply_received");
  assert.equal(n("SELECT COUNT(*) n FROM people_touchpoints WHERE gmail_message_id = 'fixture-reply'"), 1);
  // Evidence may have been written by the email ingestion job before the state transition.
  audit.undoBatch(replyBatch);
  db.prepare("INSERT INTO people_touchpoints (person_id,kind,source,gmail_account,gmail_message_id) VALUES (?,'email_received','gmail',?,?)").run(personId, evidence.gmailAccount, evidence.gmailMessageId);
  coffee.transition(chatId, "reply_received", evidence);
  assert.equal(n("SELECT COUNT(*) n FROM people_touchpoints WHERE gmail_message_id = 'fixture-reply'"), 1);
});

test("archived club edits and browser automation metadata are rejected", () => {
  reset(); recruiting.archiveClub(club().id);
  bad(() => recruiting.updateClub(club().id, { priority: 1, notes: "Cannot change archive" }));
  bad(() => recruiting.setInterested(club().id, false));
  for (const key of ["gmail_thread_id", "calendar_event_id", "source", "gmailMessageId", "batchId"]) bad(() => coffee.manualChatTransitionMeta({ [key]: "spoofed" }));
  assert.deepEqual(coffee.manualChatTransitionMeta({ location: "Campus", reply_needs_me: false }), { location: "Campus", reply_needs_me: false });
});

test("global coffee chat obligations include club-less chats; recruiting remains scoped", async () => {
  reset(); const personId = person();
  coffee.createCoffeeChat(personId, club().id);
  db.prepare("INSERT INTO coffee_chats (person_id,club_id,state,reply_needs_me) VALUES (?,0,'reply_received',1)").run(personId);
  const { sternSnapshot } = await import("@/lib/stern/snapshot");
  assert.equal(sternSnapshot().counts.coffeeChatsOwed, 2);
  assert.equal(sternSnapshot().counts.replyOwed, 1);
  assert.equal(sternSnapshot().recruiting.counts.coffeeChatsOwed, 1);
});

test("bundled seed works without runtime docs and insert rejects unknown SQL identifiers", async () => {
  reset(); const cwd = process.cwd();
  try {
    process.chdir(tmp);
    assert.equal(recruiting.recruitingSnapshot().windows.length, 2);
    recruiting.setInterested(club().id + 1, true);
    assert.equal(recruiting.seedClubCatalog().clubs, 32);
  } finally { process.chdir(cwd); }
  const { insert, meta } = await import("@/lib/stern/recruiting-write");
  for (const key of ["unknown_column", "name) VALUES ('bad'); --", "id"]) bad(() => insert("club", { [key]: "bad" }, meta()));
  assert.equal(n("SELECT COUNT(*) n FROM stern_clubs"), 32);
});
