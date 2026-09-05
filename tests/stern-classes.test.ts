import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const tmp=fs.mkdtempSync(path.join(process.cwd(),'.stern-wp4-test-classes-'));
process.env.RATHWORKSPACE_DB=path.join(tmp,'classes.db');process.env.STERN_VAULT_WRITE='0';
const setup=Promise.all([import('@/lib/stern/classes'),import('@/lib/stern/audit'),import('@/db'),import('@/scripts/seed-stern-courses')]).then(([c,audit,db,seed])=>({c,audit,db:db.getDb(),seed}));
test.after(async()=>{(await setup).db.close();fs.rmSync(tmp,{recursive:true,force:true});});
test('standing normalizes over graded categories and ignores ungraded possible points',async()=>{
 const {c}=await setup;const course=c.upsertCourse({code:'TEST-UB 1',title:'Example statistics'});
 const hw=c.upsertCategory({course_id:course.id,name:'Homework',weight_pct:20}),exam=c.upsertCategory({course_id:course.id,name:'Exam',weight_pct:80});
 assert.equal(c.computeStanding(course.id).percentage,null);
 const a=c.createAssignment({course_id:course.id,title:'HW 1',category_id:hw.id,points_possible:10});c.gradeAssignment(a.id,8,10);
 c.createAssignment({course_id:course.id,title:'HW 2',category_id:hw.id,points_possible:90});
 assert.equal(c.computeStanding(course.id).percentage,80);assert.equal(c.computeStanding(course.id).gradedWeight,20);
 const b=c.createAssignment({course_id:course.id,title:'Midterm',kind:'exam',category_id:exam.id});c.gradeAssignment(b.id,90,100);
 assert.equal(c.computeStanding(course.id).percentage,88);assert.equal(c.computeStanding(course.id).gradedWeight,100);
 c.setAssignmentStatus(b.id,'submitted');assert.equal(c.computeStanding(course.id).percentage,80);
});
test('unweighted fallback uses only graded points; zero earned is a real grade',async()=>{
 const {c}=await setup;const course=c.upsertCourse({code:'TEST-UB 2',title:'Example points'});
 const a=c.createAssignment({course_id:course.id,title:'One'}),b=c.createAssignment({course_id:course.id,title:'Two'});
 c.gradeAssignment(a.id,0,10);c.gradeAssignment(b.id,20,20);c.createAssignment({course_id:course.id,title:'Ungraded',points_possible:1000});
 const s=c.computeStanding(course.id);assert.equal(s.method,'unweighted');assert.ok(Math.abs(s.percentage!-200/3)<1e-8);
 assert.throws(()=>c.gradeAssignment(a.id,3,0),/points_possible/);assert.throws(()=>c.setAssignmentStatus(a.id,'unknown'),/Invalid status/);
});
test('category weights validate sum and updates exclude the edited category',async()=>{
 const {c}=await setup;const course=c.upsertCourse({code:'TEST-UB 3',title:'Example weights'});
 const a=c.upsertCategory({course_id:course.id,name:'A',weight_pct:60});c.upsertCategory({course_id:course.id,name:'B',weight_pct:40});
 assert.throws(()=>c.upsertCategory({course_id:course.id,name:'C',weight_pct:1}),/sum/);
 assert.throws(()=>c.upsertCategory({id:a.id,weight_pct:61}),/sum/);c.upsertCategory({id:a.id,weight_pct:50});
 assert.throws(()=>c.upsertCategory({id:a.id,weight_pct:-1}),/weight_pct/);
});
test('assignment email upsert dedupes normalized title, updates due and points, retains manual status and logs one message batch',async()=>{
 const {c,audit,db}=await setup;const course=c.upsertCourse({code:'EMAIL-UB 1',title:'Example email course'});
 const m={source:'auto_email',batchId:audit.newBatchId('email'),gmailMessageId:'fixture-message'};
 const a=c.upsertAssignmentFromEmail('email-ub 1',{title:' Homework: One! ',kind:'homework',dueAt:'2026-09-08',points:10},m);
 c.setAssignmentStatus(a.id,'in_progress');
 const b=c.upsertAssignmentFromEmail('EMAIL-UB 1',{title:'homework one',dueAt:'2026-09-10',points:20},m);
 assert.equal(a.id,b.id);assert.equal(b.due_at,'2026-09-10');assert.equal(b.points_possible,20);assert.equal(b.status,'in_progress');assert.equal(b.source,'auto_email');assert.equal(b.dedupe_key,'email-ub 1:homework one');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM assignments WHERE course_id=?').get(course.id) as {n:number}).n,1);
 assert.ok(audit.batchRows(m.batchId).length>1);
 const other=c.upsertCourse({code:'EMAIL-UB 1',term:'Fall 2027',title:'Later term'});assert.throws(()=>c.upsertAssignmentFromEmail('EMAIL-UB 1',{title:'Ambiguous'}),/Ambiguous/);c.deleteCourse(other.id);
 assert.throws(()=>c.upsertAssignmentFromEmail('UNKNOWN',{title:'No course'}),/not found/);
});
test('next meeting crosses week and DST boundary in America/New_York',async()=>{
 const {c}=await setup;const course=c.upsertCourse({code:'TIME-UB 1',title:'Example schedule'});
 c.upsertMeeting({course_id:course.id,weekday:1,start_time:'09:30',end_time:'10:45',room:'Example 100'});
 const next=c.nextMeeting(new Date('2026-10-31T20:00Z'));assert.equal(next?.start_at,'2026-11-02T14:30:00.000Z');assert.equal(next?.date,'2026-11-02');
 assert.equal(c.nextMeeting(new Date('2026-09-06T20:00Z'))?.start_at,'2026-09-07T13:30:00.000Z');
 assert.equal(c.weeklySchedule(new Date('2026-11-01T20:00Z')).find(m=>m.course_id===course.id)?.date,'2026-10-26');
 assert.throws(()=>c.upsertMeeting({course_id:course.id,start_time:'09:30',end_time:'08:30'}),/end must follow/);
});
test('assignment transitions and deletes are audited and reversible, including nullable grades',async()=>{
 const {c,audit}=await setup;const course=c.upsertCourse({code:'AUDIT-UB 1',title:'Example audit'});const a=c.createAssignment({course_id:course.id,title:'Lifecycle'});
 c.setAssignmentStatus(a.id,'in_progress');c.setAssignmentStatus(a.id,'submitted');const m={source:'manual',batchId:audit.newBatchId('grade')};c.gradeAssignment(a.id,9,10,m);audit.undoBatch(m.batchId);
 let restored=c.getCourse(course.id).assignments[0];assert.equal(restored.points_earned,null);assert.equal(restored.points_possible,null);assert.equal(restored.status,'submitted');
 const removed={source:'manual',batchId:audit.newBatchId('delete')};c.deleteAssignment(a.id,removed);assert.equal(c.getCourse(course.id).assignments.length,0);audit.undoBatch(removed.batchId);assert.equal(c.getCourse(course.id).assignments[0].id,a.id);
});
test('category and meeting CRUD undo restores links, and course creation undo refuses cascades',async()=>{
 const {c,audit}=await setup;const m={source:'manual',batchId:audit.newBatchId('course')};const course=c.upsertCourse({code:'CRUD-UB 1',title:'Example CRUD'},m);
 const category=c.upsertCategory({course_id:course.id,name:'Participation',weight_pct:10});const a=c.createAssignment({course_id:course.id,title:'Participation 1',category_id:category.id});
 assert.throws(()=>audit.undoBatch(m.batchId),/dependent/);
 const remove={source:'manual',batchId:audit.newBatchId('category')};c.removeCategory(category.id,remove);assert.equal(c.getCourse(course.id).assignments[0].category_id,0);audit.undoBatch(remove.batchId);assert.equal(c.getCourse(course.id).assignments.find(x=>x.id===a.id)?.category_id,category.id);
 const meeting=c.upsertMeeting({course_id:course.id,weekday:3,start_time:'14:00'});const rm={source:'manual',batchId:audit.newBatchId('meeting')};c.removeMeeting(meeting.id,rm);audit.undoBatch(rm.batchId);assert.equal(c.getCourse(course.id).meetings[0].id,meeting.id);
 const other=c.upsertCourse({code:'OTHER-UB 1',title:'Other course'});assert.throws(()=>c.updateAssignment(a.id,{course_id:other.id}),/cannot move/);
 assert.throws(()=>c.createAssignment({course_id:other.id,title:'Cross category',category_id:category.id}),/another course/);
});
test('seed is idempotent, preserves manual changes and never invents unknown schedules',async()=>{
 const {seed,c,db}=await setup;seed.seedSternCourses();const before=db.prepare('SELECT COUNT(*) FROM stern_audit_log').pluck().get();seed.seedSternCourses();assert.equal(db.prepare('SELECT COUNT(*) FROM stern_audit_log').pluck().get(),before);
 const courses=c.classesSnapshot().courses;const stat=courses.find(c=>c.code==='STAT-UB 103')!,tech=courses.find(c=>c.code==='TECH-UB 1')!,marketing=courses.find(c=>c.code==='MKTG-UB 1')!,happiness=courses.find(c=>c.code==='CAMS-UA 110')!;
 assert.equal(stat.professor,'');assert.equal(stat.meetings.length,0);assert.equal(tech.meetings.length,0);assert.equal(marketing.section,'006');assert.equal(marketing.meetings[0].start_time,'14:00');assert.equal(marketing.room,'Tisch UC04');assert.equal(happiness.meetings.length,3);assert.equal(happiness.meetings.find(m=>m.kind==='recitation')?.end_time,'');
 c.updateCourse(stat.id,{room:'Example classroom'});seed.seedSternCourses();assert.equal(c.getCourse(stat.id).room,'Example classroom');
});
test('clearing a grade is undoable without confusing NULL with empty text',async()=>{
 const {c,audit}=await setup;const course=c.upsertCourse({code:'NULL-UB 1',title:'Nullable grade example'});const a=c.createAssignment({course_id:course.id,title:'Clearable grade'});c.gradeAssignment(a.id,7,10);
 const m={source:'manual',batchId:audit.newBatchId('clear-grade')};c.updateAssignment(a.id,{points_earned:null,points_possible:null,status:'upcoming'},m);audit.undoBatch(m.batchId);
 const restored=c.getCourse(course.id).assignments[0];assert.equal(restored.points_earned,7);assert.equal(restored.points_possible,10);assert.equal(restored.status,'graded');
});
