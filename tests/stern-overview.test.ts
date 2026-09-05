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
 insert.run('other@example.com',fixtures[0].event_id,fixtures[0].title,'2026-09-04T21:00:00-04:00',fixtures[0].kind,program);
 insert.run('student@example.com','class-copy','Example course calendar copy','2026-09-04T13:30:00Z','class',0);
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
test('archived people do not inflate reply badge or coffee obligations',async()=>{
 const {db,sternSnapshot,needsYou}=await setup;
 const active=Number(db.prepare("INSERT INTO people(display_name) VALUES('Active Example')").run().lastInsertRowid);
 const archived=Number(db.prepare("INSERT INTO people(display_name,archived) VALUES('Archived Example',1)").run().lastInsertRowid);
 for(const id of [active,archived])db.prepare("INSERT INTO coffee_chats(person_id,state,reply_needs_me) VALUES(?,'reply_received',1)").run(id);
 const snapshot=sternSnapshot();
 assert.equal(snapshot.counts.replyOwed,needsYou().filter(n=>n.kind==='reply').length);
 assert.equal(snapshot.counts.replyOwed,1);assert.equal(snapshot.counts.coffeeChatsOwed,1);
});
test('audit and suggestions resolve names and actual classifier effects without changing stored evidence',async()=>{
 const {db,sternSnapshot}=await setup;
 const {auditTail}=await import('@/lib/stern/audit');
 const {automationDetails}=await import('@/lib/stern/automation-snapshot');
 const {suggestionSummary,entityLabel}=await import('@/lib/stern/display');
 const program=db.prepare("SELECT id FROM stern_programs WHERE name='Example program'").get() as {id:number};
 const course=db.prepare("SELECT id FROM courses WHERE code='TEST-UB 1'").get() as {id:number};
 assert.equal(entityLabel('program',program.id),'Example club · Example program');
 assert.equal(entityLabel('course',course.id),'TEST-UB 1');
 const person=Number(db.prepare("INSERT INTO people(display_name) VALUES('Example Reviewer')").run().lastInsertRowid);
 db.prepare("INSERT INTO stern_audit_log(entity_type,entity_id,action,field,before_value,after_value,source) VALUES('person',?,'update','status','reached_out','replied','auto_email')").run(person);
 assert.equal(auditTail().find(r=>r.entity_type==='person'&&r.entity_id===person)!.entity_label,'Example Reviewer');assert.equal(auditTail().find(r=>r.entity_type==='person'&&r.entity_id===person)!.before_value,'reached_out');
 assert.equal(sternSnapshot().autoAppliedToday.find(r=>r.entity_type==='person'&&r.entity_id===person)!.entity_label,'Example Reviewer');
 db.prepare("INSERT INTO stern_suggestions(dedupe_key,entity_type,entity_id,suggestion_type,proposed_data,evidence_type,gmail_account) VALUES('display','person',?,'person_status',?, 'gmail','example@stern.nyu.edu')").run(person,JSON.stringify({status:'replied'}));
 const suggestion=automationDetails().suggestions.find(s=>s.entity_id===person)!;
 assert.equal(suggestion.summary,'Mark Example Reviewer as Replied');assert.equal(suggestion.evidence_type,'gmail');assert.ok(suggestion.created_at);
 const effect={kind:'coffee',classification:{category:'coffee_chat_reply_positive',people:[{name:'Example Contact'}]}};
 assert.equal(suggestionSummary({...suggestion,proposed_data:JSON.stringify([effect])}),'Mark Example Contact as Reply received');
 assert.equal(suggestionSummary({...suggestion,proposed_data:'broken'}),'Person status');
 db.prepare("INSERT INTO stern_audit_log(entity_type,entity_id,action,source) VALUES('person',99999,'delete','manual')").run();
 assert.equal(auditTail().at(-1)?.entity_label,'Person #99999');
});
test('connection read models use scheduler cache and carry five cards over the live snapshot',async()=>{
 const {db,sternSnapshot}=await setup;
 const {getDef}=await import('@/lib/connections/registry');
 const def=getDef('stern-llm-codex')!,original=def.check;
 def.check=async()=>{throw new Error('Rendering must not probe');};
 try {
 db.prepare("INSERT OR REPLACE INTO connections(service,surface,state,detail,last_checked) VALUES('stern-llm-codex','dashboard','on_healthy','Cached classifier','2026-09-05T12:00Z')").run();
 const cards=sternSnapshot().automation.connections;
 assert.equal(cards.length,5);assert.equal(cards.find(c=>c.id==='stern-llm-codex')?.detail,'Cached classifier');
 db.prepare("UPDATE connections SET state='on_broken',detail='Cached failure' WHERE service='stern-llm-codex'").run();
 assert.equal(sternSnapshot().automation.connections.find(c=>c.id==='stern-llm-codex')?.detail,'Cached failure');
 }finally{def.check=original;}
});
test('needs-you preview is bounded and preserves the full SQL total',async()=>{
 const {db,needsYou,needsYouTotal}=await setup;
 const before=needsYouTotal();
 for(let i=0;i<105;i++)db.prepare("INSERT INTO stern_suggestions(dedupe_key) VALUES(?)").run(`bounded-${i}`);
 assert.equal(needsYou().filter(n=>n.kind==='suggestion').length,100);
 assert.equal(needsYouTotal(),before+105);
});
