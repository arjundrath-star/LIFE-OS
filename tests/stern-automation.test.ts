import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fixtures from "./fixtures/stern/emails.json";
import type { AutomationSource } from "@/lib/stern/automation-source";
import type { EmailClassification, SternEmailMessage } from "@/lib/stern-types";
import type { GoogleCalendarEvent } from "@/lib/sources/google";
const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-automation-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "test.db");
process.env.STERN_VAULT_WRITE = "0";
process.env.STERN_LLM_MODE = "fixture";
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("NETWORK CALL FORBIDDEN IN AUTOMATION TESTS"); };
let db: ReturnType<typeof import("@/db")["getDb"]>;
let scan: typeof import("@/lib/stern/gmail-scan");
let policy: typeof import("@/lib/stern/apply");
let audit: typeof import("@/lib/stern/audit");
let recruiting: typeof import("@/lib/stern/recruiting");
let sourceMod: typeof import("@/lib/stern/automation-source");
let calendar: typeof import("@/lib/stern/calendar-sync");
let llm: typeof import("@/lib/stern/llm");
let drafts: typeof import("@/lib/stern/drafts");
const q = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as any;
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as any[];
let available = new Set<string>();
let calendarRows: GoogleCalendarEvent[] = [];
let calendarCalls = 0, draftCalls = 0;
let source: AutomationSource;
const fixture = (id: string) => fixtures.find(f => f.id === id)!;
const msg = (id: string) => q("SELECT * FROM stern_email_messages WHERE gmail_message_id=?", id) as SternEmailMessage;
const chatFor = (id: string) => q("SELECT ch.* FROM coffee_chats ch JOIN people p ON p.id=ch.person_id WHERE p.email=? ORDER BY ch.id DESC LIMIT 1", fixture(id).expected.people[0].email);
const clubFor = (id: string) => q("SELECT * FROM stern_clubs WHERE name=?", fixture(id).expected.club);
async function feed(...ids: string[]) { ids.forEach(id => available.add(id)); return scan.runSternEmailScan({ source, dryRun: true, now: new Date("2026-09-05T12:00:00Z") }); }
test.before(async () => {
  db = (await import("@/db")).getDb();
  scan = await import("@/lib/stern/gmail-scan"); policy = await import("@/lib/stern/apply"); audit = await import("@/lib/stern/audit");
  recruiting = await import("@/lib/stern/recruiting"); sourceMod = await import("@/lib/stern/automation-source"); calendar = await import("@/lib/stern/calendar-sync"); llm = await import("@/lib/stern/llm"); drafts = await import("@/lib/stern/drafts");
  source = {
    list: async (account, since) => fixtures.filter(f => available.has(f.id) && f.account === account && Date.parse(f.date) >= since).map(f => f.id),
    full: async (_, id) => sourceMod.fixtureMessage(fixture(id)), calendar: async () => calendarRows,
    createEvent: async (_, input, options) => { assert.equal(options?.dryRun, true); calendarCalls++; return { id: `dry-run:${input.id}` }; },
    createDraft: async (_, _input, options) => { draftCalls++; return { id: options?.dryRun ? "dry-run:draft" : "stub-draft" }; },
  };
});
function reset() {
  db.transaction(() => {
    for (const t of ["stern_audit_log", "stern_suggestions", "stern_drafts", "stern_calendar_events", "stern_email_messages", "stern_scan_state", "stern_tasks", "assignments", "courses", "coffee_chats", "people", "stern_processes", "google_accounts", "kv"]) db.prepare(`DELETE FROM ${t}`).run();
    for (const email of ["netid@stern.nyu.edu", "netid@nyu.edu"]) db.prepare("INSERT INTO google_accounts(email,enabled,scopes,refresh_token_enc) VALUES (?,1,?,'stub')").run(email, "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events");
  }).immediate();
  recruiting.seedClubCatalog();
  for (const c of all("SELECT id FROM stern_clubs")) recruiting.setInterested(c.id, true);
  for (const code of ["STAT-UB 103", "MKTG-UB 1", "TECH-UB 1", "CAMS-UA 110"]) db.prepare("INSERT INTO courses(code,title) VALUES (?,?)").run(code, `Placeholder ${code}`);
  available = new Set(); calendarRows = []; calendarCalls = 0; draftCalls = 0; process.env.STERN_LLM_MODE = "fixture";
}
test.after(() => { db.close(); globalThis.fetch = fetchBefore; fs.rmSync(tmp, { recursive: true, force: true }); });

test("fixture coffee sequence: request, reviewable reply, schedule dry-run, invite, thank-you and audit batches", async () => {
  reset();
  const first = await feed("fx-001"); assert.equal(first.applied, 1);
  const person = q("SELECT * FROM people WHERE email=?", fixture("fx-001").expected.people[0].email);
  assert.equal(person.source, "auto_email"); assert.equal(person.status, "reached_out");
  assert.equal(q("SELECT * FROM people_affiliations WHERE person_id=?", person.id).is_eboard, 1);
  assert.equal(chatFor("fx-001").state, "requested");
  assert.equal(q("SELECT COUNT(*) n FROM stern_checklist_items WHERE club_id=? AND done_at<>''", clubFor("fx-001").id).n, 0);
  await feed("fx-002"); assert.equal(msg("fx-002").applied, "suggested");
  const suggestion = q("SELECT * FROM stern_suggestions WHERE gmail_message_id='fx-002'");
  assert.equal(JSON.parse(suggestion.proposed_data)[0].kind, "coffee");
  const accepted = await policy.acceptSuggestion(suggestion.id, { source, dryRun: true });
  assert.equal(chatFor("fx-002").state, "reply_received"); assert.equal(chatFor("fx-002").reply_needs_me, 1);
  assert.equal(q("SELECT status FROM people WHERE id=?", person.id).status, "replied");
  assert.ok(audit.batchRows(accepted.batchId).every(r => r.source === "suggestion_accept"));
  const schedule = await feed("fx-003"); assert.equal(chatFor("fx-003").state, "scheduled");
  assert.equal(chatFor("fx-003").reply_needs_me, 0); assert.equal(schedule.calendarIntents.length, 1);
  assert.match(q("SELECT event_id FROM stern_calendar_events").event_id, /^dry-run:/); assert.equal(calendarCalls, 1);
  await feed("fx-004"); assert.equal(q("SELECT COUNT(*) n FROM stern_calendar_events").n, 2);
  await feed("fx-007"); assert.equal(chatFor("fx-007").state, "thank_you_sent");
  assert.ok(q("SELECT done_at FROM stern_checklist_items WHERE club_id=? AND key='thank_yous'", clubFor("fx-007").id).done_at);
  for (const id of ["fx-001", "fx-003", "fx-004", "fx-007"]) {
    const batches = all("SELECT DISTINCT batch_id FROM stern_audit_log WHERE gmail_message_id=?", id);
    assert.equal(batches.length, 1, id); assert.ok(audit.batchRows(batches[0].batch_id).length > 1);
  }
  const before = q("SELECT COUNT(*) n FROM stern_audit_log").n;
  await feed(); assert.equal(q("SELECT COUNT(*) n FROM stern_audit_log").n, before);
});

test("all twenty fixtures: duplicate, decline, follow-up, recruiting, newsletter, assignments and safe ignores", async () => {
  reset();
  const result = await feed(...fixtures.map(f => f.id));
  assert.equal(result.failures, 0); assert.equal(result.errors, 0);
  assert.equal(msg("fx-020").applied, "duplicate");
  assert.equal(chatFor("fx-005").state, "declined");
  assert.equal(q("SELECT status FROM people WHERE email=?", fixture("fx-005").expected.people[0].email).status, "met");
  assert.equal(chatFor("fx-006").follow_up_count, 1);
  assert.ok(chatFor("fx-006").last_follow_up_at);
  assert.equal(q("SELECT status FROM stern_programs WHERE club_id=? AND track='exploratory'", clubFor("fx-010").id).status, "submitted");
  const interview = q("SELECT * FROM stern_programs WHERE club_id=? AND track='exploratory'", clubFor("fx-011").id);
  assert.equal(interview.status, "interview_invited"); assert.match(interview.dress_code, /business casual/i);
  assert.equal(q("SELECT COUNT(*) n FROM stern_tasks WHERE program_id=?", interview.id).n, 2);
  assert.equal(q("SELECT status FROM stern_programs WHERE club_id=? AND track='exploratory'", clubFor("fx-012").id).status, "accepted");
  assert.equal(q("SELECT status FROM stern_programs WHERE club_id=? AND track='exploratory'", clubFor("fx-013").id).status, "rejected");
  assert.equal(q("SELECT COUNT(*) n FROM stern_tasks WHERE dedupe_key LIKE 'icc:%'").n, 6);
  assert.equal(q("SELECT COUNT(*) n FROM assignments WHERE title='Problem Set 2'").n, 1);
  assert.equal(q("SELECT points_earned FROM assignments WHERE title='Quiz 1'").points_earned, 18);
  assert.equal(q("SELECT status FROM assignments WHERE title='Quiz 1'").status, "graded");
  assert.equal(msg("fx-017").applied, "suggested"); assert.equal(msg("fx-018").applied, "suggested"); assert.equal(msg("fx-019").applied, "ignored");
  assert.equal(q("SELECT done_at FROM stern_checklist_items WHERE club_id=? AND key='general_meeting'", clubFor("fx-009").id).done_at, "");
  for (const m of all("SELECT * FROM stern_email_messages WHERE applied='auto_applied'")) assert.equal(q("SELECT COUNT(DISTINCT batch_id) n FROM stern_audit_log WHERE gmail_account=? AND gmail_message_id=?", m.gmail_account, m.gmail_message_id).n, 1);
  assert.equal(q("SELECT COUNT(*) n FROM stern_email_messages").n, 20);
});

test("undo restores message batch and accepted suggestion without reapplying it on a repeated scan", async () => {
  reset(); await feed("fx-001");
  const batch = q("SELECT batch_id FROM stern_audit_log WHERE gmail_message_id='fx-001'").batch_id;
  assert.ok(audit.undoBatch(batch).reverted > 0);
  assert.equal(q("SELECT COUNT(*) n FROM people").n, 0); assert.equal(msg("fx-001").applied, "ignored");
  await feed(); assert.equal(q("SELECT COUNT(*) n FROM people").n, 0);
  reset(); await feed("fx-017");
  const s = q("SELECT * FROM stern_suggestions WHERE gmail_message_id='fx-017'");
  const accepted = await policy.acceptSuggestion(s.id, { dryRun: true, source });
  assert.equal(q("SELECT COUNT(*) n FROM assignments WHERE kind='exam'").n, 1);
  audit.undoBatch(accepted.batchId);
  assert.equal(q("SELECT COUNT(*) n FROM assignments WHERE kind='exam'").n, 0);
  assert.equal(q("SELECT state FROM stern_suggestions WHERE id=?", s.id).state, "pending");
});

test("calendar sync links, schedules, completes, creates thank-you drafts; cancelled events do not complete chats", async () => {
  reset(); await feed("fx-001");
  const email = fixture("fx-001").expected.people[0].email;
  calendarRows = [{ id: "stub-event", summary: "Coffee chat", start: { dateTime: "2026-09-10T16:00:00-04:00" }, end: { dateTime: "2026-09-10T16:30:00-04:00" }, attendees: [{ email }], location: "Placeholder Cafe" }];
  await calendar.runSternCalendarSync({ source, now: new Date("2026-09-10T18:00:00Z") });
  assert.equal(chatFor("fx-001").state, "scheduled");
  calendarRows[0].status = "cancelled";
  await calendar.runSternCalendarSync({ source, now: new Date("2026-09-10T22:00:00Z") });
  assert.equal(chatFor("fx-001").state, "scheduled");
  calendarRows[0].status = "confirmed";
  await calendar.runSternCalendarSync({ source, now: new Date("2026-09-10T22:00:00Z") });
  assert.equal(chatFor("fx-001").state, "done");
  const draft = q("SELECT * FROM stern_drafts WHERE kind='thank_you'"); assert.ok(draft);
  drafts.markDraftCopied(draft.id); assert.equal(q("SELECT state FROM stern_drafts WHERE id=?", draft.id).state, "copied");
  await drafts.regenerateDraft(draft.id); assert.equal(q("SELECT state FROM stern_drafts WHERE id=?", draft.id).state, "generated");
  await drafts.createGmailDraft(draft.id, { source, dryRun: true }); assert.equal(draftCalls, 1); assert.equal(q("SELECT state FROM stern_drafts WHERE id=?", draft.id).state, "generated");
  process.env.STERN_LLM_MODE = "live"; // Injected draft stub only; no classifier or connection probe runs.
  await drafts.createGmailDraft(draft.id, { source, dryRun: false }); assert.equal(q("SELECT state FROM stern_drafts WHERE id=?", draft.id).state, "gmail_draft_created");
  await drafts.createGmailDraft(draft.id, { source, dryRun: false }); assert.equal(draftCalls, 2);
  process.env.STERN_LLM_MODE = "fixture";
});

test("draft rules: reach-out request, silent three-day follow-up and five-day no-reply; off mode cannot classify or draft", async () => {
  reset();
  const people = await import("@/lib/stern/people"), rules = await import("@/lib/stern/rules-pass");
  const person = people.createPerson({ display_name: "Placeholder Contact", email: "placeholder@example.com", status: "need_to_reach_out" }).person;
  people.addAffiliation(person.id, { club_id: clubFor("fx-001").id, relevant_for_recruiting: true });
  await rules.runRulesPass();
  assert.equal(q("SELECT COUNT(*) n FROM stern_drafts WHERE kind='request'").n, 1);
  await rules.runRulesPass(); assert.equal(q("SELECT COUNT(*) n FROM stern_drafts WHERE kind='request'").n, 1);
  await feed("fx-001");
  await rules.runRulesPass({ now: new Date("2026-09-09T19:00:00Z") });
  assert.equal(q("SELECT COUNT(*) n FROM stern_drafts WHERE kind='follow_up'").n, 1);
  await rules.runRulesPass({ now: new Date("2026-09-11T19:00:00Z") }); assert.equal(chatFor("fx-001").state, "no_reply");
  process.env.STERN_LLM_MODE = "off";
  const disabled = await llm.classifyEmail({ ...sourceMod.fixtureMessage(fixture("fx-001")), account: "netid@stern.nyu.edu" });
  assert.equal(disabled.classification.category, "irrelevant"); assert.equal(disabled.classification.confidence, 0);
  await assert.rejects(llm.generateDraft("request", {}), /disabled/);
  assert.equal((await scan.runSternEmailScan()).accounts, 0);
});

test("newsletter window changes always suggest, accepting replays the exact program update", async () => {
  reset();
  const program = q("SELECT * FROM stern_programs WHERE track='exploratory' ORDER BY id LIMIT 1");
  recruiting.upsertProgram({ id: program.id, app_deadline_at: "2026-09-18" });
  await feed("fx-008");
  const suggestion = all("SELECT * FROM stern_suggestions WHERE suggestion_type='program_window'").find(s => JSON.parse(s.proposed_data)[0].programId === program.id);
  assert.ok(suggestion); assert.equal(q("SELECT app_deadline_at FROM stern_programs WHERE id=?", program.id).app_deadline_at, "2026-09-18");
  const result = await policy.acceptSuggestion(suggestion.id, { dryRun: true, source });
  assert.equal(q("SELECT app_deadline_at FROM stern_programs WHERE id=?", program.id).app_deadline_at, "2026-09-19");
  audit.undoBatch(result.batchId); assert.equal(q("SELECT app_deadline_at FROM stern_programs WHERE id=?", program.id).app_deadline_at, "2026-09-18");
});

test("account failure is isolated; watermark survives a failed fetch; off mode with a stub ignores every message", async () => {
  reset(); available.add("fx-001"); available.add("fx-020");
  const broken = { ...source, list: async (account: string, since: number) => { if (account.endsWith("@stern.nyu.edu")) throw new Error("stub account failure"); return source.list(account, since); } };
  const first = await scan.runSternEmailScan({ source: broken, dryRun: true });
  assert.equal(first.failures, 1); assert.equal(first.accounts, 2);
  assert.equal(q("SELECT last_error FROM stern_scan_state WHERE account='netid@stern.nyu.edu'").last_error, "stub account failure");
  assert.ok(msg("fx-020"));
  const failFetch = { ...source, full: async () => { throw new Error("stub fetch failure"); } };
  await scan.runSternEmailScan({ source: failFetch, dryRun: true });
  assert.equal(q("SELECT last_internal_date FROM stern_scan_state WHERE account='netid@stern.nyu.edu'").last_internal_date, 0);
  reset(); process.env.STERN_LLM_MODE = "off";
  await feed("fx-001"); assert.equal(msg("fx-001").applied, "ignored"); assert.equal(q("SELECT COUNT(*) n FROM people").n, 0);
});

test("unknown course becomes a suggestion; confidence boundaries and direction come from headers", async () => {
  reset(); db.prepare("DELETE FROM courses WHERE code='STAT-UB 103'").run();
  await feed("fx-014"); assert.equal(msg("fx-014").applied, "suggested");
  assert.match(q("SELECT suggestion_type FROM stern_suggestions WHERE gmail_message_id='fx-014'").suggestion_type, /Unknown/);
  reset(); await feed("fx-001");
  const original = msg("fx-001"), cls = fixture("fx-001").expected as EmailClassification;
  const synth = (name: string, confidence: number) => {
    const id = Number(db.prepare("INSERT INTO stern_email_messages(gmail_account,gmail_message_id,gmail_thread_id,from_addr,to_addrs,direction,internal_date,subject,classification) VALUES (?,?,?,?,?,'outbound',?,?,?)").run(original.gmail_account, name, name, original.from_addr, original.to_addrs, original.internal_date, name, JSON.stringify({ ...cls, confidence })).lastInsertRowid);
    return q("SELECT * FROM stern_email_messages WHERE id=?", id) as SternEmailMessage;
  };
  assert.equal((await policy.applyClassification(synth("boundary-low", .599), { ...cls, confidence: .599 }, { source, dryRun: true })).applied, "ignored");
  assert.equal((await policy.applyClassification(synth("boundary-suggest", .6), { ...cls, confidence: .6 }, { source, dryRun: true })).applied, "suggested");
  assert.equal((await policy.applyClassification(synth("boundary-auto", .85), { ...cls, confidence: .85 }, { source, dryRun: true })).applied, "auto_applied");
  const forged = synth("boundary-forged", .99); forged.direction = "inbound";
  assert.equal((await policy.applyClassification(forged, { ...cls, confidence: .99 }, { source, dryRun: true })).applied, "suggested");
});

test("calendar write scope failure creates one daily connect suggestion and never prevents scheduling", async () => {
  reset(); await feed("fx-001");
  const { ScopeMissing } = await import("@/lib/sources/google");
  const noScope = { ...source, createEvent: async () => { throw new ScopeMissing("calendar.events"); } };
  available.add("fx-003");
  await scan.runSternEmailScan({ source: noScope, dryRun: true });
  assert.equal(chatFor("fx-003").state, "scheduled");
  assert.equal(q("SELECT COUNT(*) n FROM stern_suggestions WHERE suggestion_type='connect calendar write'").n, 1);
  const original = msg("fx-003"), cls = fixture("fx-003").expected as EmailClassification;
  await policy.applyClassification(original, cls, { source: noScope, dryRun: true });
  assert.equal(q("SELECT COUNT(*) n FROM stern_suggestions WHERE suggestion_type='connect calendar write'").n, 1);
});

test("Google helpers retain readonly scopes, reject missing write scopes without fetching, and decode nested MIME", async () => {
  reset(); const google = await import("@/lib/sources/google");
  assert.ok(!google.SCOPE_SETS.readonly.some(s => s.endsWith("gmail.compose")));
  assert.equal(google.SCOPE_SETS.stern.length, google.SCOPE_SETS.readonly.length + 2);
  db.prepare("UPDATE google_accounts SET scopes=?").run(google.SCOPE_SETS.readonly.join(" "));
  await assert.rejects(google.gmailCreateDraft("netid@stern.nyu.edu", { to: "placeholder@example.com", subject: "Hello", body: "Hi" }), google.ScopeMissing);
  await assert.rejects(google.calendarCreateEvent("netid@stern.nyu.edu", { summary: "Coffee", startIso: "2026-09-05T12:00:00Z", endIso: "2026-09-05T12:30:00Z", attendees: [], location: "", description: "" }), google.ScopeMissing);
  await assert.rejects(google.gmailCreateDraft("netid@stern.nyu.edu", { to: "placeholder@example.com\nBcc: bad@example.com", subject: "Hello", body: "Hi" }), /Invalid draft headers/);
  assert.equal(google.decodeGmailBody({ parts: [{ mimeType: "text/html", body: { data: Buffer.from("<b>html</b>").toString("base64url") } }, { parts: [{ mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64url") } }] }] }), "plain");
  assert.match(google.decodeGmailBody({ mimeType: "text/html", body: { data: Buffer.from("<style>bad</style><b>safe &amp; text</b>").toString("base64url") } }), /safe & text/);
});

test("connection summaries distinguish unconnected, partial scopes, healthy, and disabled; Codex fixture mode never probes", async () => {
  reset(); const connections = await import("@/lib/stern/connections");
  let summary = await connections.sternConnectionSummary();
  assert.equal(summary.find(s => s.id === "stern-google-stern")!.state, "on_healthy");
  assert.equal(summary.find(s => s.id === "stern-llm-codex")!.state, "off");
  db.prepare("UPDATE google_accounts SET scopes='' WHERE email='netid@stern.nyu.edu'").run();
  summary = await connections.sternConnectionSummary();
  assert.equal(summary.find(s => s.id === "stern-google-stern")!.state, "on_broken");
  assert.match(summary.find(s => s.id === "stern-google-stern")!.detail, /Partial scopes/);
  db.prepare("DELETE FROM google_accounts WHERE email='netid@nyu.edu'").run();
  assert.equal((await connections.sternConnectionSummary()).find(s => s.id === "stern-google-nyu")!.state, "off");
  db.prepare("INSERT OR REPLACE INTO connections(service,surface,enabled) VALUES ('stern-google-stern','dashboard',0)").run();
  assert.equal((await connections.sternConnectionSummary()).find(s => s.id === "stern-google-stern")!.state, "off");
});

test("classifier validates nested schema, fixture failure is safe, and email forwarding hash is normalized", async () => {
  reset();
  const schema = JSON.parse(fs.readFileSync("docs/plans/stern/schema/email-classifier.schema.json", "utf8"));
  assert.ok(llm.validateSchema(fixture("fx-001").expected, schema));
  assert.equal(llm.validateSchema({ ...fixture("fx-001").expected, people: [{ name: "Placeholder", email: 4 }] }, schema), false);
  assert.equal(llm.validateSchema({ ...fixture("fx-001").expected, confidence: Infinity }, schema), false);
  assert.equal(llm.validateSchema({ ...fixture("fx-001").expected, surprise: true }, schema), false);
  const failed = await llm.classifyEmail({ ...sourceMod.fixtureMessage(fixture("fx-001")), id: "missing-fixture", account: "netid@stern.nyu.edu" });
  assert.equal(failed.classification.confidence, 0); assert.ok(failed.error);
  assert.equal(scan.contentHash(sourceMod.fixtureMessage(fixture("fx-002"))), scan.contentHash(sourceMod.fixtureMessage(fixture("fx-020"))));
});
