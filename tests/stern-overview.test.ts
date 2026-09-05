import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const tmp=fs.mkdtempSync(path.join(process.cwd(),'.stern-wp6-overview-'));
process.env.RATHWORKSPACE_DB=path.join(tmp,'test.db');process.env.STERN_VAULT_WRITE='0';process.env.STERN_LLM_MODE='fixture';
const setup=Promise.all([import('@/db'),import('@/lib/stern/overview'),import('@/lib/stern/snapshot')]).then(([db,overview,snapshot])=>({db:db.getDb(),...overview,...snapshot}));
test.after(async()=>{(await setup).db.close();fs.rmSync(tmp,{recursive:true,force:true});});
test('schedule merges recurring courses and calendars on the EDT date, sorts instants, and dedupes cross-account events',async()=>{
 const {db,todaySchedule}=await setup;
 const course=Number(db.prepare("INSERT INTO courses(code,title,room) VALUES('TEST-UB 1','Example course','Example room')").run().lastInsertRowid);
 db.prepare("INSERT INTO course_meetings(course_id,weekday,start_time,end_time) VALUES(?,5,'09:30','10:45')").run(course);
 const processId=Number(db.prepare("INSERT INTO stern_processes(slug,name) VALUES('test','Test process')").run().lastInsertRowid);
 const club=Number(db.prepare("INSERT INTO stern_clubs(process_id,name,slug) VALUES(?,'Example club','example')").run(processId).lastInsertRowid);
 const program=Number(db.prepare("INSERT INTO stern_programs(club_id,name) VALUES(?,'Example program')").run(club).lastInsertRowid);
 const insert=db.prepare('INSERT INTO stern_calendar_events(account,event_id,title,start_at,kind,program_id) VALUES(?,?,?,?,?,?)');
 const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/stern/wp6-schedule.json','utf8'));
 for(const e of fixtures)insert.run('student@example.com',e.event_id,e.title,e.start_at,e.kind,program);
 insert.run('other@example.com',fixtures[0].event_id,fixtures[0].title,fixtures[0].start_at,fixtures[0].kind,program);
 const rows=todaySchedule(new Date('2026-09-05T03:30Z'));
 assert.deepEqual(rows.map(r=>r.title),['Morning interview','TEST-UB 1 · Example course','Example coffee chat']);
 assert.equal(rows[1].startAt,'2026-09-04T13:30:00.000Z');assert.equal(rows[1].location,'Example room');
 assert.equal(rows[0].prepHref,`/stern/recruiting/${club}#prep`);
 assert.deepEqual(todaySchedule(new Date('2026-09-05T04:00Z')).map(r=>r.title),['Tomorrow event']);
 assert.equal(todaySchedule(new Date('2026-12-04T12:00Z'))[0].startAt,'2026-12-04T14:30:00.000Z');
});
test('needs-you follows reply, thank-you, draft, and suggestion transitions without duplicate joins',async()=>{
 const {db,needsYou}=await setup;
 const p=Number(db.prepare("INSERT INTO people(display_name) VALUES('Example Person')").run().lastInsertRowid);
 const chat=Number(db.prepare("INSERT INTO coffee_chats(person_id,state,reply_needs_me) VALUES(?,'reply_received',1)").run(p).lastInsertRowid);
 assert.equal(needsYou()[0].kind,'reply');assert.equal(needsYou()[0].href,`/stern/network?person=${p}`);
 db.prepare("UPDATE coffee_chats SET state='scheduled',reply_needs_me=0 WHERE id=?").run(chat);assert.equal(needsYou().length,0);
 db.prepare("UPDATE coffee_chats SET state='done' WHERE id=?").run(chat);assert.equal(needsYou()[0].kind,'thank_you');
 db.prepare("UPDATE coffee_chats SET thank_you_sent_at='2026-09-04T14:00Z',state='thank_you_sent' WHERE id=?").run(chat);assert.equal(needsYou().length,0);
 const draft=Number(db.prepare("INSERT INTO stern_drafts(person_id,subject) VALUES(?,'Example draft')").run(p).lastInsertRowid);
 const suggestion=Number(db.prepare("INSERT INTO stern_suggestions(dedupe_key,evidence_subject) VALUES('wp6:test','Example suggestion')").run().lastInsertRowid);
 assert.deepEqual(needsYou().map(r=>r.kind),['draft','suggestion']);assert.equal(needsYou().length,new Set(needsYou().map(r=>r.key)).size);
 db.prepare("UPDATE stern_drafts SET state='copied' WHERE id=?").run(draft);
 for(const state of ['accepted','dismissed']) {db.prepare('UPDATE stern_suggestions SET state=? WHERE id=?').run(state,suggestion);assert.equal(needsYou().length,0);}
 db.prepare("UPDATE stern_drafts SET state='generated' WHERE id=?").run(draft);db.prepare('UPDATE people SET archived=1 WHERE id=?').run(p);assert.equal(needsYou().length,0);
});
test('memo line only reports sent rows from today; skipped dry runs never claim delivery',async()=>{
 const {db,sternSnapshot}=await setup;
 const put=db.prepare("INSERT INTO stern_reminders(rule_key,fire_at,delivery_status,sent_at) VALUES('memo',?,?,?)");
 put.run('2026-09-04T12:00Z','sent','2026-09-04T12:00Z');
 put.run('2026-09-05T12:00Z','skipped','2026-09-05T12:00Z');
 assert.equal(sternSnapshot(new Date('2026-09-05T16:00Z')).reminders.lastMemoAt,'');
 assert.equal(sternSnapshot(new Date('2026-09-04T16:00Z')).reminders.lastMemoAt,'2026-09-04T12:00Z');
});
