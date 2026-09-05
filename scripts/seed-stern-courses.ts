import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '@/db';
import { upsertCourse, upsertMeeting } from '@/lib/stern/classes';
import { newBatchId } from '@/lib/stern/audit';
import { write } from '@/lib/stern/records';
import type { CourseMeeting } from '@/lib/stern-types';
export function seedSternCourses(){return write(()=>{
  const seed=JSON.parse(fs.readFileSync(path.join(process.cwd(),'docs/plans/stern/seeds/courses-fall-2026.json'),'utf8')) as ({code:string;term:string;title:string;meetings:Partial<CourseMeeting>[]} & Record<string,unknown>)[];
  const m={source:'seed',batchId:newBatchId('courses-seed')};
  for(const {meetings,...course} of seed){
    // Reruns preserve manual corrections, including deliberately blank fields.
    const existing=getDb().prepare('SELECT id FROM courses WHERE code=? AND term=?').get(course.code,course.term) as {id:number}|undefined;
    if(existing)continue;
    const created=upsertCourse(course,m);
    for(const meeting of meetings)upsertMeeting({...meeting,course_id:created.id},m);
  }
  return {courses:(getDb().prepare('SELECT COUNT(*) n FROM courses WHERE term=?').get('Fall 2026') as {n:number}).n,batchId:m.batchId};
});}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(seedSternCourses()));
