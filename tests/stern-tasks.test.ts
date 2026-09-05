import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const tmp=fs.mkdtempSync(path.join(process.cwd(),'.stern-wp4-test-tasks-'));
process.env.RATHWORKSPACE_DB=path.join(tmp,'tasks.db');process.env.STERN_VAULT_WRITE='0';
const setup=Promise.all([import('@/lib/stern/tasks'),import('@/lib/stern/audit'),import('@/db'),import('@/lib/stern/classes')]).then(([tasks,audit,db,classes])=>({tasks,audit,db:db.getDb(),classes}));
test.after(async()=>{(await setup).db.close();fs.rmSync(tmp,{recursive:true,force:true});});
test('tasks dedupe preserves edits, validates automatic keys and editable allowlist',async()=>{
 const {tasks:t,db}=await setup;
 const a=t.createTask({title:'Example task',source:'auto',dedupe_key:'test:dedupe',domain:'campus'});
 t.updateTask(a.id,{title:'Edited title'});
 assert.equal(t.createTask({title:'Duplicate',source:'auto',dedupe_key:'test:dedupe'}).id,a.id);
 assert.equal(t.getTask(a.id).title,'Edited title');
 for(const source of ['auto','agent','imessage','seed']) {
   assert.throws(()=>t.createTask({title:'Missing automation key',source}),/dedupe_key/);
   const created=t.createTask({title:'Automated fixture',source,dedupe_key:`fixture:${source}`});
   assert.equal(t.createTask({title:'Duplicate fixture',source,dedupe_key:`fixture:${source}`}).id,created.id);
 }
 assert.throws(()=>t.createTask({title:'Manual collision',dedupe_key:'test:dedupe'}),{status:409});
 assert.throws(()=>t.createTask({title:'Invalid due',due_at:'2026-02-30'}),/Invalid due/);
 assert.throws(()=>t.createTask({title:'No title',priority:4}),/priority/);
 assert.throws(()=>t.updateTask(a.id,{source:'auto'}),/not editable/);
 assert.throws(()=>t.updateTask(a.id,{status:'done'}),/not editable/);
 assert.throws(()=>t.createTask({title:'Bad link',person_id:99999}),/Unknown/);
 assert.equal((db.prepare("SELECT COUNT(*) n FROM stern_tasks WHERE dedupe_key='test:dedupe'").get() as {n:number}).n,1);
});
test('EDT buckets are disjoint, use NY dates, and roll weeks on Monday',async()=>{
 const {tasks:t}=await setup;const fixture=JSON.parse(fs.readFileSync('tests/fixtures/stern/wp4-tasks.json','utf8')) as {title:string;due_at:string}[];
 for(const task of fixture)t.createTask({...task,domain:'academic'});
 const now=new Date('2026-09-06T02:00:00Z'); // Saturday 22:00 EDT
 const titles=(due:'overdue'|'today'|'week'|'later'|'none')=>t.listTasks({due,domain:['academic']},now).map(t=>t.title);
 assert.deepEqual(titles('overdue'),['Previous New York day']);
 assert.deepEqual(titles('today').sort(),['Today date only','Today late offset']);
 assert.deepEqual(titles('week'),['Sunday']);assert.deepEqual(titles('later'),['Next week']);assert.deepEqual(titles('none'),['Undated']);
 const groups=t.groupForUi(t.listTasks({domain:['academic']},now),now);assert.equal(groups.flatMap(g=>g.rows).length,fixture.length);
 assert.equal(t.listTasks({due:'week',domain:['academic']},new Date('2026-09-06T16:00:00Z')).length,0);
 assert.equal(t.tasksSnapshot(now).counts.dueToday,2);assert.equal(t.tasksSnapshot(now).counts.perDomain.academic,6);
});
test('DST day boundaries respect whole dates and offset instants',async()=>{
 const {tasks:t}=await setup;
 t.createTask({title:'DST date',due_at:'2026-11-01',domain:'professional'});
 t.createTask({title:'DST late',due_at:'2026-11-02T04:59:59Z',domain:'professional'});
 t.createTask({title:'Next day instant',due_at:'2026-11-02T05:00:00Z',domain:'professional'});
 assert.deepEqual(t.listTasks({due:'today'},new Date('2026-11-01T16:00Z')).map(t=>t.title).sort(),['DST date','DST late']);
});
test('complete, reopen, drop and undo log every actual write with one batch',async()=>{
 const {tasks:t,audit,db}=await setup;const a=t.createTask({title:'Transitions'});
 const m={source:'manual',batchId:audit.newBatchId('complete')};t.complete(a.id,m);assert.equal(t.getTask(a.id).status,'done');assert.ok(t.getTask(a.id).completed_at);
 const count=()=>Number(db.prepare('SELECT COUNT(*) FROM stern_audit_log WHERE batch_id=?').pluck().get(m.batchId));const n=count();t.complete(a.id,m);assert.equal(count(),n);
 audit.undoBatch(m.batchId);assert.equal(t.getTask(a.id).status,'open');assert.equal(t.getTask(a.id).completed_at,'');
 t.complete(a.id);t.reopen(a.id);assert.equal(t.getTask(a.id).completed_at,'');t.drop(a.id);assert.equal(t.getTask(a.id).status,'dropped');t.reopen(a.id);assert.equal(t.getTask(a.id).status,'open');
 const old={source:'manual',batchId:audit.newBatchId('old')};t.updateTask(a.id,{title:'Older'},old);t.updateTask(a.id,{title:'Newer'});audit.undoBatch(old.batchId);assert.equal(t.getTask(a.id).title,'Newer');
});
test('SQL joins resolve linked labels and filters',async()=>{
 const {tasks:t,classes:c,db}=await setup;const course=c.upsertCourse({code:'TEST-UB 101',title:'Example course'});
 const person=Number(db.prepare("INSERT INTO people(display_name) VALUES('Example Student')").run().lastInsertRowid);
 const process=Number(db.prepare("INSERT INTO stern_processes(slug,name) VALUES('test-tasks','Example season')").run().lastInsertRowid);
 const club=Number(db.prepare("INSERT INTO stern_clubs(process_id,name,slug) VALUES(?,'Example Club','example')").run(process).lastInsertRowid);
 const a=t.createTask({title:'Linked',course_id:course.id,club_id:club,person_id:person});assert.equal(a.course_code,'TEST-UB 101');assert.equal(a.person_name,'Example Student');assert.equal(a.club_name,'Example Club');
 assert.deepEqual(t.listTasks({linked:{type:'course',id:course.id}}).map(t=>t.id),[a.id]);
});
test('legacy migration is idempotent, audited and cannot resurrect an undone import',async()=>{
 const {db,audit}=await setup;const id=Number(db.prepare("INSERT INTO todos(text,done,due) VALUES('Example legacy todo',1,NULL)").run().lastInsertRowid);
 const sql=fs.readFileSync('db/migrations/0031_stern_todos_migrate.sql','utf8');db.transaction(()=>db.exec(sql)).immediate();db.transaction(()=>db.exec(sql)).immediate();
 const rows=db.prepare('SELECT * FROM stern_tasks WHERE dedupe_key=?').all(`legacy-todo:${id}`) as {status:string;source:string;due_at:string;completed_at:string}[];
 assert.equal(rows.length,1);assert.equal(rows[0].status,'done');assert.equal(rows[0].source,'seed');assert.equal(rows[0].due_at,'');assert.equal(rows[0].completed_at,'');
 assert.equal(db.prepare('SELECT COUNT(*) FROM stern_audit_log WHERE batch_id=?').pluck().get(`legacy-todo:${id}`),1);
 audit.undoBatch(`legacy-todo:${id}`);db.transaction(()=>db.exec(sql)).immediate();assert.equal(db.prepare('SELECT COUNT(*) FROM stern_tasks WHERE dedupe_key=?').pluck().get(`legacy-todo:${id}`),0);
 assert.ok(db.prepare('SELECT id FROM todos WHERE id=?').get(id));
});

test('legacy non-date deadlines preserve raw notes and never break Stern snapshots',async()=>{
 const {db,tasks:t,audit}=await setup;
 const values=['Friday','next friday','tomorrow','2026-99-99','2026-02-30','2026-09-20garbage','2026-09-20','2026-09-20T14:00:00Z'];
 const ids=values.map(due=>Number(db.prepare("INSERT INTO todos(text,done,due) VALUES('Legacy deadline fixture',0,?)").run(due).lastInsertRowid));
 const sql=fs.readFileSync('db/migrations/0031_stern_todos_migrate.sql','utf8');
 db.transaction(()=>db.exec(sql)).immediate();db.transaction(()=>db.exec(sql)).immediate();
 ids.forEach((id,index)=>{
   const task=db.prepare('SELECT * FROM stern_tasks WHERE dedupe_key=?').get(`legacy-todo:${id}`) as {due_at:string;notes:string};
   assert.equal(task.due_at,index<6?'':values[index]);
   assert.equal(task.notes,index<6?`Legacy due: ${values[index]}`:'');
   const rows=audit.batchRows(`legacy-todo:${id}`);assert.equal(rows.length,1);
   assert.equal(JSON.parse(rows[0].after_value).notes,task.notes);
 });
 // Existing installations may already contain bad rows; migration replay cannot repair them.
 const broken=values.slice(0,6).map(due=>Number(db.prepare("INSERT INTO stern_tasks(title,due_at) VALUES('Invalid stored deadline',?)").run(due).lastInsertRowid));
 const now=new Date('2026-09-05T12:00:00Z');
 const snapshot=t.tasksSnapshot(now),undated=snapshot.groups.find(g=>g.key==='none')!;
 assert.equal(undated.title,'No date');
 for(const id of broken)assert.ok(undated.rows.some(t=>t.id===id));
 const {sternSnapshot}=await import('@/lib/stern/snapshot');
 assert.doesNotThrow(()=>sternSnapshot(now));
});
test('snapshot bounds closed history by id while keeping every open task and all done today',async()=>{
 const {db,tasks:t}=await setup;
 const open=t.createTask({title:'Open fixture survives history cap'});
 const first=t.createTask({title:'Old completed fixture'});t.complete(first.id);
 for(let i=0;i<105;i++)t.drop(t.createTask({title:`Closed fixture ${i}`}).id);
 const snapshot=t.tasksSnapshot();
 const expected=(db.prepare("SELECT id FROM stern_tasks WHERE status<>'open' ORDER BY id DESC LIMIT 100").all() as {id:number}[]).reverse().map(t=>t.id);
 assert.deepEqual(snapshot.tasks.filter(t=>t.status!=='open').map(t=>t.id),expected);
 assert.ok(snapshot.tasks.some(t=>t.id===open.id));
 assert.ok(!snapshot.tasks.some(t=>t.id===first.id));
 assert.ok(snapshot.doneToday.some(t=>t.id===first.id));
 assert.equal(snapshot.counts.open,db.prepare("SELECT COUNT(*) FROM stern_tasks WHERE status='open'").pluck().get());
});
