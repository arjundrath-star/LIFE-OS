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
  db.prepare("INSERT INTO stern_scan_state(account,last_error) VALUES ('netid@stern.nyu.edu','Stub scan failure')").run();
  assert.equal((await connections.sternConnectionSummary()).find(s => s.id === "stern-google-stern")!.state, "on_broken");
  db.prepare("DELETE FROM stern_scan_state").run();
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
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
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
