import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PERSON_STATUSES, type Person } from "@/lib/stern-types";

const tmp = fs.mkdtempSync(path.join(process.cwd(), ".stern-network-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp, "network.db");
process.env.COMMAND_CENTER_VAULT = path.join(tmp, "vault");
process.env.STERN_VAULT_WRITE = "1";
fs.mkdirSync(process.env.COMMAND_CENTER_VAULT);
let loaded: Promise<{ people: typeof import("@/lib/stern/people"); audit: typeof import("@/lib/stern/audit"); db: ReturnType<typeof import("@/db")["getDb"]> }> | undefined;
function setup() { return loaded ||= Promise.all([import("@/lib/stern/people"), import("@/lib/stern/audit"), import("@/db")]).then(([people, audit, db]) => ({ people, audit, db: db.getDb() })); }
test.after(async () => { (await setup()).db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const note = (id: number) => path.join(tmp, "vault", "Stern", "People", `person-${id}.md`);

test("email and name+org dedupe, fill blanks, explicit overwrite, identity enrichment", async () => {
  const { people: p } = await setup();
  assert.equal(p.normalizeEmail("  TEST@Example.test  "), "test@example.test");
  assert.equal(p.dedupeKeyFor({ name: " Test!   Student ", org: "Example, Inc." }), "name:test student:example inc");
  const a = p.createPerson({ name: "Test Student", email: "TEST@example.test", org: "Example Club", notes: "Keep these notes", strength: 4 }).person;
  const dup = p.createPerson({ name: "Other name", email: "test@EXAMPLE.test", org: "Other Org", notes: "Do not overwrite", phone: "555-0100", strength: 1 });
  assert.equal(dup.created, false); assert.equal(dup.person.id, a.id); assert.equal(dup.person.display_name, a.display_name); assert.equal(dup.person.notes, a.notes); assert.equal(dup.person.strength, 4); assert.equal(dup.person.phone, "555-0100");
  assert.equal(p.createPerson({ name: "Renamed Student", email: a.email }, { overwrite: true }).person.display_name, "Renamed Student");
  const named = p.createPerson({ name: "Case Student", org: "Sample Org" }).person;
  assert.equal(p.createPerson({ name: "CASE student", org: "sample org", major: "Finance" }).person.id, named.id);
  assert.equal(p.createPerson({ name: "Case Student", org: "Sample Org", email: "enriched@example.test" }).person.id, named.id);
  assert.equal(p.getPerson(named.id).dedupe_key, "enriched@example.test");
  assert.throws(() => p.updatePerson(a.id, { email: "enriched@example.test" }), /merge/);
  p.updatePerson(a.id, { archived: 1, dedupe_key: "bad", id: 900, source: "seed", phone: "changed" });
  assert.equal(p.getPerson(a.id).archived, 0); assert.equal(p.getPerson(a.id).source, "manual");
  assert.throws(() => p.updatePerson(a.id, { display_name: "" }), /Name/);
  assert.throws(() => p.createPerson({ name: "Invalid Email", email: "invalid" }), /email/);
  assert.throws(() => p.createPerson({ name: "Invalid Strength", strength: 6 }), /strength/);
});

test("all status transition pairs and relationship writes are audited and undoable", async () => {
  const { people: p, audit } = await setup();
  for (const from of PERSON_STATUSES) for (const to of PERSON_STATUSES) {
    const a = p.createPerson({ name: `Transition ${from} ${to}`, status: from }).person;
    const allowed = from === to || to === "need_to_reach_out" || to === "dormant" || PERSON_STATUSES.indexOf(to) === PERSON_STATUSES.indexOf(from) + 1;
    const batchId = audit.newBatchId();
    if (allowed) { assert.equal(p.setStatus(a.id, to, { batchId }).status, to); if (from !== to) { assert.ok(audit.batchRows(batchId).some(r => r.field === "status")); audit.undoBatch(batchId); assert.equal(p.getPerson(a.id).status, from); } }
    else { assert.throws(() => p.setStatus(a.id, to, { batchId }), /Cannot change/); assert.equal(audit.batchRows(batchId).length, 0); }
  }
  const a = p.createPerson({ name: "Relationship Student" }).person;
  const batchId = audit.newBatchId(); p.setRelationship(a.id, "mentor", 5, { batchId });
  assert.equal(p.getPerson(a.id).strength, 5); assert.equal(p.getPerson(a.id).relationship_type, "mentor");
  audit.undoBatch(batchId); assert.equal(p.getPerson(a.id).strength, 1);
  p.upgradeToFriend(a.id); assert.equal(p.getPerson(a.id).relationship_type, "friend");
});

test("affiliation CRUD, validation, dedupe and undo preserve row snapshots", async () => {
  const { people: p, audit, db } = await setup();
  const processId = Number(db.prepare("INSERT INTO stern_processes(slug,name) VALUES('network-test','Example Season')").run().lastInsertRowid);
  const clubId = Number(db.prepare("INSERT INTO stern_clubs(process_id,name,slug) VALUES(?,'Strategic Venture Society','svs')").run(processId).lastInsertRowid);
  const a = p.createPerson({ name: "Affiliated Student" }).person;
  const add = audit.newBatchId();
  const affiliation = p.addAffiliation(a.id, { clubId, role: "President", isEboard: true, relevantForRecruiting: true }, { batchId: add });
  assert.equal(affiliation.org, "Strategic Venture Society"); assert.equal(p.addAffiliation(a.id, { clubId }).id, affiliation.id);
  assert.throws(() => p.addAffiliation(a.id, { clubId: 999999 }), /Club not found/);
  assert.throws(() => p.addAffiliation(a.id, {}), /organization/);
  const edit = audit.newBatchId(); p.updateAffiliation(affiliation.id, { role: "Member", relevantForRecruiting: false }, { batchId: edit });
  assert.equal(p.getPerson(a.id).affiliations[0].role, "Member"); audit.undoBatch(edit); assert.equal(p.getPerson(a.id).affiliations[0].role, "President");
  const del = audit.newBatchId(); p.removeAffiliation(affiliation.id, { batchId: del }); assert.equal(p.getPerson(a.id).affiliations.length, 0);
  audit.undoBatch(del); assert.equal(p.getPerson(a.id).affiliations[0].is_eboard, 1);
  assert.deepEqual(p.listPeople({ clubId }).people.map(x => x.id), [a.id]);
  assert.ok(p.clubPicker().some(c => c.id === clubId));
});

test("touchpoints dedupe Gmail, allow repeated local notes, update chronological contact and tail; audit undo", async () => {
  const { people: p, audit } = await setup(); const a = p.createPerson({ name: "Touchpoint Student" }).person;
  const batchId = audit.newBatchId();
  const first = p.addTouchpoint(a.id, "email_received", { occurredAt: "2026-09-05T10:00:00-04:00", source: "gmail", gmailAccount: "netid@stern.nyu.edu", gmailMessageId: "fixture-msg", summary: "Example reply" }, { batchId });
  assert.equal(p.addTouchpoint(a.id, "email_received", { source: "gmail", gmailAccount: "netid@stern.nyu.edu", gmailMessageId: "fixture-msg" }).id, first.id);
  assert.equal(p.getPerson(a.id).last_contact_at, "2026-09-05T14:00:00.000Z");
  assert.ok(audit.batchRows(batchId).every(r => r.source === "auto_email"));
  audit.undoBatch(batchId); assert.equal(p.getPerson(a.id).last_contact_at, ""); assert.equal(p.getPerson(a.id).touchpoints.length, 0);
  const ids: number[] = [];
  for (let i = 0; i < 60; i++) ids.push(p.addTouchpoint(a.id, "note", { summary: `Note ${i}`, occurredAt: i === 0 ? "2026-10-01T12:00:00Z" : "2026-09-01T12:00:00Z" }).id);
  assert.equal(p.getPerson(a.id).last_contact_at, "2026-10-01T12:00:00.000Z");
  assert.deepEqual(p.getPerson(a.id).touchpoints.map(t => t.id), ids.slice(-50));
});

test("merge moves and dedupes children, retains read-only chats/drafts, and reverses the whole batch", async () => {
  const { people: p, audit, db } = await setup();
  const keep = p.createPerson({ name: "Keep Student", email: "keep@example.test", notes: "Keep note" }).person;
  const drop = p.createPerson({ name: "Drop Student", email: "drop@example.test", notes: "Drop note" }).person;
  p.addAffiliation(keep.id, { org: "Shared Org" }); p.addAffiliation(drop.id, { org: "Shared Org", role: "Lead", isEboard: true }); p.addAffiliation(drop.id, { org: "Other Org" });
  const touch = { gmailAccount: "netid@nyu.edu", gmailMessageId: "same", source: "gmail", summary: "Shared reply" };
  p.addTouchpoint(keep.id, "email_received", touch); p.addTouchpoint(drop.id, "email_received", touch); p.addTouchpoint(drop.id, "note", { summary: "Move note" });
  db.prepare("INSERT INTO coffee_chats(person_id,state) VALUES(?,'scheduled')").run(drop.id);
  db.prepare("INSERT INTO stern_drafts(person_id,subject,body) VALUES(?,'Example subject','Example body')").run(drop.id);
  const before = { keep: p.getPerson(keep.id), drop: p.getPerson(drop.id) }, chats = db.prepare("SELECT * FROM coffee_chats").all(), drafts = db.prepare("SELECT * FROM stern_drafts").all();
  const batchId = audit.newBatchId(); const merged = p.mergePeople(keep.id, drop.id, { batchId });
  assert.equal(merged.affiliations.length, 2); assert.equal(merged.affiliations[0].is_eboard, 1); assert.equal(merged.touchpoints.length, 2); assert.equal(merged.email_alt, drop.email);
  assert.match(merged.notes, /Keep note\n\nDrop note/); assert.equal(p.getPerson(drop.id).archived, 1);
  assert.deepEqual(db.prepare("SELECT * FROM coffee_chats").all(), chats); assert.deepEqual(db.prepare("SELECT * FROM stern_drafts").all(), drafts);
  assert.deepEqual(merged.mergedRecords, [{ id: drop.id, display_name: drop.display_name }]);
  assert.equal(p.createPerson({ name: drop.display_name, email: drop.email }).person.id, keep.id);
  assert.equal(p.getPerson(drop.id).coffeeChats.length, 1); assert.equal(p.getPerson(drop.id).drafts.length, 1);
  assert.ok(audit.batchRows(batchId).some(r => r.action === "delete")); audit.undoBatch(batchId);
  assert.deepEqual(p.getPerson(keep.id), before.keep); assert.deepEqual(p.getPerson(drop.id), before.drop);
});

test("merge can transfer an email or name+org identity into a blank survivor", async () => {
  const { people: p, audit, db } = await setup();
  for (const email of ["", "transfer@example.test"]) {
    const name = email ? "Email Transfer Student" : "Org Transfer Student";
    const keep = p.createPerson({ name }).person;
    const drop = p.createPerson({ name, org: "Transfer Organization", email }).person;
    const batchId = audit.newBatchId();
    const merged = p.mergePeople(keep.id, drop.id, { batchId });
    assert.equal(merged.org, drop.org); assert.equal(merged.email, email);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM people WHERE dedupe_key=''").get() as { n: number }).n, 0);
    const noteBatch = audit.newBatchId();
    assert.equal(p.updatePerson(drop.id, { notes: "Editable after merge" }, { batchId: noteBatch }).notes, "Editable after merge");
    audit.undoBatch(noteBatch);
    assert.equal(p.createPerson({ name, org: drop.org, email }).person.id, keep.id);
    audit.undoBatch(batchId);
    assert.equal(p.getPerson(keep.id).dedupe_key, keep.dedupe_key);
    assert.equal(p.getPerson(drop.id).dedupe_key, drop.dedupe_key);
  }
});

test("SQL search, compound filters, pagination, counts, CSV escaping and idempotent atomic import", async () => {
  const { people: p, audit } = await setup();
  const fixtures = JSON.parse(fs.readFileSync("tests/fixtures/stern/network.json", "utf8"));
  const first = p.importPeople(fixtures), second = p.importPeople(fixtures);
  assert.ok(first.every(x => x.created)); assert.ok(second.every(x => !x.created)); assert.deepEqual(first.map(x => x.person.id), second.map(x => x.person.id));
  const a = p.createPerson({ name: "Filter Student", org: "Quoted, \"Org\"", email: "filter@example.test", instagram: "@filter_name", strength: 4, relationship_type: "friend", sphere: "personal", status: "follow_up_owed", notes: "Line one\nLine two" }).person;
  for (const q of ["Filter Student", "Quoted", "filter@example", "filter_name"]) assert.equal(p.listPeople({ q }).people[0].id, a.id);
  assert.equal(p.listPeople({ q: "%" }).total, 0);
  assert.equal(p.listPeople({ relationshipType: ["friend"], strengthMin: 4, status: ["follow_up_owed"], sphere: "personal", followUpOwed: true }).people[0].id, a.id);
  assert.equal(p.listPeople({ q: "Filter", strengthMin: 5 }).total, 0);
  assert.equal(p.listPeople({ page: 1 }).people.length, 25); assert.equal(p.listPeople({ page: 2 }).people.length, 25);
  assert.throws(() => p.listPeople({ page: NaN }), /page/);
  assert.match(p.exportPeople("csv", { q: "Filter Student" }), /"Quoted, ""Org"""/); assert.match(p.exportPeople("csv", { q: "Filter Student" }), /"Line one\nLine two"/);
  const snap = p.networkSnapshot(); assert.ok(snap.counts.byRelationshipType.friend >= 1); assert.ok(snap.counts.followUpsOwed >= 1); assert.equal(snap.recent[0].id, a.id);
  const batchId = audit.newBatchId(); p.archivePerson(a.id, { batchId }); assert.equal(p.listPeople({ q: "Filter Student" }).total, 0); assert.equal(p.listPeople({ q: "Filter Student", archived: true }).total, 1); audit.undoBatch(batchId);
  const count = p.networkSnapshot().counts.total;
  assert.throws(() => p.importPeople([{ name: "Rollback Example" }, { name: "Bad", strength: 90 }]), /strength/); assert.equal(p.networkSnapshot().counts.total, count);
  assert.throws(() => p.importPeople([{ name: "Rollback Note" }, { name: "Invalid source", source: "bogus" }], { source: "bogus" }), /source/); assert.equal(p.networkSnapshot().counts.total, count);
});

test("vault writes stable People notes on create/notes edits, no notes on rollback, missing vault is safe", async () => {
  const { people: p, audit } = await setup();
  const a = p.createPerson({ name: "Vault Student", notes: "First note", org: "Example Org" }).person;
  assert.match(fs.readFileSync(note(a.id), "utf8"), /name: Vault Student/); assert.match(fs.readFileSync(note(a.id), "utf8"), /relationship: general_connect/);
  const batchId = audit.newBatchId();
  p.updatePerson(a.id, { notes: "Changed note" }, { batchId }); assert.match(fs.readFileSync(note(a.id), "utf8"), /Changed note/);
  audit.undoBatch(batchId); assert.match(fs.readFileSync(note(a.id), "utf8"), /First note/);
  const captureBatch = audit.newBatchId(); const withdrawn = p.createPerson({ name: "Withdrawn Capture", notes: "Preserved narrative" }, { batchId: captureBatch }).person;
  audit.undoBatch(captureBatch); assert.match(fs.readFileSync(note(withdrawn.id), "utf8"), /capture_undone: true/);
  p.updatePerson(a.id, { display_name: "Renamed Vault Student" }); assert.match(fs.readFileSync(note(a.id), "utf8"), /name: Renamed Vault Student/);
  let rollbackId = 0; assert.throws(() => p.peopleWrite(() => { rollbackId = p.createPerson({ name: "Rolled Back Student" }).person.id; throw new Error("rollback"); }), /rollback/);
  assert.equal(fs.existsSync(note(rollbackId)), false);
  assert.ok(audit.auditForEntity("person", a.id).some(r => r.action === "create"));
  const vault = process.env.COMMAND_CENTER_VAULT; process.env.COMMAND_CENTER_VAULT = path.join(tmp, "missing");
  assert.doesNotThrow(() => p.createPerson({ name: "Missing Vault Student" })); assert.equal(fs.existsSync(path.join(tmp, "missing")), false); process.env.COMMAND_CENTER_VAULT = vault;
});

// Execute the real route with only the session boundary and broadcast replaced by local stubs.
// No HTTP listener, credential reads, provider calls, or public auth bypass is introduced.
test("API dispatches every action, exports and filters; unauthorized requests never mutate or broadcast", async () => {
  const { people, audit, db } = await setup();
  const source = fs.readFileSync("app/api/stern/network/route.ts", "utf8");
  assert.equal((source.match(/await requireUser\(\)/g) || []).length, 2);
  const require = createRequire(import.meta.url); let authorized = false, broadcasts = 0;
  const modules: Record<string, unknown> = { "@/lib/guard": { requireUser: async () => authorized ? { email: "fixture@example.test" } : null }, "@/lib/stern/people": people, "@/lib/stern/audit": audit, "@/lib/stern/errors": await import("@/lib/stern/errors"), "@/lib/stern/snapshot": { broadcastStern: () => { broadcasts++; return { network: people.networkSnapshot() }; } } };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const routes = {} as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
  new Function("require", "exports", compiled)((id: string) => modules[id] || require(id), routes);
  const post = (body: unknown) => routes.POST(new Request("http://localhost/api/stern/network", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = (query = "") => routes.GET(new Request(`http://localhost/api/stern/network${query}`));
  assert.equal((await get()).status, 401); assert.equal((await post({ action: "person.create", person: { name: "Unauthorized" } })).status, 401); assert.equal(broadcasts, 0);
  authorized = true;
  const created = await (await post({ action: "person.create", person: { name: "API Student" }, affiliation: { org: "API Org" } })).json();
  const id = created.result.person.id; assert.ok(id); assert.ok(created.batchId);
  const success = async (body: unknown) => { const before = broadcasts; const res = await post(body); assert.equal(res.status, 200, await res.clone().text()); const data = await res.json(); assert.equal(broadcasts, before + 1); assert.ok(audit.batchRows(data.batchId).length > 0); return data; };
  await success({ action: "person.update", id, patch: { notes: "API edited note" } });
  await success({ action: "person.set_status", id, status: "need_to_reach_out" });
  for (const identity of [{ name: "Duplicate API Named" }, { name: "Duplicate API Email", email: "duplicate-api@example.test" }]) {
    const original = await success({ action: "person.create", person: identity });
    const duplicate = await success({ action: "person.create", person: { ...identity, status: "need_to_reach_out", relationship_type: "mentor" } });
    assert.equal(duplicate.result.created, false);
    assert.equal(duplicate.result.person.id, original.result.person.id);
    assert.equal(duplicate.result.person.status, "need_to_reach_out");
    assert.equal(duplicate.result.person.relationship_type, "general_connect", "capture preserves existing values; UI discloses matched relationship");
    assert.ok(audit.batchRows(duplicate.batchId).some(r => r.field === "status"));
  }
  for (const sort of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const response = await get(`?sort=${sort}`); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "Invalid sort" });
  }
  await success({ action: "person.set_relationship", id, type: "mentor", strength: 3 });
  await success({ action: "person.upgrade_friend", id });
  const aff = await success({ action: "affiliation.add", personId: id, affiliation: { org: "Another API Org", role: "Member" } });
  await success({ action: "affiliation.update", id: aff.result.id, patch: { isEboard: true } });
  await success({ action: "affiliation.remove", id: aff.result.id });
  await success({ action: "touchpoint.add", personId: id, kind: "note", summary: "API touchpoint" });
  const spoof = await success({ action: "touchpoint.add", personId: id, kind: "email_received", touchpoint: { source: "gmail", gmail_account: "fixture@stern.nyu.edu", gmail_message_id: "spoof", summary: "Manual evidence" } });
  assert.ok(audit.batchRows(spoof.batchId).every(r => r.source === "manual" && r.gmail_account === "" && r.gmail_message_id === ""));
  assert.equal(people.getPerson(id).touchpoints.at(-1)?.gmail_message_id, "");
  const imported = await success({ action: "people.import", people: [{ name: "API Imported", email: "api.import@example.test" }] });
  await success({ action: "person.merge", keepId: id, dropId: imported.result[0].person.id });
  assert.equal((await (await get(`?person=${id}`)).json()).touchpoints.length, 2);
  assert.equal((await (await get("?q=API%20Student&relationshipType=friend&strengthMin=3")).json()).people.length, 1);
  for (const format of ["csv", "json"]) { const res = await get(`?export=${format}&q=API%20Student`); assert.equal(res.status, 200); assert.match(res.headers.get("content-disposition") || "", /attachment/); assert.match(await res.text(), /API Student/); }
  const archive = await success({ action: "person.archive", id }); audit.undoBatch(archive.batchId); assert.equal(people.getPerson(id).archived, 0);
  assert.equal((await post({ action: "person.update", id, patch: { status: "chatted" } })).status, 409);
  assert.equal((await get("?person=999999")).status, 404); assert.equal((await get("?export=exe")).status, 400); assert.equal((await post(null)).status, 400); assert.equal((await post({ action: "unknown" })).status, 400);
  const count = people.networkSnapshot().counts.total, files = fs.readdirSync(path.join(tmp, "vault", "Stern", "People"));
  assert.equal((await post({ action: "person.create", person: { name: "Bad affiliation rollback" }, affiliation: { clubId: 999999 } })).status, 404);
  assert.equal(people.networkSnapshot().counts.total, count); assert.deepEqual(fs.readdirSync(path.join(tmp, "vault", "Stern", "People")), files);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM people WHERE display_name='Unauthorized'").get() as { n: number }).n, 0);
});


test("fix round: archived recapture restores visibility and merge identities remain editable", async () => {
  const { people: p, audit, db } = await setup();
  const a = p.createPerson({ name: "Recaptured Example", email: "recapture@example.test" }).person;
  p.archivePerson(a.id);
  const batchId = audit.newBatchId();
  const captured = p.createPerson({ name: a.display_name, email: a.email }, { batchId });
  assert.equal(captured.person.archived, 0);
  assert.equal(p.listPeople({ q: a.email }).total, 1);
  assert.ok(audit.batchRows(batchId).some(r => r.field === "archived"));
  audit.undoBatch(batchId); assert.equal(p.getPerson(a.id).archived, 1);
  const keep = p.createPerson({ name: "Merge Fix Keep", email: "merge-fix-keep@example.test", email_alt: "occupied@example.test" }).person;
  const drop = p.createPerson({ name: "Merge Fix Drop", email: "merge-fix-drop@example.test" }).person;
  const mergeBatch = audit.newBatchId(); p.mergePeople(keep.id, drop.id, { batchId: mergeBatch });
  assert.equal(p.createPerson({ name: drop.display_name, email: drop.email }).person.id, keep.id);
  assert.match(p.getPerson(drop.id).dedupe_key, /^merged:/);
  assert.equal(p.updatePerson(drop.id, { notes: "Archived notes remain editable" }).notes, "Archived notes remain editable");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM people WHERE dedupe_key='' OR dedupe_key IS NULL").get() as { n: number }).n, 0);
});

test("fix round: undo older touchpoints recomputes contact from remaining rows", async () => {
  const { people: p, audit } = await setup();
  const a = p.createPerson({ name: "Undo Contact Example" }).person;
  const b1 = audit.newBatchId(), b2 = audit.newBatchId();
  p.addTouchpoint(a.id, "note", { occurredAt: "2026-09-01" }, { batchId: b1 });
  p.addTouchpoint(a.id, "note", { occurredAt: "2026-09-02" }, { batchId: b2 });
  audit.undoBatch(b1);
  assert.equal(p.getPerson(a.id).last_contact_at, "2026-09-02T00:00:00.000Z");
  audit.undoBatch(b2);
  assert.equal(p.getPerson(a.id).last_contact_at, "");
});

test("fix round: inherited sort keys fail validation and CSV handles whitespace formulas", async () => {
  const { people: p } = await setup();
  for (const sort of ["constructor", "__proto__", "toString", "hasOwnProperty", "bogus"]) {
    assert.throws(() => p.listPeople({ sort: sort as "name" }), (e: any) => e.status === 400 && e.message === "Invalid sort");
  }
  p.createPerson({ name: "=Formula Example", org: "+Formula Org", phone: "-555", notes: "\t @FORMULA()" });
  const csv = p.exportPeople("csv", { q: "=Formula Example" });
  for (const value of ["'=Formula Example", "'+Formula Org", "'-555", "'\t @FORMULA()"]) assert.ok(csv.includes(`"${value}"`), value);
});


test("fix round: network version changes for network writes and undo, never unrelated Stern work", async () => {
  const { people: p, audit, db } = await setup();
  const initial = p.networkSnapshot().version;
  assert.equal(typeof initial, "string"); assert.equal(p.networkSnapshot().version, initial);
  db.prepare("INSERT INTO stern_tasks(title) VALUES('Unrelated task')").run();
  assert.equal(p.networkSnapshot().version, initial);
  const person = p.createPerson({ name: "Version Example" }).person;
  let version = p.networkSnapshot().version; assert.notEqual(version, initial);
  const changed = () => { const next = p.networkSnapshot().version; assert.notEqual(next, version); version = next; };
  p.updatePerson(person.id, { notes: "Same clock edits use audit IDs" }); changed();
  const a = p.addAffiliation(person.id, { org: "Version Org" }); changed();
  p.updateAffiliation(a.id, { role: "New role" }); changed();
  const batchId = audit.newBatchId(); p.removeAffiliation(a.id, { batchId }); changed();
  audit.undoBatch(batchId); changed();
  p.addTouchpoint(person.id, "note", { summary: "New touchpoint" }); changed();
  const chatId = db.prepare("INSERT INTO coffee_chats(person_id) VALUES(?)").run(person.id).lastInsertRowid; changed();
  db.prepare("UPDATE coffee_chats SET updated_at='2026-10-01' WHERE id=?").run(chatId); changed();
  db.prepare("INSERT INTO stern_drafts(person_id) VALUES(?)").run(person.id); changed();
  assert.equal(p.networkSnapshot().version, version);
});

test("fix round: live invalidation ignores repeated snapshots and unrelated renders", async () => {
  const source = fs.readFileSync("components/stern/network/shared.tsx", "utf8");
  const ref = { current: undefined as string | undefined };
  const modules: Record<string, unknown> = { react: { useRef: () => ref, useEffect: (fn: () => void) => fn() }, "@/hooks/useApi": {}, "@/lib/stern-types": {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exported = {} as { useNetworkVersion: (v: string | undefined, cb: () => void) => void };
  new Function("require", "exports", compiled)((id: string) => modules[id] || {}, exported);
  let requests = 0;
  const refetch = () => { requests++; };
  exported.useNetworkVersion(undefined, refetch);
  exported.useNetworkVersion("network-a", refetch);
  for (let i = 0; i < 100; i++) exported.useNetworkVersion("network-a", refetch);
  assert.equal(requests, 1);
  exported.useNetworkVersion("network-b", refetch); assert.equal(requests, 2);
  exported.useNetworkVersion(undefined, refetch);
  exported.useNetworkVersion("network-b", refetch); assert.equal(requests, 2);
  for (const file of ["NetworkTable", "PersonDrawer", "QuickAddSheet"]) {
    assert.match(fs.readFileSync(`components/stern/network/${file}.tsx`, "utf8"), /useNetworkVersion\(live\?\.network.version, refetch\)/);
  }
});

test("fix round: input caps, linked organization and manual Gmail evidence", async () => {
  const { people: p, db } = await setup();
  const person = p.createPerson({ name: "Validation Example" }).person;
  assert.throws(() => p.createPerson({ name: "x".repeat(2001) }), /display_name is too long/);
  for (const [key, length] of [["org", 241], ["role", 121]] as const) assert.throws(() => p.addAffiliation(person.id, { org: "Example", [key]: "x".repeat(length) }), /too long/);
  for (const [key, length] of [["summary", 501], ["detail", 5001]] as const) assert.throws(() => p.addTouchpoint(person.id, "note", { [key]: "x".repeat(length) }), /too long/);
  const club = db.prepare("SELECT id,name FROM stern_clubs LIMIT 1").get() as { id: number; name: string };
  const a = p.addAffiliation(person.id, { clubId: club.id });
  assert.equal(p.updateAffiliation(a.id, { org: "Mismatched" }).org, club.name);
  p.addTouchpoint(person.id, "note", { source: "manual", gmailAccount: "fixture@stern.nyu.edu", gmailMessageId: "reserved-slot" });
  assert.equal(p.getPerson(person.id).touchpoints[0].gmail_message_id, "");
  assert.equal(p.getPerson(person.id).touchpoints[0].gmail_account, "");
});

test("fix round: committed writes and undo survive vault IO failures with redacted logs", async t => {
  const { people: p, audit } = await setup();
  const person = p.createPerson({ name: "Vault Failure Example", notes: "Original" }).person;
  const messages: unknown[][] = [];
  const logger = t.mock.method(console, "error", (...args: unknown[]) => messages.push(args));
  const rename = t.mock.method(fs, "renameSync", () => { throw new Error("private/filesystem/path"); });
  try {
    const batchId = audit.newBatchId();
    assert.doesNotThrow(() => p.peopleWrite(() => p.updatePerson(person.id, { notes: "Committed" }, { batchId })));
    assert.equal(p.getPerson(person.id).notes, "Committed");
    assert.doesNotThrow(() => audit.undoBatch(batchId));
    assert.equal(p.getPerson(person.id).notes, "Original");
    assert.doesNotThrow(() => p.createPerson({ name: "Failed Vault New Example" }));
    assert.ok(messages.length >= 3);
    assert.ok(messages.every(args => args.length === 1 && args[0] === "[stern] vault sync failed"));
  } finally { rename.mock.restore(); logger.mock.restore(); }
});
