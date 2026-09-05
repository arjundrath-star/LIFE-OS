import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import fixtures from "./fixtures/stern/emails.json";
import type { AutomationSource } from "@/lib/stern/automation-source";
import type { EmailClassification, SternEmailMessage } from "@/lib/stern-types";
import type { GoogleCalendarEvent } from "@/lib/sources/google";
const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-automation-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "test.db");
process.env.STERN_VAULT_WRITE = "0";
process.env.STERN_LLM_MODE = "fixture";
const fetchBefore = globalThis.fetch;
let forbiddenFetches = 0;
globalThis.fetch = async () => { forbiddenFetches++; throw new Error("NETWORK CALL FORBIDDEN IN AUTOMATION TESTS"); };
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
    for (const t of ["stern_audit_log", "stern_suggestions", "stern_drafts", "stern_calendar_events", "stern_email_messages", "stern_scan_state", "stern_tasks", "assignments", "courses", "coffee_chats", "people", "stern_processes", "google_accounts", "kv", "connections"]) db.prepare(`DELETE FROM ${t}`).run();
    for (const email of ["netid@stern.nyu.edu", "netid@nyu.edu"]) db.prepare("INSERT INTO google_accounts(email,enabled,scopes,refresh_token_enc) VALUES (?,1,?,'stub')").run(email, "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events");
  }).immediate();
  for (const service of ["stern-google-stern", "stern-google-nyu"]) db.prepare("INSERT INTO connections(service,surface,enabled) VALUES (?,'dashboard',1)").run(service);
  recruiting.seedClubCatalog();
  for (const c of all("SELECT id FROM stern_clubs")) recruiting.setInterested(c.id, true);
  for (const code of ["STAT-UB 103", "MKTG-UB 1", "TECH-UB 1", "CAMS-UA 110"]) db.prepare("INSERT INTO courses(code,title) VALUES (?,?)").run(code, `Placeholder ${code}`);
  available = new Set(); calendarRows = []; calendarCalls = 0; draftCalls = 0; process.env.STERN_LLM_MODE = "fixture";
}
test.after(() => { db.close(); globalThis.fetch = fetchBefore; fs.rmSync(tmp, { recursive: true, force: true }); assert.equal(forbiddenFetches, 0); });

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
  assert.match(q("SELECT suggestion_type FROM stern_suggestions WHERE gmail_message_id='fx-014'").suggestion_type, /course/i);
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
  db.prepare("INSERT INTO stern_scan_state(account,last_error) VALUES ('netid@stern.nyu.edu','Stub scan failure')").run();
  assert.equal((await connections.sternConnectionSummary()).find(s => s.id === "stern-google-stern")!.state, "on_broken");
  db.prepare("DELETE FROM stern_scan_state").run();
  db.prepare("UPDATE google_accounts SET scopes='' WHERE email='netid@stern.nyu.edu'").run();
  summary = await connections.sternConnectionSummary();
  assert.equal(summary.find(s => s.id === "stern-google-stern")!.state, "on_broken");
  assert.match(summary.find(s => s.id === "stern-google-stern")!.detail, /Partial scopes/);
  db.prepare("DELETE FROM google_accounts WHERE email='netid@nyu.edu'").run();
  assert.equal((await connections.sternConnectionSummary()).find(s => s.id === "stern-google-nyu")!.state, "on_broken");
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

test("calendar write failures preserve replayable intent; retry after reconnect succeeds without replaying coffee effects", async () => {
  reset(); await feed("fx-001");
  const { ScopeMissing } = await import("@/lib/sources/google");
  available.add("fx-003");
  const unavailable = { ...source, createEvent: async () => { throw new ScopeMissing("calendar.events"); } };
  await scan.runSternEmailScan({ source: unavailable, dryRun: true });
  const suggestion = q("SELECT * FROM stern_suggestions WHERE suggestion_type='connect calendar write'");
  assert.equal(JSON.parse(suggestion.proposed_data)[0].kind, "calendar_create");
  await assert.rejects(policy.acceptSuggestion(suggestion.id, { source: unavailable, dryRun: true }));
  assert.equal(q("SELECT state FROM stern_suggestions WHERE id=?", suggestion.id).state, "pending");
  const touchpoints = q("SELECT COUNT(*) n FROM people_touchpoints").n;
  await policy.acceptSuggestion(suggestion.id, { source, dryRun: true });
  assert.equal(calendarCalls, 1);
  assert.equal(q("SELECT COUNT(*) n FROM people_touchpoints").n, touchpoints);
  assert.match(chatFor("fx-003").calendar_event_id, /^dry-run:/);
  assert.equal(q("SELECT state FROM stern_suggestions WHERE id=?", suggestion.id).state, "accepted");
});

test("real calendar creation can replace a dry-run intent without sending invitations", async () => {
  reset(); await feed("fx-001", "fx-003");
  const original = msg("fx-003"), cls = JSON.parse(original.classification);
  let calls = 0;
  const liveStub = { ...source, createEvent: async (_account: string, input: Parameters<AutomationSource["createEvent"]>[1]) => { calls++; return { id: input.id! }; } };
  process.env.STERN_LLM_MODE = "live";
  try {
    await policy.applyClassification(original, cls, { source: liveStub, dryRun: false });
    assert.equal(calls, 1);
    assert.doesNotMatch(chatFor("fx-003").calendar_event_id, /^dry-run:/);
    await policy.applyClassification(original, cls, { source: liveStub, dryRun: false });
    assert.equal(calls, 1);
  } finally { process.env.STERN_LLM_MODE = "fixture"; }
});

test("calendar sync preserves completed links and does not claim attendance when the owner declined", async () => {
  reset(); await feed("fx-001");
  const email = fixture("fx-001").expected.people[0].email;
  calendarRows = [{ id: "history-event", summary: "Coffee chat", start: { dateTime: "2026-09-10T16:00:00-04:00" }, end: { dateTime: "2026-09-10T16:30:00-04:00" }, attendees: [{ email }, { email: "netid@stern.nyu.edu", responseStatus: "declined" }] }];
  const sternOnly = { ...source, calendar: async (account: string) => account.endsWith("@stern.nyu.edu") ? calendarRows : [] };
  await calendar.runSternCalendarSync({ source: sternOnly, now: new Date("2026-09-11T12:00:00Z") });
  assert.equal(chatFor("fx-001").state, "no_reply"); // Five-day silence rule still applies.
  calendarRows[0].attendees![1].responseStatus = "accepted";
  await calendar.runSternCalendarSync({ source: sternOnly, now: new Date("2026-09-11T12:00:00Z") });
  assert.equal(chatFor("fx-001").state, "done");
  await feed("fx-007");
  const chatId = chatFor("fx-001").id;
  await calendar.runSternCalendarSync({ source: sternOnly, now: new Date("2026-09-11T12:00:00Z") });
  assert.equal(q("SELECT coffee_chat_id FROM stern_calendar_events WHERE event_id='history-event'").coffee_chat_id, chatId);
  assert.equal(chatFor("fx-001").state, "thank_you_sent");
});

test("Automation API authenticates, dispatches all actions, broadcasts snapshots, validates errors and tails", async () => {
  reset(); let authorized = false, broadcasts = 0;
  const require = createRequire(import.meta.url);
  const snapshot = await import("@/lib/stern/snapshot");
  const modules: Record<string, unknown> = {
    "@/lib/guard": { requireUser: async () => authorized ? { email: "netid@stern.nyu.edu" } : null },
    "@/lib/stern/gmail-scan": { runSternEmailScan: (options: object) => scan.runSternEmailScan({ ...options, source, now: new Date("2026-09-05T12:00:00Z") }) },
    "@/lib/stern/calendar-sync": { runSternCalendarSync: (options: object) => calendar.runSternCalendarSync({ ...options, source }) },
    "@/lib/stern/apply": { ...policy, acceptSuggestion: (id: number, options: object) => policy.acceptSuggestion(id, { ...options, source }) },
    "@/lib/stern/drafts": { ...drafts, createGmailDraft: (id: number, options: object) => drafts.createGmailDraft(id, { ...options, source }) },
    "@/lib/stern/audit": audit,
    "@/lib/stern/automation-source": sourceMod,
    "@/lib/stern/snapshot": { broadcastStern: () => { broadcasts++; return snapshot.sternSnapshot(); } },
    "@/lib/stern/automation-snapshot": await import("@/lib/stern/automation-snapshot"),
    "@/lib/stern/errors": await import("@/lib/stern/errors"),
    "@/lib/stern/recruiting-write": await import("@/lib/stern/recruiting-write"),
    "@/lib/sources/google": await import("@/lib/sources/google"),
  };
  const code = fs.readFileSync("app/api/stern/automation/route.ts", "utf8");
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = {} as { GET: () => Promise<Response>; POST: (req: Request) => Promise<Response> };
  new Function("require", "exports", compiled)((id: string) => modules[id] || require(id), route);
  const post = (body: unknown) => route.POST(new Request("http://localhost:3130/api/stern/automation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await route.GET()).status, 401);
  assert.equal((await post({ action: "scan.now" })).status, 401); assert.equal(broadcasts, 0);
  assert.equal(q("SELECT COUNT(*) n FROM stern_email_messages").n, 0);
  authorized = true;
  const success = async (body: object) => {
    const before = broadcasts, response = await post(body);
    assert.equal(response.status, 200, await response.clone().text()); assert.equal(broadcasts, before + 1);
    return response.json();
  };
  available.add("fx-001"); available.add("fx-002"); available.add("fx-017");
  await success({ action: "scan.now", dryRun: true });
  await success({ action: "calendar.sync_now", dryRun: true });
  const s = q("SELECT id FROM stern_suggestions WHERE gmail_message_id='fx-002'");
  await success({ action: "suggestion.accept", id: s.id, dryRun: true });
  await success({ action: "scan.now", dryRun: true }); // Rules generate the reply draft after acceptance.
  await assert.rejects(policy.acceptSuggestion(s.id, { source, dryRun: true }), /already reviewed/);
  await success({ action: "suggestion.dismiss", id: q("SELECT id FROM stern_suggestions WHERE gmail_message_id='fx-017'").id });
  const d = q("SELECT id FROM stern_drafts ORDER BY id DESC LIMIT 1");
  assert.ok(d);
  await success({ action: "draft.mark_copied", id: d.id });
  await success({ action: "draft.regenerate", id: d.id });
  await success({ action: "draft.create_gmail_draft", id: d.id, dryRun: true });
  const copy = q("SELECT batch_id FROM stern_audit_log WHERE entity_type='draft' AND entity_id=? AND field='body' ORDER BY id DESC LIMIT 1", d.id)
    || q("SELECT batch_id FROM stern_audit_log WHERE entity_type='draft' AND entity_id=? AND action='update' ORDER BY id DESC LIMIT 1", d.id);
  await success({ action: "batch.undo", batchId: copy.batch_id });
  const data = await (await route.GET()).json();
  assert.equal(data.scanState.length, 2); assert.equal(data.connections.length, 3); assert.ok(data.audit.length);
  assert.deepEqual(data.recentMessages.map((m: { id: number }) => m.id), [...data.recentMessages.map((m: { id: number }) => m.id)].sort((a: number, b: number) => a - b));
  for (const body of [null, [], { action: "invalid" }, { action: "scan.now", dryRun: "false" }, { action: "draft.regenerate", id: -1 }, { action: "batch.undo" }]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ action: "draft.mark_copied", id: 999999 })).status, 404);
  assert.equal((await route.POST(new Request("http://localhost:3130/api/stern/automation", { method: "POST", body: "{" }))).status, 400);
});

test("Google adapters paginate actual IDs, fetch decoded full messages, and create drafts/events through stub transport", async () => {
  reset(); const google = await import("@/lib/sources/google");
  const noNetwork = globalThis.fetch;
  const globals = globalThis as typeof globalThis & { __rw_gtok?: Map<string, { token: string; exp: number }> };
  const oldCache = globals.__rw_gtok;
  globals.__rw_gtok = new Map([["netid@stern.nyu.edu", { token: "fixture-token", exp: Date.now() + 600000 }]]);
  const requests: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/messages")) {
      assert.match(url.searchParams.get("q") || "", /^(newer_than:14d|after:\d+)$/);
      if (url.searchParams.get("labelIds") === "SENT") return json({ messages: [{ id: "two" }, { id: "three" }], resultSizeEstimate: 0 });
      return url.searchParams.has("pageToken") ? json({ messages: [{ id: "two" }], resultSizeEstimate: 500 }) : json({ messages: [{ id: "one" }], nextPageToken: "next", resultSizeEstimate: 0 });
    }
    if (url.pathname.endsWith("/messages/one")) return json({ id: "one", threadId: "thread", internalDate: "1788624000000", labelIds: ["INBOX"], payload: { mimeType: "text/plain", body: { data: Buffer.from("Fixture body").toString("base64url") }, headers: [{ name: "From", value: "Placeholder <placeholder@example.com>" }, { name: "To", value: "netid@stern.nyu.edu" }, { name: "Subject", value: "Fixture" }] } });
    if (url.pathname.endsWith("/drafts")) { const payload = JSON.parse(String(init!.body)); assert.match(Buffer.from(payload.message.raw, "base64url").toString(), /Content-Type: text\/plain/); return json({ id: "draft-id" }); }
    if (url.pathname.endsWith("/events") && init?.method === "POST") { assert.equal(url.searchParams.get("sendUpdates"), "none"); return json({}, 409); }
    if (url.pathname.endsWith("/events")) return json(url.searchParams.has("pageToken") ? { items: [{ id: "event-two" }] } : { items: [{ id: "event-one" }], nextPageToken: "calendar-next" });
    throw new Error(`Unexpected stub URL ${url.pathname}`);
  };
  try {
    assert.deepEqual(await google.gmailListSince("netid@stern.nyu.edu", 0), ["one", "two", "three"]);
    await google.gmailListSince("netid@stern.nyu.edu", 1788624000000);
    const message = await google.gmailFetchFull("netid@stern.nyu.edu", "one"); assert.equal(message.text, "Fixture body"); assert.equal(message.internalDate, 1788624000000);
    assert.deepEqual((await google.calendarEventsBetween("netid@stern.nyu.edu", "2026-09-05T00:00:00Z", "2026-09-19T00:00:00Z")).map(e => e.id), ["event-one", "event-two"]);
    assert.equal((await google.gmailCreateDraft("netid@stern.nyu.edu", { to: "placeholder@example.com", subject: "Fixture subject", body: "Fixture body" })).id, "draft-id");
    const event = { id: "abc123", summary: "Coffee", startIso: "2026-09-05T12:00:00Z", endIso: "2026-09-05T12:30:00Z", attendees: ["placeholder@example.com"], location: "", description: "" };
    assert.equal((await google.calendarCreateEvent("netid@stern.nyu.edu", event)).id, "abc123");
    const count = requests.length;
    assert.match((await google.calendarCreateEvent("netid@stern.nyu.edu", event, { dryRun: true })).id, /^dry-run:/);
    await google.gmailCreateDraft("netid@stern.nyu.edu", { to: "placeholder@example.com", subject: "Fixture subject", body: "Fixture body" }, { dryRun: true });
    assert.equal(requests.length, count);
    assert.ok(requests.every(r => !r.url.pathname.includes("send")));
  } finally { globalThis.fetch = noNetwork; globals.__rw_gtok = oldCache; }
});

test("later outbound thread evidence clears reply-needed even if its content is irrelevant", async () => {
  reset(); await feed("fx-001", "fx-002");
  await policy.acceptSuggestion(q("SELECT id FROM stern_suggestions WHERE gmail_message_id='fx-002'").id, { source, dryRun: true });
  assert.equal(chatFor("fx-002").reply_needs_me, 1);
  const incoming = sourceMod.fixtureMessage(fixture("fx-019"));
  const follow = { ...incoming, from: "netid@stern.nyu.edu", to: fixture("fx-002").expected.people[0].email, threadId: fixture("fx-002").threadId, internalDate: Date.parse("2026-09-07T15:00:00Z") };
  const replySource = { ...source, list: async (account: string) => account === "netid@stern.nyu.edu" ? ["fx-019"] : [], full: async () => follow };
  await scan.runSternEmailScan({ source: replySource, dryRun: true });
  assert.equal(msg("fx-019").direction, "outbound"); assert.equal(msg("fx-019").applied, "ignored");
  assert.equal(chatFor("fx-002").reply_needs_me, 0);
});

test("scheduling proposals retain times and direction, club results wait for all programs, and grades update one assignment", async () => {
  reset(); await feed("fx-001");
  const base = msg("fx-001");
  async function apply(name: string, cls: EmailClassification, direction = "inbound", body = "") {
    const f = fixture("fx-002");
    const id = Number(db.prepare("INSERT INTO stern_email_messages(gmail_account,gmail_message_id,gmail_thread_id,from_addr,to_addrs,direction,internal_date,subject,snippet,classification) VALUES (?,?,?,?,?,?,?,?,?,?)").run(base.gmail_account, name, base.gmail_thread_id, direction === "inbound" ? f.from : base.from_addr, direction === "inbound" ? f.to : base.to_addrs, direction, base.internal_date + 3600000, name, body, JSON.stringify(cls)).lastInsertRowid);
    return policy.applyClassification(q("SELECT * FROM stern_email_messages WHERE id=?", id), cls, { source, dryRun: true });
  }
  const proposal = { ...fixture("fx-002").expected, category: "scheduling_proposal", confidence: .95 } as EmailClassification;
  await apply("proposal-in", proposal); assert.equal(chatFor("fx-001").reply_needs_me, 1); assert.match(chatFor("fx-001").prep_notes, /Proposed:/);
  await apply("proposal-out", proposal, "outbound"); assert.equal(chatFor("fx-001").reply_needs_me, 0);
  const club = clubFor("fx-012");
  const accepted = fixture("fx-012").expected as EmailClassification;
  await apply("result-one", accepted); assert.notEqual(q("SELECT status FROM stern_clubs WHERE id=?", club.id).status, "accepted");
  await apply("result-two", { ...accepted, program_track: "teams" }); assert.equal(q("SELECT status FROM stern_clubs WHERE id=?", club.id).status, "accepted");
  const rejected = fixture("fx-013").expected as EmailClassification;
  await apply("rejection-one", rejected); await apply("rejection-two", { ...rejected, program_track: "teams" });
  assert.equal(q("SELECT status FROM stern_clubs WHERE id=?", clubFor("fx-013").id).status, "rejected");
  const assignment = fixture("fx-014").expected as EmailClassification;
  await apply("assignment-new", assignment);
  await apply("assignment-grade", { ...assignment, category: "brightspace_grade" }, "inbound", "Grade: 18 / 20");
  assert.equal(q("SELECT COUNT(*) n FROM assignments WHERE title=?", assignment.assignment!.title).n, 1);
  assert.equal(q("SELECT points_earned FROM assignments WHERE title=?", assignment.assignment!.title).points_earned, 18);
  const before = q("SELECT COUNT(*) n FROM stern_tasks").n;
  await apply("general-nyu-review", fixture("fx-018").expected as EmailClassification);
  assert.equal(q("SELECT COUNT(*) n FROM stern_tasks").n, before);
  await policy.acceptSuggestion(q("SELECT id FROM stern_suggestions WHERE gmail_message_id='general-nyu-review'").id, { source, dryRun: true });
  assert.ok(q("SELECT COUNT(*) n FROM stern_tasks").n > before);
});

test("account discovery uses enabled NYU domains and configured extras; calendar kinds and attendance are audited", async () => {
  reset();
  db.prepare("INSERT INTO google_accounts(email,enabled) VALUES ('extra@example.com',1),('ignored@example.com',1),('netid@alumni.nyu.edu',1),('disabled@nyu.edu',0)").run();
  db.prepare("INSERT INTO kv(k,v) VALUES ('stern.extra_accounts',?)").run(JSON.stringify(["extra@example.com"]));
  assert.deepEqual(new Set(scan.accountsToScan()), new Set(["netid@stern.nyu.edu", "netid@nyu.edu", "netid@alumni.nyu.edu", "extra@example.com"]));
  const club = clubFor("fx-009");
  const start = { dateTime: "2026-09-09T12:00:00-04:00" }, end = { dateTime: "2026-09-09T13:00:00-04:00" };
  calendarRows = [
    { id: "meeting-kind", summary: `${club.name} general meeting`, start, end, attendees: [{ email: "netid@stern.nyu.edu", responseStatus: "accepted" }] },
    { id: "interview-kind", summary: `${club.name} interview`, start, end },
    { id: "class-kind", summary: "STAT-UB 103 lecture", start, end },
  ];
  const result = await calendar.runSternCalendarSync({ source: { ...source, calendar: async (account: string) => account === "netid@stern.nyu.edu" ? calendarRows : [] }, now: new Date("2026-09-10T12:00:00Z") });
  assert.equal(result.failures, 0);
  assert.deepEqual(all("SELECT kind FROM stern_calendar_events ORDER BY id").map(e => e.kind), ["club_meeting", "interview", "class"]);
  assert.ok(q("SELECT done_at FROM stern_checklist_items WHERE club_id=? AND key='general_meeting' AND program_id=0", club.id).done_at);
  const batches = all("SELECT DISTINCT batch_id FROM stern_audit_log WHERE source='auto_calendar'");
  assert.equal(batches.length, 1);
  audit.undoBatch(batches[0].batch_id);
  assert.equal(q("SELECT COUNT(*) n FROM stern_calendar_events").n, 0);
  assert.equal(q("SELECT done_at FROM stern_checklist_items WHERE club_id=? AND key='general_meeting' AND program_id=0", club.id).done_at, "");
});

test("notification-sender invites link by attendee identity; outbound CC recipients are retained", async () => {
  reset(); await feed("fx-001");
  const invite = { ...sourceMod.fixtureMessage(fixture("fx-004")), from: "Google Calendar <calendar-notification@google.com>" };
  const inviteSource = { ...source, list: async (account: string) => account === fixture("fx-004").account ? ["fx-004"] : [], full: async () => invite };
  await scan.runSternEmailScan({ source: inviteSource, dryRun: true });
  assert.equal(msg("fx-004").applied, "auto_applied");
  assert.equal(q("SELECT COUNT(*) n FROM people").n, 1);
  assert.equal(q("SELECT coffee_chat_id FROM stern_calendar_events").coffee_chat_id, chatFor("fx-001").id);
  reset();
  const request = { ...sourceMod.fixtureMessage(fixture("fx-001")), cc: "Placeholder Recipient <cc.placeholder@example.com>" };
  await scan.runSternEmailScan({ source: { ...source, list: async (account: string) => account === fixture("fx-001").account ? ["fx-001"] : [], full: async () => request }, dryRun: true });
  assert.match(msg("fx-001").to_addrs, /cc.placeholder@example.com/);
  assert.equal(q("SELECT COUNT(*) n FROM people").n, 2);
});

// Load the real boundary with only its external dependencies replaced; no provider calls.
function loadTs<T>(file: string, replacements: Record<string, unknown>): T {
  const require = createRequire(path.resolve(file));
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((id: string) => replacements[id] || require(id), exports);
  return exports as T;
}

test("classifier failures retry behind the watermark, stay visible, cool down and recover without losing evidence", async () => {
  reset(); available.add("fx-001"); available.add("fx-003");
  let broken = true, attempts = 0;
  const retryScan = loadTs<typeof scan>("lib/stern/gmail-scan.ts", {
    "./llm": { ...llm, classifyEmail: async (m: Parameters<typeof llm.classifyEmail>[0]) => {
      if (m.id === "fx-001") { attempts++; if (broken) return { classification: { ...fixture("fx-001").expected, category: "irrelevant", confidence: 0 }, error: "Stub transient classifier timeout" }; }
      return llm.classifyEmail(m);
    } },
  });
  const options = { source, dryRun: true, now: new Date("2026-09-05T12:00:00Z") };
  const first = await retryScan.runSternEmailScan(options);
  assert.equal(first.errors, 1); assert.equal(first.failures, 0);
  assert.equal(msg("fx-001").applied, "error"); assert.match(msg("fx-001").error, /attempt 1/);
  assert.ok(q("SELECT last_internal_date FROM stern_scan_state WHERE account=?", fixture("fx-001").account).last_internal_date > msg("fx-001").internal_date);
  assert.match(q("SELECT last_error FROM stern_scan_state WHERE account=?", fixture("fx-001").account).last_error, /1 message/);
  const summary = await (await import("@/lib/stern/connections")).sternConnectionSummary();
  assert.equal(summary.find(s => s.id === "stern-google-stern")!.state, "on_broken");
  assert.equal((await import("@/lib/stern/automation-snapshot")).automationDetails().messageErrors.length, 1);
  assert.equal(q("SELECT COUNT(*) n FROM stern_audit_log WHERE gmail_message_id='fx-001'").n, 0);
  await retryScan.runSternEmailScan(options); await retryScan.runSternEmailScan(options);
  assert.equal(attempts, 3); assert.match(msg("fx-001").error, /attempt 3/);
  await retryScan.runSternEmailScan(options); assert.equal(attempts, 3);
  broken = false;
  db.prepare("UPDATE stern_email_messages SET processed_at=? WHERE gmail_message_id='fx-001'").run(new Date(Date.now() - 7 * 3600000).toISOString());
  await retryScan.runSternEmailScan(options);
  assert.equal(attempts, 4); assert.equal(msg("fx-001").applied, "auto_applied"); assert.equal(msg("fx-001").error, "");
  assert.equal(q("SELECT last_error FROM stern_scan_state WHERE account=?", fixture("fx-001").account).last_error, "");
  assert.equal((await import("@/lib/stern/automation-snapshot")).automationDetails().messageErrors.length, 0);
});

test("malformed full messages cannot block later mail, and failed fetches retry after the cursor advances", async () => {
  reset(); available.add("fx-001"); available.add("fx-003"); let fail = true;
  const flaky = { ...source, full: async (account: string, id: string) => {
    if (id === "fx-001" && fail) throw new Error("Stub message cannot be decoded");
    return source.full(account, id);
  } };
  const result = await scan.runSternEmailScan({ source: flaky, dryRun: true });
  assert.equal(result.failures, 0); assert.equal(result.errors, 1);
  assert.equal(msg("fx-001").applied, "error"); assert.equal(msg("fx-003").applied, "auto_applied");
  assert.match(msg("fx-001").error, /cannot be decoded/);
  fail = false; await scan.runSternEmailScan({ source: flaky, dryRun: true });
  assert.equal(msg("fx-001").applied, "auto_applied"); assert.equal(msg("fx-001").internal_date, Date.parse(fixture("fx-001").date));
  const google = await import("@/lib/sources/google");
  const body = "&#1114112;&#9999999999999999999999999999999999999;&#65;&#128512;";
  assert.equal(google.decodeGmailBody({ mimeType: "text/html", body: { data: Buffer.from(body).toString("base64url") } }), "A😀");
});

test("disabled Google rows stop scans, calendar reads and writes, rules and Gmail draft creation", async () => {
  reset(); available.add("fx-001");
  db.prepare("UPDATE connections SET enabled=0").run();
  const forbidden = async (): Promise<never> => { throw new Error("Disabled source was called"); };
  const disabled: AutomationSource = { list: forbidden, full: forbidden, calendar: forbidden, createEvent: forbidden, createDraft: forbidden };
  assert.equal((await scan.runSternEmailScan({ source: disabled })).accounts, 0);
  assert.equal((await calendar.runSternCalendarSync({ source: disabled })).accounts, 0);
  assert.equal(q("SELECT COUNT(*) n FROM stern_email_messages").n, 0);
  assert.equal(q("SELECT COUNT(*) n FROM stern_scan_state").n, 0);
  assert.equal(sourceMod.sternAccount(), "");
  db.prepare("UPDATE connections SET enabled=1 WHERE service='stern-google-stern'").run();
  await feed("fx-001", "fx-002");
  await policy.acceptSuggestion(q("SELECT id FROM stern_suggestions WHERE gmail_message_id='fx-002'").id, { source, dryRun: true });
  await feed(); const draft = q("SELECT id FROM stern_drafts LIMIT 1"); assert.ok(draft);
  db.prepare("UPDATE connections SET enabled=0").run();
  await assert.rejects(drafts.createGmailDraft(draft.id, { source: disabled, dryRun: true }), /Connect a Stern/);
  const cls = fixture("fx-003").expected as EmailClassification;
  await policy.applyClassification(msg("fx-001"), cls, { source: disabled, dryRun: true });
  assert.equal(q("SELECT COUNT(*) n FROM stern_calendar_events").n, 0);
  assert.ok(q("SELECT id FROM stern_suggestions WHERE suggestion_type='connect calendar write'"));
});

test("undo keeps classifier evidence and audit tails contain only domain effects, including legacy batches", async () => {
  reset(); await feed("fx-001", "fx-019");
  const before = msg("fx-001"); const batch = q("SELECT batch_id FROM stern_audit_log WHERE gmail_message_id='fx-001'").batch_id;
  assert.equal(q("SELECT COUNT(*) n FROM stern_audit_log WHERE entity_type='email_message'").n, 0);
  // A pre-fix bookkeeping row must not erase evidence when its legacy batch is undone.
  audit.logChange({ entityType: "email_message", entityId: before.id, action: "update", field: "classification", before: "", after: before.classification, source: "auto_email", batchId: batch });
  assert.equal(audit.auditTail(500).filter(a => a.entity_type === "email_message").length, 0);
  assert.equal((await import("@/lib/stern/snapshot")).sternSnapshot().autoAppliedToday.filter(a => (a as { entity_type: string }).entity_type === "email_message").length, 0);
  audit.undoBatch(batch);
  assert.equal(msg("fx-001").applied, "ignored");
  assert.equal(msg("fx-001").classification, before.classification); assert.equal(msg("fx-001").category, before.category); assert.equal(msg("fx-001").confidence, before.confidence);
  assert.equal(q("SELECT COUNT(*) n FROM people").n, 0);
});

test("calendar permission suggestions reopen after dismissal or acceptance and use the New York day", async () => {
  reset(); await feed("fx-001"); const { ScopeMissing } = await import("@/lib/sources/google");
  const noScope = { ...source, createEvent: async () => { throw new ScopeMissing("calendar.events"); } };
  const fixed = new Date("2026-09-06T01:30:00Z");
  const dateDb = await import("@/db");
  const nyPolicy = loadTs<typeof policy>("lib/stern/apply.ts", {
    "./time": { ...await import("@/lib/stern/time"), nyDateKey: () => "2026-09-05" },
    "@/db": { ...dateDb, nowIso: () => fixed.toISOString() },
  });
  const cls = fixture("fx-003").expected as EmailClassification;
  const message = { ...msg("fx-001"), classification: JSON.stringify(cls) };
  await nyPolicy.applyClassification(message, cls, { source: noScope, dryRun: true });
  let suggestion = q("SELECT * FROM stern_suggestions WHERE suggestion_type='connect calendar write'");
  assert.match(suggestion.dedupe_key, /:2026-09-05$/);
  nyPolicy.dismissSuggestion(suggestion.id);
  const next = { ...cls, confirmed_time: "2026-09-12T15:00:00-04:00" };
  await nyPolicy.applyClassification(message, next, { source: noScope, dryRun: true });
  suggestion = q("SELECT * FROM stern_suggestions WHERE id=?", suggestion.id);
  assert.equal(suggestion.state, "pending"); assert.equal(suggestion.reviewed_at, "");
  assert.equal(JSON.parse(suggestion.proposed_data)[0].intent.start, next.confirmed_time);
  assert.equal(q("SELECT COUNT(*) n FROM stern_suggestions WHERE suggestion_type='connect calendar write'").n, 1);
  db.prepare("UPDATE stern_suggestions SET state='accepted' WHERE id=?").run(suggestion.id);
  await nyPolicy.applyClassification(message, { ...next, confirmed_time: "2026-09-13T15:00:00-04:00" }, { source: noScope, dryRun: true });
  assert.equal(q("SELECT state FROM stern_suggestions WHERE id=?", suggestion.id).state, "pending");
  assert.ok((await import("@/lib/stern/time")).nyDateKey(fixed) === "2026-09-05");
});

test("explicit Stern OAuth scope choice preserves Career readonly and surfaces tenant denial in Stern only", async () => {
  reset(); const google = await import("@/lib/sources/google"); const dbModule = await import("@/db");
  let chosen = "", authorized = true;
  const route = loadTs<{ GET: (r: Request) => Promise<Response> }>("app/api/google/connect/route.ts", {
    "@/lib/guard": { requireUser: async () => authorized ? { email: "netid@nyu.edu" } : null },
    "@/lib/sources/google": { connectUrl: (_state: string, options: { scopeSet: string }) => { chosen = options.scopeSet; return "https://example.com/consent"; } },
  });
  for (const [query, want] of [["target=nyu", "readonly"], ["target=generic", "readonly"], ["target=stern", "readonly"], ["target=nyu&set=stern", "stern"], ["target=stern&set=stern", "stern"], ["target=stern&set=readonly", "readonly"]]) {
    const res = await route.GET(new Request(`http://localhost:3130/api/google/connect?${query}`));
    assert.equal(chosen, want); assert.match(res.headers.get("set-cookie")!, new RegExp(`rw_g_scope_set=${want}`));
  }
  authorized = false; chosen = "";
  await route.GET(new Request("http://localhost:3130/api/google/connect?set=stern")); assert.equal(chosen, ""); authorized = true;
  const enabled: string[] = [];
  const callback = loadTs<{ GET: (r: Request) => Promise<Response> }>("app/api/google/callback/route.ts", {
    "@/lib/guard": { requireUser: async () => ({ email: "netid@nyu.edu" }) },
    "@/lib/connections": { ensureSeeded: () => {}, refreshAll: async () => [], setEnabled: (id: string) => enabled.push(id) },
    "@/server/live": { getHub: () => ({ broadcast: () => {} }) },
    "@/db": dbModule,
    "@/lib/sources/google": { ...google, handleCallback: async () => ({ email: "netid@stern.nyu.edu" }), pollEmailAccounts: async () => {}, emailSnapshots: () => [] },
  });
  for (const target of ["stern", "nyu"]) {
    await callback.GET(new Request("http://localhost:3130/api/google/callback?error=access_denied&state=abc", { headers: { cookie: `rw_g_state=abc; rw_g_target=${target}; rw_g_scope_set=stern` } }));
    assert.match(dbModule.kvGet<string>(`stern.google.${target}_error`)!, /NYU tenant approval/);
    assert.equal(dbModule.kvGet(`career.google.${target}_error`), undefined);
    db.prepare("DELETE FROM google_accounts WHERE email=?").run(`netid@${target === "stern" ? "stern." : ""}nyu.edu`);
  }
  const states = await (await import("@/lib/stern/connections")).sternConnectionSummary();
  for (const state of states.filter(s => s.id.startsWith("stern-google"))) { assert.equal(state.state, "on_broken"); assert.match(state.detail, /tenant approval/); }
  await callback.GET(new Request("http://localhost:3130/api/google/callback?code=stub&state=abc", { headers: { cookie: "rw_g_state=abc; rw_g_target=stern; rw_g_scope_set=stern" } }));
  assert.equal(dbModule.kvGet("stern.google.stern_error"), ""); assert.equal(dbModule.kvGet("career.google.stern_error"), undefined);
  assert.ok(enabled.includes("stern-google-stern")); assert.ok(!enabled.includes("career-google-stern"));
});

test("fresh connections seed disabled; enabled missing accounts stay broken consistently through refresh", async () => {
  reset(); db.prepare("DELETE FROM connections").run(); db.prepare("DELETE FROM google_accounts").run();
  const { sternConnections } = await import("@/lib/stern/connections");
  const connections = loadTs<typeof import("@/lib/connections")>("lib/connections/index.ts", {
    "@/lib/connections/registry": { REGISTRY: sternConnections, getDef: (id: string) => sternConnections.find(d => d.id === id) },
  });
  connections.ensureSeeded();
  for (const state of connections.getStates()) { assert.equal(state.enabled, false); assert.equal(state.state, "off"); }
  connections.setEnabled("stern-google-stern", "dashboard", true);
  const first = (await connections.refreshAll(sternConnections)).find(s => s.service === "stern-google-stern")!;
  assert.equal(first.enabled, true); assert.equal(first.state, "on_broken"); assert.match(first.detail!, /Connect an/);
  const second = (await connections.refreshAll(sternConnections)).find(s => s.service === "stern-google-stern")!;
  assert.equal(second.state, first.state);
});

test("Codex boundary uses stdin, a minimal environment, isolated config and a local executable stub", async () => {
  reset();
  const saved = Object.fromEntries(["STERN_LLM_MODE", "STERN_CODEX_BIN", "CODEX_HOME", "TMPDIR", "GOOGLE_CLIENT_SECRET"].map(k => [k, process.env[k]]));
  const bin = path.join(tmp, "codex-stub.cjs"), capture = path.join(tmp, "codex-capture.json");
  const authDir = path.join(tmp, "fake-auth"); fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, "auth.json"), "{}");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, input, keys: Object.keys(process.env), home: process.env.CODEX_HOME }));
  const result = input.startsWith('Write ') ? {subject:'Follow up',body:'Hi Placeholder,\\nCould we speak about the club next week?\\nArjun.'} : ${JSON.stringify(fixture("fx-001").expected)};
  fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(result));
});
`, { mode: 0o700 });
  db.prepare("INSERT INTO connections(service,surface,enabled) VALUES ('stern-llm-codex','dashboard',1)").run();
  process.env.STERN_LLM_MODE = "live"; process.env.STERN_CODEX_BIN = bin; process.env.CODEX_HOME = authDir; process.env.TMPDIR = tmp;
  process.env.GOOGLE_CLIENT_SECRET = "synthetic-must-not-reach-child";
  try {
    const result = await llm.classifyEmail({ ...sourceMod.fixtureMessage(fixture("fx-001")), account: fixture("fx-001").account,
      text: "漢".repeat(30000), from: "x".repeat(60000) + " <placeholder@example.com>", headers: [{ name: "X-Private", value: "omit-raw-headers" }] });
    assert.equal(result.error, ""); assert.equal(result.classification.category, "coffee_chat_request_sent");
    const ran = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.equal(ran.args.at(-1), "-"); assert.ok(Buffer.byteLength(ran.input) > 131072);
    assert.ok(!ran.args.some((arg: string) => arg.includes("漢"))); assert.doesNotMatch(ran.input, /omit-raw-headers/);
    assert.ok(!ran.keys.includes("GOOGLE_CLIENT_SECRET"));
    assert.ok(ran.keys.every((key: string) => ["NODE_ENV", "PATH", "HOME", "LANG", "TMPDIR", "CODEX_HOME"].includes(key)));
    assert.ok(!fs.existsSync(ran.home)); // isolated runtime removed after the call
    const draft = await llm.generateDraft("follow_up", {}); assert.match(draft.body, /Arjun\.$/);
    db.prepare("UPDATE connections SET enabled=0 WHERE service='stern-llm-codex'").run();
    const denied = await llm.classifyEmail({ ...sourceMod.fixtureMessage(fixture("fx-001")), account: fixture("fx-001").account });
    assert.match(denied.error, /disabled/);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("message claims exclude a competing scanner and stale claims recover", async () => {
  reset(); available.add("fx-001");
  let announce!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const competing = loadTs<typeof scan>("lib/stern/gmail-scan.ts", {
    "./automation-source": { ...sourceMod, automationJob: (fn: () => Promise<unknown>) => fn() },
    "./llm": { ...llm, classifyEmail: async (m: Parameters<typeof llm.classifyEmail>[0]) => { calls++; announce(); await held; return llm.classifyEmail(m); } },
  });
  const first = competing.runSternEmailScan({ source, dryRun: true });
  await started;
  try {
    assert.equal(msg("fx-001").applied, "pending"); assert.ok(msg("fx-001").processed_at);
    assert.equal((await scan.runSternEmailScan({ source, dryRun: true })).messages, 0);
  } finally { release(); }
  await first; assert.equal(calls, 1);
  assert.equal(q("SELECT COUNT(*) n FROM people_touchpoints WHERE gmail_message_id='fx-001'").n, 1);
  db.prepare("UPDATE stern_email_messages SET applied='pending',processed_at=? WHERE gmail_message_id='fx-001'").run(new Date(Date.now() - 11 * 60000).toISOString());
  await competing.runSternEmailScan({ source, dryRun: true });
  assert.equal(calls, 2); assert.equal(msg("fx-001").applied, "auto_applied");
  assert.equal(q("SELECT COUNT(*) n FROM people_touchpoints WHERE gmail_message_id='fx-001'").n, 1);
});

test("manual forwarded envelopes collapse by original sender and duplicate rows cannot suppress the original", async () => {
  reset();
  const original = { from: "Sender <sender@example.com>", subject: "Club update", text: "Same content" };
  const forward = { from: "netid@nyu.edu", subject: "Fwd: Club update", text: "---------- Forwarded message ----------\nFrom: Sender <sender@example.com>\nDate: Tue\nSubject: Club update\nTo: netid@nyu.edu\n\nSame content" };
  assert.equal(scan.contentHash(original), scan.contentHash(forward));
  const full = sourceMod.fixtureMessage(fixture("fx-001"));
  db.prepare("INSERT INTO stern_email_messages(gmail_account,gmail_message_id,content_hash,internal_date,applied) VALUES ('netid@nyu.edu','old-duplicate',?,?,'duplicate')").run(scan.contentHash(full), full.internalDate);
  await feed("fx-001"); assert.equal(msg("fx-001").applied, "auto_applied");
});

test("new requests get a new chat after terminal outcomes; meetings dedupe on New York dates", async () => {
  reset(); await feed("fx-001", "fx-003", "fx-007");
  const finished = chatFor("fx-001"), message = msg("fx-001");
  const next = { ...message, gmail_message_id: "new-request", gmail_thread_id: "new-thread", internal_date: Date.parse("2026-09-15T12:00:00Z") };
  await policy.applyClassification(next, fixture("fx-001").expected as EmailClassification, { source, dryRun: true });
  assert.notEqual(chatFor("fx-001").id, finished.id); assert.equal(chatFor("fx-001").state, "requested");
  assert.equal(q("SELECT state FROM coffee_chats WHERE id=?", finished.id).state, "thank_you_sent");
  const meeting = { ...fixture("fx-001").expected, category: "club_general_meeting", confirmed_time: "2026-09-08T01:00:00Z" } as EmailClassification;
  await policy.applyClassification(message, meeting, { source, dryRun: true });
  await policy.applyClassification(message, { ...meeting, confirmed_time: "2026-09-07T21:00:00-04:00" }, { source, dryRun: true });
  const meetings = all("SELECT * FROM stern_tasks WHERE dedupe_key LIKE 'meeting:%'");
  assert.equal(meetings.length, 1); assert.equal(meetings[0].due_at, "2026-09-07");
});

test("failed draft generation cools down for six hours and retries without inventing a draft", async () => {
  reset(); await feed("fx-001"); let calls = 0, fails = true;
  const cooldown = loadTs<typeof drafts>("lib/stern/drafts.ts", { "./llm": { ...llm, generateDraft: async () => { calls++; if (fails) throw new Error("Stub draft failure"); return { subject: "Hello", body: "Hi Placeholder,\nArjun" }; } } });
  const chat = chatFor("fx-001"), meta = { source: "agent", batchId: audit.newBatchId("test") };
  await assert.rejects(cooldown.ensureDraft(chat.id, "request", meta), /Stub draft failure/);
  assert.equal(await cooldown.ensureDraft(chat.id, "request", meta), null); assert.equal(calls, 1);
  assert.equal(q("SELECT COUNT(*) n FROM stern_drafts WHERE kind='request'").n, 0);
  (await import("@/db")).kvSet(`stern.draft_fail:${chat.id}:request`, { at: Date.now() - 7 * 3600000, error: "Stub failure" });
  fails = false; assert.ok(await cooldown.ensureDraft(chat.id, "request", meta)); assert.equal(calls, 2);
});

test("merged WP4 helpers dedupe assignment punctuation, record grades and reject malformed task dates", async () => {
  reset(); await feed("fx-014");
  const message = msg("fx-014"), cls = JSON.parse(message.classification) as EmailClassification;
  const assignment = { ...cls, assignment: { ...cls.assignment!, title: "HW #3: Regression" } };
  await policy.applyClassification(message, assignment, { source, dryRun: true });
  await policy.applyClassification(message, { ...assignment, assignment: { ...assignment.assignment, title: "HW 3 Regression" } }, { source, dryRun: true });
  const classes = await import("@/lib/stern/classes");
  assert.equal(q("SELECT COUNT(*) n FROM assignments WHERE dedupe_key=?", classes.assignmentKey(cls.course_code!, "HW 3 Regression")).n, 1);
  const invalid = { ...cls, category: "icc_newsletter", deadline_mentions: [{ label: "Malformed deadline", date: "next Friday" }] } as EmailClassification;
  assert.equal((await policy.applyClassification(message, invalid, { source, dryRun: true })).applied, "suggested");
  assert.equal(q("SELECT COUNT(*) n FROM stern_tasks WHERE due_at='next Friday'").n, 0);
});
