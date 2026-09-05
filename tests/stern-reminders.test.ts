import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fixture from "./fixtures/stern/reminders.json";
import type { NotificationRunner } from "@/lib/stern/email-send";
import type { SternReminder } from "@/lib/stern-types";
const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-reminders-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "test.db");
process.env.STERN_NOTIFY_DRY_RUN = "1";
process.env.STERN_LLM_MODE = "off";
process.env.STERN_VAULT_WRITE = "0";
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network forbidden in reminder tests"); };
let db: ReturnType<typeof import("@/db")["getDb"]>;
let rules: typeof import("@/lib/stern/reminders");
let notify: typeof import("@/lib/stern/notify");
let store: typeof import("@/lib/stern/reminder-store");
let memo: typeof import("@/lib/stern/memo");
let audit: typeof import("@/lib/stern/audit");
let settings: typeof import("@/lib/stern/notification-settings");
let time: typeof import("@/lib/stern/time");
const now = new Date(fixture.date);
const rows = () => db.prepare("SELECT * FROM stern_reminders ORDER BY id").all() as SternReminder[];
const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const forbidden: NotificationRunner = async () => { assert.fail("Dry-run spawned a process"); };
const calls: { file: string; args: string[]; options: Parameters<NotificationRunner>[2] }[] = [];
const runner: NotificationRunner = async (file, args, options) => { calls.push({ file, args, options }); return { stdout: file === "python3" ? "bWltZQ==\n" : "ok" }; };
function add(rule: string, fireAt: string, urgent = false) {
  return store.queueReminder({ rule, entity: "test", entityId: 0, fireAt, message: { key: `${rule}:${fireAt}`, subject: "Test", body: "Test body", urgent, scheduledAt: fireAt } }).reminder;
}
test.before(async () => {
  db = (await import("@/db")).getDb();
  rules = await import("@/lib/stern/reminders"); notify = await import("@/lib/stern/notify"); store = await import("@/lib/stern/reminder-store");
  memo = await import("@/lib/stern/memo"); audit = await import("@/lib/stern/audit"); settings = await import("@/lib/stern/notification-settings"); time = await import("@/lib/stern/time");
});
test.beforeEach(() => {
  db.exec("DELETE FROM stern_reminders; DELETE FROM stern_audit_log; DELETE FROM coffee_chats; DELETE FROM people; DELETE FROM stern_programs; DELETE FROM stern_clubs; DELETE FROM stern_processes; DELETE FROM stern_tasks; DELETE FROM stern_suggestions; DELETE FROM stern_calendar_events; DELETE FROM courses; DELETE FROM endeavors; DELETE FROM kv WHERE k LIKE 'stern.%'");
  db.prepare("INSERT INTO stern_processes(id,slug,name) VALUES(1,'test-process','Test recruiting')").run();
  db.prepare("INSERT INTO stern_clubs(id,process_id,name,slug,interested) VALUES(1,1,?,'test-club',1)").run(fixture.club);
  db.prepare("INSERT INTO people(id,display_name) VALUES(1,?)").run(fixture.person);
  calls.length = 0; process.env.STERN_NOTIFY_DRY_RUN = "1";
});
test.afterEach(() => {
  for (const reminder of rows()) {
    const message = store.reminderMessage(reminder);
    assert.doesNotMatch(message.subject + message.body, /[\u2013\u2014]/);
  }
});
test.after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); globalThis.fetch = originalFetch; });

test("all deadline offsets, interview eve, task and daily suggestion rules are idempotent and audited", () => {
  for (const [i, day] of ["07", "08", "10", "14"].entries()) db.prepare("INSERT INTO stern_programs(id,club_id,name,status,app_deadline_at,interview_at) VALUES(?,1,?,'open',?,'')").run(i + 1, `Track ${i}`, `2026-09-${day}`);
  for (const [i, day] of ["07", "08", "10", "14"].entries()) db.prepare("INSERT INTO stern_programs(id,club_id,name,status,interview_at) VALUES(?,1,?,'interview_invited',?)").run(i + 5, `Interview ${i}`, `2026-09-${day}T20:00:00Z`);
  db.prepare("UPDATE stern_programs SET dress_code='Business formal',interview_location='Room A' WHERE id=6").run();
  db.prepare("INSERT INTO stern_tasks(title,due_at) VALUES(?,'2026-09-07')").run(fixture.task);
  db.prepare("INSERT INTO stern_suggestions(dedupe_key) VALUES('fixture-suggestion')").run();
  const first = rules.evaluateRules(now);
  assert.equal(first.inserted, 10); assert.equal(rules.evaluateRules(now).inserted, 0);
  for (const rule of ["deadline_day", "deadline_t1", "deadline_t3", "deadline_t7"]) assert.equal(rows().filter(r => r.rule_key === rule).length, 2);
  assert.equal(n("SELECT COUNT(DISTINCT batch_id) n FROM stern_audit_log"), 1);
  const evening = rules.evaluateRules(new Date("2026-09-07T22:00:00Z"));
  assert.equal(evening.inserted, 1);
  const eve = store.reminderMessage(rows().find(r => r.rule_key === "interview_eve")!);
  assert.match(eve.body, /Business formal/); assert.match(eve.body, /Room A/);
  assert.equal(rules.evaluateRules(new Date("2026-09-07T22:01:00Z")).inserted, 0);
});

test("reply owed begins at 30 minutes, repeats every four hours, and stops after a reply", async () => {
  db.exec("INSERT INTO coffee_chats(id,person_id,state,reply_needs_me,reply_at) VALUES(1,1,'reply_received',1,'2026-09-07T11:30:00Z')");
  assert.equal(rules.evaluateRules(new Date("2026-09-07T11:59:59Z")).inserted, 0);
  assert.equal(rules.evaluateRules(now).inserted, 1);
  assert.equal(store.reminderMessage(rows()[0]).urgent, true);
  await rules.dispatchDue(now, { runner: forbidden });
  assert.equal(rules.evaluateRules(new Date("2026-09-07T15:59:59Z")).inserted, 0);
  assert.equal(rules.evaluateRules(new Date("2026-09-07T16:00:00Z")).inserted, 1);
  db.exec("UPDATE coffee_chats SET reply_needs_me=0");
  assert.equal((await rules.dispatchDue(new Date("2026-09-07T16:00:00Z"), { runner: forbidden })).skipped, 1);
  assert.equal(rows()[1].error, "no-longer-applicable");
});

test("thank-you escalates at 22 hours and no-reply nudges stop after follow-up", async () => {
  db.exec("INSERT INTO coffee_chats(id,person_id,state,occurred_at) VALUES(1,1,'done','2026-09-06T16:00:00Z'); INSERT INTO coffee_chats(id,person_id,state,requested_at) VALUES(2,1,'requested','2026-09-04T12:00:00Z')");
  assert.equal(rules.evaluateRules(new Date("2026-09-07T11:59:59Z")).inserted, 0);
  assert.equal(rules.evaluateRules(now).inserted, 2);
  assert.equal(store.reminderMessage(rows()[0]).urgent, false);
  assert.equal(rules.evaluateRules(new Date("2026-09-07T14:00:00Z")).inserted, 1);
  assert.equal(store.reminderMessage(rows()[2]).urgent, true);
  db.exec("UPDATE coffee_chats SET last_follow_up_at='2026-09-07T13:00:00Z' WHERE id=2; UPDATE coffee_chats SET state='thank_you_sent',thank_you_sent_at='2026-09-07T13:00:00Z' WHERE id=1");
  assert.equal((await rules.dispatchDue(new Date("2026-09-07T14:00:00Z"), { runner: forbidden })).skipped, 3);
});

test("quiet hours snooze to 07:00 NY; urgent bypass and snooze dedupe survive reevaluation", async () => {
  const night = new Date("2026-09-08T03:00:00Z");
  db.exec("INSERT INTO coffee_chats(id,person_id,state,requested_at) VALUES(1,1,'requested','2026-09-05T03:00:00Z')");
  rules.evaluateRules(night); add("urgent", night.toISOString(), true);
  assert.deepEqual(await rules.dispatchDue(night, { runner: forbidden }), { sent: 0, failed: 0, skipped: 1, snoozed: 1 });
  assert.equal(rows()[0].fire_at, "2026-09-08T11:00:00.000Z");
  assert.equal(rules.evaluateRules(new Date("2026-09-08T03:01:00Z")).inserted, 0);
  assert.equal((await rules.dispatchDue(new Date("2026-09-08T11:00:00Z"), { runner: forbidden })).skipped, 1);
  assert.equal(rows()[0].error, "dry-run");
});

test("quiet-hour boundaries and DST use local wall time rather than 24-hour offsets", () => {
  assert.equal(rules.quietUntil(new Date("2026-09-08T02:59:59Z")), null);
  assert.equal(rules.quietUntil(new Date("2026-09-08T10:59:59Z"))?.toISOString(), "2026-09-08T11:00:00.000Z");
  assert.equal(rules.quietUntil(new Date("2026-09-08T11:00:00Z")), null);
  assert.equal(rules.quietUntil(new Date("2026-03-08T05:00:00Z"))?.toISOString(), "2026-03-08T11:00:00.000Z");
  assert.equal(rules.quietUntil(new Date("2026-11-01T04:00:00Z"))?.toISOString(), "2026-11-01T12:00:00.000Z");
  assert.equal(time.nyWallTime("2026-03-08").toISOString(), "2026-03-08T12:00:00.000Z");
  settings.updateNotificationSettings({ "stern.quiet_hours_start": "12:00", "stern.quiet_hours_end": "13:00" });
  assert.equal(rules.quietUntil(new Date("2026-09-07T16:30:00Z"))?.toISOString(), "2026-09-07T17:00:00.000Z");
});

test("manual snooze and settings changes undo with exact prior state and validation", () => {
  const reminder = add("test", now.toISOString());
  rules.snoozeReminder(reminder.id, "2026-09-08T12:00:00Z", now);
  const batch = db.prepare("SELECT batch_id FROM stern_audit_log WHERE entity_type='reminder' ORDER BY id DESC LIMIT 1").get() as { batch_id: string };
  audit.undoBatch(batch.batch_id);
  assert.equal(store.reminderRow(reminder.id).fire_at, now.toISOString());
  assert.equal(store.reminderRow(reminder.id).delivery_status, "pending");
  const changed = settings.updateNotificationSettings({ "stern.memo_email": "sample@example.com" });
  assert.equal(settings.notificationSettings()["stern.memo_email"], "sample@example.com");
  audit.undoBatch(changed.batchId);
  assert.equal(db.prepare("SELECT 1 FROM kv WHERE k='stern.memo_email'").get(), undefined);
  for (const input of [{ "stern.hermes_alias": "sh -c bad" }, { "stern.memo_email": "bad\n@example.com" }, { "stern.quiet_hours_end": "25:00" }, { "stern.memo_last_date": "2026-09-07" }, { unrelated: "value" }]) assert.throws(() => settings.updateNotificationSettings(input));
  assert.throws(() => rules.snoozeReminder(reminder.id, "yesterday", now));
  assert.throws(() => rules.snoozeReminder(reminder.id, "2026-09-06T12:00:00Z", now));
});

test("dry-run never invokes even an injected runner; environment is read at each call", async () => {
  const input = { channel: "both" as const, subject: "Test", body: "Test", urgent: false };
  const first = await notify.send(input, { runner: forbidden, now, dryRun: false });
  assert.equal(first.error, "dry-run"); assert.equal(first.delivery_status, "skipped"); assert.equal(first.sent_at, "");
  delete process.env.STERN_NOTIFY_DRY_RUN;
  const environment = process.env as Record<string, string | undefined>;
  const prior = environment.NODE_ENV;
  environment.NODE_ENV = "development";
  assert.equal(notify.notificationDryRun(false), true);
  environment.NODE_ENV = "production";
  assert.equal(notify.notificationDryRun(), false);
  process.env.STERN_NOTIFY_DRY_RUN = "1";
  assert.equal(notify.notificationDryRun(false), true);
  if (prior === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = prior;
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  assert.equal(notify.notificationDryRun(), false);
  await notify.send(input, { dryRun: true, runner: forbidden, now: new Date(now.getTime() + 1) });
});

test("real transport shape uses argv, MIME, bounded timeouts, and fallback only for ENOENT", async () => {
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  settings.updateNotificationSettings({ "stern.hermes_alias": "stern", "stern.imessage_target": "photon:fixture;-;+12025550100", "stern.memo_email": "sample@example.com" });
  const injected: NotificationRunner = async (file, args, options) => { if (file === "/home/Arjun/.local/bin/stern") throw Object.assign(new Error("missing"), { code: "ENOENT" }); return runner(file, args, options); };
  const body = 'Literal $(touch unwanted) `command` "quote"\nSecond line';
  const result = await notify.send({ channel: "both", subject: "Subject", body, urgent: false }, { runner: injected, now });
  assert.equal(result.delivery_status, "sent"); assert.equal(result.error, "");
  assert.deepEqual(calls.map(c => c.file), ["/home/Arjun/.local/bin/personal-trainer", "python3", "gws"]);
  assert.deepEqual(calls[0].args, ["send", "-t", "photon:fixture;-;+12025550100", body]);
  assert.equal(calls[1].args[4], body); assert.match(calls[1].args[1], /EmailMessage/);
  assert.equal(calls[2].options.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, "/home/Arjun/.config/gws-arjun");
  assert.deepEqual(JSON.parse(calls[2].args.at(-1)!), { raw: "bWltZQ==" });
  assert.ok(calls.every(c => c.options.timeout === 20_000));
  for (const call of calls) assert.deepEqual(Object.keys(call.options.env).sort(), (call.file === "gws" ? ["PATH", "HOME", "LANG", "GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] : ["PATH", "HOME", "LANG"]).sort());
  calls.length = 0;
  const partial = await notify.send({ channel: "both", subject: "Timeout", body, urgent: false }, { now: new Date(now.getTime() + 1), runner: async (file, args, options) => { if (file === "/home/Arjun/.local/bin/stern") throw Object.assign(new Error("sensitive argv"), { killed: true }); return runner(file, args, options); } });
  assert.equal(partial.delivery_status, "failed"); assert.match(partial.error, /email sent; imessage: timeout/); assert.ok(!partial.error.includes("sensitive"));
  assert.ok(!calls.some(c => c.file === "/home/Arjun/.local/bin/personal-trainer"));
});

test("concurrent dispatchers claim once and failed sends do not automatically retry", async () => {
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  settings.updateNotificationSettings({ "stern.imessage_target": "photon:fixture;-;+12025550100" });
  add("claim", now.toISOString());
  await Promise.all([rules.dispatchDue(now, { runner }), rules.dispatchDue(now, { runner })]);
  assert.equal(calls.length, 1); assert.equal(rows()[0].delivery_status, "sent");
  assert.throws(() => rules.snoozeReminder(rows()[0].id, "2026-09-08T12:00:00Z", now));
  add("failure", now.toISOString());
  await rules.dispatchDue(now, { runner: async () => { throw new Error("failed"); } });
  assert.equal(rows()[1].delivery_status, "failed");
  await rules.dispatchDue(now, { runner: forbidden });
});

test("memo builds all sections from local fixtures and caps iMessage at eight lines", () => {
  db.prepare("INSERT INTO stern_programs(club_id,name,status,app_deadline_at,interview_at,dress_code,interview_location) VALUES(1,?,'open','2026-09-08','','','')").run(fixture.program);
  db.exec("INSERT INTO stern_programs(club_id,name,status,interview_at,dress_code,interview_location) VALUES(1,'Interview track','interview_invited','2026-09-07T18:00:00Z','Business casual','Room B')");
  db.exec("INSERT INTO coffee_chats(person_id,state,reply_needs_me,reply_at) VALUES(1,'reply_received',1,'2026-09-07T10:00:00Z'); INSERT INTO coffee_chats(person_id,state,occurred_at) VALUES(1,'done','2026-09-06T10:00:00Z'); INSERT INTO coffee_chats(person_id,state,scheduled_at,location) VALUES(1,'scheduled','2026-09-07T16:00:00Z','Cafe')");
  db.prepare("INSERT INTO courses(id,code,title) VALUES(1,?,?)").run(fixture.courseCode, fixture.courseTitle);
  db.exec("INSERT INTO course_meetings(course_id,weekday,start_time,end_time,room) VALUES(1,1,'09:00','10:00','Room C')");
  db.prepare("INSERT INTO stern_calendar_events(account,event_id,title,start_at) VALUES('fixture@stern.nyu.edu','fixture-event',?,'2026-09-07T19:00:00Z')").run(fixture.calendarTitle);
  for (let i = 0; i < 10; i++) db.prepare("INSERT INTO stern_tasks(title,due_at) VALUES(?,'2026-09-07')").run(`${fixture.task} ${i}`);
  db.exec("INSERT INTO stern_suggestions(dedupe_key) VALUES('memo-suggestion'); INSERT INTO stern_audit_log(entity_type,entity_id,action,source,batch_id,created_at) VALUES('task',1,'create','auto_email','yesterday-fixture','2026-09-06T15:00:00Z'),('task',1,'update','auto_email','yesterday-fixture','2026-09-06T15:00:00Z')");
  const result = memo.buildMemo(now);
  for (const value of [fixture.courseCode, fixture.calendarTitle, fixture.task, fixture.club, fixture.person, "Coffee chat", "Interview:", "Reply owed", "Thank-yous due", "Business", "Career", "1 auto-applied batches yesterday."]) assert.ok(result.email.includes(value), value);
  assert.equal(result.imessage.split("\n").length, 8);
  assert.ok(result.imessage.endsWith("Full memo in email."));
  assert.ok(!result.email.includes("|---"));
  assert.equal(memo.buildMemo(now).email, result.email);
  assert.doesNotMatch(result.subject + result.email + result.imessage, /[\u2013\u2014]/);
});

test("memo dry-run preserves today's real send; daily marker and channels are idempotent", async () => {
  const preview = await memo.sendMemo(now, { runner: forbidden });
  assert.equal(preview.skipped, false); assert.equal(rows().length, 2); assert.ok(rows().every(r => r.error === "dry-run"));
  assert.equal(db.prepare("SELECT v FROM kv WHERE k='stern.memo_last_date'").get(), undefined);
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  settings.updateNotificationSettings({ "stern.imessage_target": "photon:fixture;-;+12025550100", "stern.memo_email": "sample@example.com" });
  await Promise.all([memo.sendMemo(now, { runner }), memo.sendMemo(now, { runner })]);
  assert.equal(calls.length, 3); assert.ok(rows().every(r => r.delivery_status === "sent"));
  assert.equal((db.prepare("SELECT v FROM kv WHERE k='stern.memo_last_date'").get() as { v: string }).v, '"2026-09-07"');
  assert.equal((await memo.sendMemo(now, { runner: forbidden })).skipped, true);
  assert.equal((await memo.tickMemo(new Date("2026-09-08T11:59:00Z"), { runner: forbidden })).skipped, true);
  assert.equal((await memo.tickMemo(new Date("2026-09-08T13:00:00Z"), { runner: forbidden })).skipped, true);
});

test("expired or completed task/program reminders are skipped before delivery", async () => {
  db.exec("INSERT INTO stern_programs(id,club_id,name,status,app_deadline_at) VALUES(1,1,'Track','open','2026-09-07'); INSERT INTO stern_tasks(id,title,due_at) VALUES(1,'Task','2026-09-07')");
  rules.evaluateRules(now);
  db.exec("UPDATE stern_programs SET status='submitted'; UPDATE stern_tasks SET status='done'");
  assert.equal((await rules.dispatchDue(now, { runner: forbidden })).skipped, 2);
});

test("automation snapshot exposes delivery tail in ascending id order and retains audit undo", async () => {
  const first = add("a", now.toISOString()); const second = add("b", now.toISOString());
  const details = (await import("@/lib/stern/automation-snapshot")).automationDetails();
  assert.deepEqual(details.reminders.map(r => r.id), [first.id, second.id]);
  const result = await notify.send({ channel: "imessage", subject: "Test", body: "Test", urgent: false, reminderId: first.id }, { runner: forbidden, now });
  const batch = db.prepare("SELECT batch_id FROM stern_audit_log WHERE entity_id=? AND entity_type='reminder' ORDER BY id DESC LIMIT 1").get(first.id) as { batch_id: string };
  assert.equal(result.error, "dry-run"); audit.undoBatch(batch.batch_id);
  assert.equal(store.reminderRow(first.id).delivery_status, "pending");
});

test("a reminder snoozed after selection cannot be claimed using its old fire time", async () => {
  const reminder = add("snooze-race", now.toISOString());
  rules.snoozeReminder(reminder.id, "2026-09-08T12:00:00Z", now);
  const result = await notify.send({ channel: "imessage", subject: "Test", body: "Test", urgent: false, reminderId: reminder.id, expectedFireAt: reminder.fire_at }, { runner: forbidden, now });
  assert.equal(result.delivery_status, "snoozed"); assert.equal(result.error, "manual-snooze");
});

test("bad legacy content fails one reminder without stopping the remaining queue", async () => {
  db.prepare("INSERT INTO stern_reminders(rule_key,entity_type,fire_at,message) VALUES('invalid','test',?,'')").run(now.toISOString());
  add("valid", now.toISOString());
  const result = await rules.dispatchDue(now, { runner: forbidden });
  assert.equal(result.failed, 1); assert.equal(result.skipped, 1);
});

test("undo refuses an active delivery and preserves later delivery history", async () => {
  const reminder = add("audit-race", now.toISOString());
  const createBatch = db.prepare("SELECT batch_id FROM stern_audit_log WHERE entity_id=? AND entity_type='reminder' ORDER BY id DESC LIMIT 1").get(reminder.id) as { batch_id: string };
  store.changeReminder(reminder.id, { delivery_status: "failed", error: "delivery-in-progress" });
  assert.throws(() => audit.undoBatch(createBatch.batch_id), /Delivery is in progress/);
  store.changeReminder(reminder.id, { delivery_status: "sent", error: "", sent_at: now.toISOString() });
  assert.throws(() => audit.undoBatch(createBatch.batch_id), /Delivered reminders cannot be undone/);
});

test("Automation API gates WP5 actions, validates input, and broadcasts each mutation", async () => {
  const { createRequire } = await import("node:module");
  const ts = await import("typescript");
  const require = createRequire(import.meta.url);
  let authorized = false, broadcasts = 0;
  const snapshot = await import("@/lib/stern/snapshot");
  const modules: Record<string, unknown> = {
    "@/lib/guard": { requireUser: async () => authorized ? { email: "fixture@stern.nyu.edu" } : null },
    "@/lib/stern/notify": { ...notify, send: (input: Parameters<typeof notify.send>[0], options: Parameters<typeof notify.send>[1]) => notify.send(input, { ...options, runner: forbidden }) },
    "@/lib/stern/memo": { ...memo, sendMemo: (date: Date, options: Parameters<typeof memo.sendMemo>[1]) => memo.sendMemo(date, { ...options, runner: forbidden }) },
    "@/lib/stern/snapshot": { broadcastStern: () => { broadcasts++; return snapshot.sternSnapshot(); } },
  };
  const compiled = ts.transpileModule(fs.readFileSync("app/api/stern/automation/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {} as { GET: () => Promise<Response>; POST: (req: Request) => Promise<Response> };
  new Function("require", "exports", compiled)((id: string) => modules[id] || require(id), route);
  const post = (body: unknown) => route.POST(new Request("http://localhost:3150/api/stern/automation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await route.GET()).status, 401);
  for (const action of ["reminder.snooze", "reminder.send_test", "memo.send_now", "settings.update"]) assert.equal((await post({ action })).status, 401);
  assert.equal(rows().length, 0); assert.equal(broadcasts, 0);
  authorized = true;
  assert.equal((await post({ action: "settings.update", settings: { "stern.memo_email": "fixture@example.com" } })).status, 200);
  const reminder = add("manual-api", new Date().toISOString());
  assert.equal((await post({ action: "reminder.snooze", id: reminder.id, until: new Date(Date.now() + 60_000).toISOString() })).status, 200);
  assert.equal((await post({ action: "reminder.send_test", channel: "both", dryRun: true })).status, 200);
  assert.equal((await post({ action: "memo.send_now", dryRun: true })).status, 200);
  assert.equal(broadcasts, 4);
  const data = await (await route.GET()).json();
  assert.equal(data.reminders.length, 4);
  assert.equal(data.notificationSettings["stern.memo_email"], "fixture@example.com");
  assert.equal((await post({ action: "reminder.send_test", channel: "shell" })).status, 400);
  assert.equal((await post({ action: "settings.update", settings: { "stern.memo_last_date": "2026-09-07" } })).status, 400);
  assert.equal((await post({ action: "reminder.snooze", id: 999999, until: new Date(Date.now() + 60_000).toISOString() })).status, 404);
  for (const target of ["--help", "-t", "a b"]) assert.equal((await post({ action: "settings.update", settings: { "stern.imessage_target": target } })).status, 400);
  assert.equal((await post({ action: "settings.update", settings: { "stern.threshold_auto": "1.2" } })).status, 400);
  assert.equal((await post({ action: "settings.update", settings: { "stern.threshold_auto": "0.9" } })).status, 200);
  assert.equal((await (await route.GET()).json()).notificationSettings["stern.threshold_auto"], "0.9");
  assert.equal(broadcasts, 5);
});

test("a booked interview remains eligible on an open program; one tick shares an undoable batch", async () => {
  db.exec("INSERT INTO stern_programs(id,club_id,name,status,app_deadline_at,interview_at) VALUES(1,1,'Open track','open','2026-09-07','2026-09-07T18:00:00Z')");
  const meta = store.reminderMeta();
  assert.equal(rules.evaluateRules(now, { audit: meta }).inserted, 2);
  await rules.dispatchDue(now, { runner: forbidden, audit: meta });
  assert.equal(n("SELECT COUNT(DISTINCT batch_id) n FROM stern_audit_log"), 1);
  assert.match(memo.buildMemo(now).email, /Interview: Stern Venture Society/);
  assert.equal(audit.undoBatch(meta.batchId).skipped, 0);
  assert.equal(rows().length, 0);
});

test("an interrupted delivery claim remains explicitly undoable after its bounded transport window", () => {
  const reminder = add("interrupted", now.toISOString());
  const claim = store.reminderMeta();
  store.changeReminder(reminder.id, { delivery_status: "failed", error: "delivery-in-progress" }, claim);
  assert.throws(() => audit.undoBatch(claim.batchId), /wait two minutes/);
  db.prepare("UPDATE stern_audit_log SET created_at=? WHERE batch_id=?").run(new Date(Date.now() - 121_000).toISOString(), claim.batchId);
  assert.equal(audit.undoBatch(claim.batchId).skipped, 0);
  assert.equal(store.reminderRow(reminder.id).delivery_status, "pending");
});

test("threshold settings validate the stored pair atomically and drive classification decisions", async () => {
  assert.deepEqual(settings.thresholds(), { auto: 0.85, suggest: 0.6 });
  for (const value of ["1.2", "-0.1", "NaN", "Infinity", "", " ", "0x1"]) {
    assert.throws(() => settings.updateNotificationSettings({ "stern.threshold_auto": value }), { status: 400 });
  }
  const changed = settings.updateNotificationSettings({ "stern.threshold_auto": "0.9", "stern.threshold_suggest": "0.8" });
  const auditCount = n("SELECT COUNT(*) n FROM stern_audit_log");
  assert.throws(() => settings.updateNotificationSettings({ "stern.threshold_auto": "0.7", "stern.memo_email": "other@example.com" }), { status: 400 });
  assert.throws(() => settings.updateNotificationSettings({ "stern.threshold_suggest": "0.95" }), { status: 400 });
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log"), auditCount);
  assert.deepEqual(settings.thresholds(), { auto: 0.9, suggest: 0.8 });
  const details = (await import("@/lib/stern/automation-snapshot")).automationDetails();
  assert.equal(details.notificationSettings["stern.threshold_auto"], "0.9");
  audit.undoBatch(changed.batchId);
  assert.deepEqual(settings.thresholds(), { auto: 0.85, suggest: 0.6 });
  settings.updateNotificationSettings({ "stern.threshold_auto": "1", "stern.threshold_suggest": "0" });
  assert.deepEqual(settings.thresholds(), { auto: 1, suggest: 0 });

  const { applyClassification } = await import("@/lib/stern/apply");
  const { expected } = (await import("./fixtures/stern/emails.json")).default[0];
  const cls = { ...expected, confidence: 0.8 } as import("@/lib/stern-types").EmailClassification;
  db.exec("INSERT INTO stern_programs(id,club_id,name) VALUES(1,1,'Threshold track'); DELETE FROM stern_email_messages; INSERT INTO stern_email_messages(id,gmail_message_id,direction) VALUES(1,'threshold-fixture','outbound')");
  const message = db.prepare("SELECT * FROM stern_email_messages WHERE id=1").get() as import("@/lib/stern-types").SternEmailMessage;
  const options = { dryRun: true, effects: [{ kind: "program_window" as const, programId: 1, fields: { requirements: "Fixture requirement" } }] };
  settings.updateNotificationSettings({ "stern.threshold_auto": "0.9", "stern.threshold_suggest": "0.81" });
  assert.equal((await applyClassification(message, cls, options)).applied, "ignored");
  settings.updateNotificationSettings({ "stern.threshold_suggest": "0.8" });
  assert.equal((await applyClassification(message, cls, options)).applied, "suggested");
  settings.updateNotificationSettings({ "stern.threshold_auto": "0.8" });
  assert.equal((await applyClassification(message, cls, options)).applied, "auto_applied");
  assert.equal((db.prepare("SELECT requirements FROM stern_programs WHERE id=1").get() as { requirements: string }).requirements, "Fixture requirement");
});

test("date-only interviews appear on their local day, with no forbidden punctuation from source text", () => {
  db.exec("INSERT INTO stern_programs(club_id,name,status,interview_at) VALUES(1,'Date-only track','interview_invited','2026-09-08')");
  db.prepare("UPDATE stern_clubs SET name=? WHERE id=1").run("Fixture \u2014 club");
  db.prepare("INSERT INTO stern_tasks(title,due_at) VALUES(?,'2026-09-08')").run("Fixture \u2013 task");
  assert.doesNotMatch(memo.buildMemo(now).email, /All day Interview/);
  assert.doesNotMatch(memo.buildMemo(now).imessage, /All day interview/);
  const day = new Date("2026-09-08T12:00:00Z"), result = memo.buildMemo(day);
  assert.match(result.email, /All day Interview: Fixture, club, Date-only track/);
  assert.match(result.imessage, /All day interview: Fixture, club/);
  assert.doesNotMatch(result.subject + result.email + result.imessage, /[\u2013\u2014]/);
  rules.evaluateRules(day);
  assert.ok(rows().some(r => r.entity_type === "program_interview"));
});

test("de-listing a club skips queued deadlines and interviews and stops new inserts", async () => {
  const { setInterested } = await import("@/lib/stern/recruiting");
  setInterested(1, true);
  db.exec("UPDATE stern_programs SET status='open',app_deadline_at='2026-09-14',interview_at='2026-09-14T18:00:00Z'");
  assert.equal(rules.evaluateRules(now).inserted, 4);
  setInterested(1, false);
  assert.equal(rules.evaluateRules(now).inserted, 0);
  assert.equal((await rules.dispatchDue(now, { runner: forbidden })).skipped, 4);
  assert.ok(rows().every(r => r.error === "no-longer-applicable"));
  assert.equal(rules.evaluateRules(new Date("2026-09-11T12:00:00Z")).inserted, 0);
});

test("Hermes targets and aliases are validated at settings and transport boundaries", async () => {
  for (const value of ["-t", "--help", "--list", "a b", "photon:any; rm -rf x", "photon:fixture-target", 'photon:any;-;"12345678"']) {
    assert.throws(() => settings.updateNotificationSettings({ "stern.imessage_target": value }), { status: 400 });
  }
  for (const value of ["Stern", "stern_bot", "../stern", "stern send", "a".repeat(65)]) {
    assert.throws(() => settings.updateNotificationSettings({ "stern.hermes_alias": value }), { status: 400 });
  }
  settings.updateNotificationSettings({ "stern.imessage_target": "" });
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  let sendOffset = 0;
  for (const value of ["--help", "a b", ""]) {
    db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('stern.imessage_target',?)").run(JSON.stringify(value));
    const result = await notify.send({ channel: "imessage", subject: "Test", body: "Test", urgent: false }, { now: new Date(now.getTime() + sendOffset++), runner: forbidden });
    assert.equal(result.error, "imessage: not-configured"); assert.equal(result.delivery_status, "failed");
  }
  settings.updateNotificationSettings({ "stern.imessage_target": "photon:fixture;-;+12025550100" });
  db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('stern.hermes_alias',?)").run(JSON.stringify("Bad_Alias"));
  const result = await notify.send({ channel: "imessage", subject: "Test", body: "Test", urgent: false }, { now: new Date(now.getTime() + sendOffset++), runner: forbidden });
  assert.equal(result.error, "imessage: not-configured");
});

test("delivered reminders cannot be undone or requeued even when creation and send share a batch", async () => {
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  settings.updateNotificationSettings({ "stern.imessage_target": "photon:fixture;-;+12025550100" });
  db.exec("INSERT INTO stern_tasks(title,due_at) VALUES('Delivered task','2026-09-07')");
  const meta = store.reminderMeta();
  rules.evaluateRules(now, { audit: meta });
  await rules.dispatchDue(now, { audit: meta, runner });
  assert.equal(calls.length, 1);
  const before = rows();
  assert.throws(() => audit.undoBatch(meta.batchId), { status: 409 });
  assert.deepEqual(rows(), before);
  assert.equal(rules.evaluateRules(new Date(now.getTime() + 60_000)).inserted, 0);
  await rules.dispatchDue(new Date(now.getTime() + 60_000), { runner: forbidden });
  assert.equal(n("SELECT COUNT(*) n FROM stern_audit_log WHERE undone_at<>''"), 0);
});

test("delivered and partially delivered memos protect their rows and daily marker from undo", async () => {
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  settings.updateNotificationSettings({ "stern.imessage_target": "photon:fixture;-;+12025550100", "stern.memo_email": "fixture@example.com" });
  const meta = store.reminderMeta();
  await memo.sendMemo(now, { runner, audit: meta });
  assert.throws(() => audit.undoBatch(meta.batchId), { status: 409 });
  assert.equal(rows().length, 2);
  const marker = store.reminderMeta();
  db.transaction(() => settings.writeNotificationSetting("stern.memo_last_date", "2026-09-07", marker)).immediate();
  // Exercise a standalone marker batch, including the case where a marker was repaired.
  db.exec("DELETE FROM kv WHERE k='stern.memo_last_date'");
  db.transaction(() => settings.writeNotificationSetting("stern.memo_last_date", "2026-09-07", marker)).immediate();
  assert.throws(() => audit.undoBatch(marker.batchId), { status: 409 });
  assert.equal((await memo.tickMemo(now, { runner: forbidden })).skipped, true);

  const next = new Date("2026-09-08T12:00:00Z"), partial = store.reminderMeta();
  await memo.sendMemo(next, { audit: partial, runner: async (file, args, options) => {
    if (file.endsWith("/stern")) throw new Error("Fixture transport failure");
    return runner(file, args, options);
  } });
  assert.throws(() => audit.undoBatch(partial.batchId), { status: 409 });
  const replay = await memo.tickMemo(new Date("2026-09-08T12:01:00Z"), { runner: forbidden });
  assert.equal(replay.skipped, true); assert.equal(replay.reason, "already-attempted");
  assert.deepEqual(replay.deliveries?.map(d => d.delivery_status), ["sent", "failed"]);
});

test("snoozing beyond the original daily window still dispatches open items and skips completed ones", async () => {
  db.exec("INSERT INTO stern_programs(club_id,name,status,app_deadline_at) VALUES(1,'Snoozed track','open','2026-09-14'); INSERT INTO stern_tasks(title,due_at) VALUES('Open task','2026-09-07'),('Completed task','2026-09-07'); INSERT INTO stern_suggestions(dedupe_key) VALUES('snoozed-suggestion')");
  rules.evaluateRules(now);
  assert.equal(rows().length, 4);
  for (const row of rows()) rules.snoozeReminder(row.id, "2026-09-08T12:00:00Z", now);
  db.exec("UPDATE stern_tasks SET status='done' WHERE title='Completed task'");
  assert.equal(rules.evaluateRules(now).inserted, 0);
  const result = await rules.dispatchDue(new Date("2026-09-08T12:00:00Z"), { runner: forbidden });
  assert.equal(result.skipped, 4);
  assert.equal(rows().filter(r => r.error === "dry-run").length, 3);
  assert.equal(rows().filter(r => r.error === "no-longer-applicable").length, 1);
});

test("snooze collisions are a 409 and dashboard delivery never claims success", async () => {
  const first = add("collision", now.toISOString());
  const next = new Date(now.getTime() + 60_000).toISOString();
  add("collision", next);
  assert.throws(() => rules.snoozeReminder(first.id, next, now), { status: 409 });
  assert.equal(store.reminderRow(first.id).delivery_status, "pending");
  process.env.STERN_NOTIFY_DRY_RUN = "0";
  const result = await notify.send({ channel: "dashboard", subject: "Test", body: "Test", urgent: false }, { now, runner: forbidden });
  assert.equal(result.delivery_status, "skipped"); assert.equal(result.sent_at, ""); assert.equal(result.error, "dashboard-channel-not-implemented");
});


test("threshold undo refuses an invalid pair and preserves newer settings", () => {
  const first = settings.updateNotificationSettings({ "stern.threshold_auto": "0.95" });
  const second = settings.updateNotificationSettings({ "stern.threshold_suggest": "0.9" });
  assert.throws(() => audit.undoBatch(first.batchId), { status: 409 });
  assert.deepEqual(settings.thresholds(), { auto: 0.95, suggest: 0.9 });
  audit.undoBatch(second.batchId);
  audit.undoBatch(first.batchId);
  assert.deepEqual(settings.thresholds(), { auto: 0.85, suggest: 0.6 });
});
