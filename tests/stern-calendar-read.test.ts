import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-calendar-read-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "test.db");
process.env.STERN_VAULT_WRITE = "0";
process.env.STERN_LLM_MODE = "fixture";
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("Calendar projection must not access network"); };
const setup = Promise.all([import("@/db"), import("@/lib/stern/overview"), import("@/lib/stern/memo")]).then(([db, overview, memo]) => ({ db: db.getDb(), ...overview, ...memo }));
test.after(async () => { (await setup).db.close(); globalThis.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }); assert.equal(networkCalls, 0); });

test("overview and memo show the real booking once while preserving both source records", async () => {
  const { db, todaySchedule, buildMemo } = await setup;
  const person = Number(db.prepare("INSERT INTO people(display_name) VALUES ('Example Student')").run().lastInsertRowid);
  const chat = Number(db.prepare("INSERT INTO coffee_chats(person_id,state,scheduled_at) VALUES (?,'scheduled','2026-09-09T19:30:00-04:00')").run(person).lastInsertRowid);
  const put = db.prepare("INSERT INTO stern_calendar_events(account,event_id,title,start_at,end_at,location,kind,person_id,coffee_chat_id) VALUES ('student@stern.nyu.edu',?,?,?,?,?,'coffee_chat',?,?)");
  put.run("invite:example-hash", "Invitation: Example Student @ Wed 7:30 PM", "2026-09-09T23:30:00Z", "2026-09-10T00:00:00Z", "Invitation venue", person, chat);
  put.run("real-google-id", "Example Student and Owner", "2026-09-09T19:30:00-04:00", "2026-09-09T20:00:00-04:00", "Confirmed calendar venue", person, chat);
  const before = db.serialize();
  const now = new Date("2026-09-09T12:00:00Z");
  const schedule = todaySchedule(now);
  const memo = buildMemo(now).email;
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].title, "Example Student and Owner");
  assert.equal(schedule[0].location, "Confirmed calendar venue");
  assert.equal(memo.match(/Example Student and Owner/g)?.length, 1);
  assert.doesNotMatch(memo, /Invitation: Example Student/);
  assert.deepEqual(db.serialize(), before, "Read projection must not change source rows or audits");
});

test("invitation suppression requires compatible account, meeting identities and an equal instant", async () => {
  const { withoutSupersededInvites } = await import("@/lib/stern/calendar-read");
  const real = { account: "student@stern.nyu.edu", event_id: "real-id", start_at: "2026-09-09T19:30:00-04:00", coffee_chat_id: 1, person_id: 2, title: "Same title" };
  const invite = { ...real, event_id: "invite:one", start_at: "2026-09-09T23:30:00Z", title: "Different title" };
  const input = [invite, real];
  assert.deepEqual(withoutSupersededInvites(input), [real]);
  assert.deepEqual(input, [invite, real]);
  assert.deepEqual(withoutSupersededInvites([real, invite]), [real]);
  for (const changed of [
    { account: "other@nyu.edu" }, { coffee_chat_id: 3 }, { person_id: 4 },
    { start_at: "2026-09-09T23:31:00Z" }, { start_at: "invalid" },
  ]) {
    const separate = { ...invite, ...changed };
    assert.deepEqual(withoutSupersededInvites([separate, real]), [separate, real]);
  }
  assert.deepEqual(withoutSupersededInvites([invite]), [invite], "A sole invitation remains useful");
  const unlinked = { ...real, coffee_chat_id: 0 };
  assert.deepEqual(withoutSupersededInvites([invite, unlinked]), [unlinked], "Same person permits fallback when no chat IDs conflict");
  const anonymous = { ...invite, coffee_chat_id: 0, person_id: 0, title: real.title };
  assert.deepEqual(withoutSupersededInvites([anonymous, real]), [anonymous, real], "Matching title/time alone is insufficient");
  const secondReal = { ...real, event_id: "second-real-id" };
  assert.deepEqual(withoutSupersededInvites([real, secondReal, invite]), [real, secondReal], "Different real event IDs survive");
  const dryRun = { ...real, event_id: "dry-run:placeholder" };
  assert.deepEqual(withoutSupersededInvites([invite, dryRun]), [invite, dryRun], "A dry-run placeholder is not real calendar evidence");
});

test("both consumers retain distinct real event IDs even when titles and times match", async () => {
  const { db, todaySchedule, buildMemo } = await setup;
  const put = db.prepare("INSERT INTO stern_calendar_events(account,event_id,title,start_at,kind) VALUES ('student@stern.nyu.edu',?,'Two real bookings','2026-09-10T15:00:00Z','other')");
  put.run("separate-one"); put.run("separate-two");
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(todaySchedule(now).filter(e => e.title === "Two real bookings").length, 2);
  assert.equal(buildMemo(now).email.match(/Two real bookings/g)?.length, 2);
});
