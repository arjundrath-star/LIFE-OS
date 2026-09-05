import { getDb, nowIso } from '@/db';
import { ASSIGNMENT_KINDS, ASSIGNMENT_STATUSES, ASSIGNMENT_SOURCES, MEETING_KINDS, type Course, type CourseMeeting, type GradeCategory, type Assignment, type Standing, type CourseDetailData, type ClassesSnapshot, type ScheduledMeeting } from '@/lib/stern-types';
import { type AuditMeta } from './audit';
import { SternError } from './errors';
import { nyDayBounds, validDate, deadlineInstant, dayWindowSql, dayWindowParams } from './time';
import { object, text, number, choice, meta, write, row, insert, patch, remove, type Values } from './records';
const COURSE_FIELDS = ['code','title','section','professor','professor_email','term','credits','room','syllabus_url','brightspace_url','grading_notes','color','archived'];
function fields(value: unknown, allowed: string[]) { const input = object(value); for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new SternError(400, `Field is not editable: ${key}`); return input; }
export function upsertCourse(value: unknown, audit?: AuditMeta): Course {
  return write(() => {
    const m=meta(audit); const { id, ...input } = fields(value, [...COURSE_FIELDS,'id']); const values: Values = {};
    for (const [k,v] of Object.entries(input)) {
      if (k==='credits') values[k]=number(v,k,0,30,true);
      else if (k==='archived') values[k]=number(v,k,0,1,true);
      else { values[k]=text(v,k,['code','title','term'].includes(k)); if (['syllabus_url','brightspace_url'].includes(k) && v && !/^https?:\/\//i.test(String(v))) throw new SternError(400,'Course links must use http(s)'); }
    }
    if (values.code) values.code=String(values.code).toUpperCase().replace(/\s+/g,' ');
    const existing = id !== undefined ? row<Course>('course', number(id,'id',1,Infinity,true)) : getDb().prepare('SELECT * FROM courses WHERE code=? AND term=?').get(values.code || '',values.term || 'Fall 2026') as Course | undefined;
    if (existing) {
      if (values.code && values.code!==existing.code) {
        for (const assignment of getDb().prepare('SELECT * FROM assignments WHERE course_id=?').all(existing.id) as Assignment[]) patch('assignment',assignment.id,{dedupe_key:assignmentKey(String(values.code),assignment.title)},m);
      }
      return patch<Course>('course',existing.id,values,m);
    }
    text(values.code,'code',true); text(values.title,'title',true);
    return insert<Course>('course',values,m);
  });
}
export const createCourse = upsertCourse;
export const updateCourse = (id: number, input: unknown, m?: AuditMeta) => upsertCourse({...object(input),id},m);
// Archive keeps assignments/history intact and is reversible through audit undo.
export const deleteCourse = (id: number, m?: AuditMeta) => updateCourse(id,{archived:1},m);
export function upsertMeeting(value: unknown, audit?: AuditMeta): CourseMeeting {
  return write(() => {
    const { id, ...input }=fields(value,['id','course_id','weekday','start_time','end_time','room','kind']);
    const before=id !== undefined ? row<CourseMeeting>('course_meeting',number(id,'id',1,Infinity,true)) : undefined;
    const v={...before,...input}; const courseId=number(v.course_id,'course_id',1,Infinity,true); row('course',courseId);
    if (before && before.course_id!==courseId) throw new SternError(400,'Meeting cannot move between courses');
    const start=text(v.start_time ?? '', 'start_time'), end=text(v.end_time ?? '', 'end_time');
    for (const time of [start,end]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new SternError(400,'Invalid meeting time');
    if (end && (!start || end<=start)) throw new SternError(400,'Meeting end must follow start');
    const values={course_id:courseId,weekday:number(v.weekday ?? 1,'weekday',0,6,true),start_time:start,end_time:end,room:text(v.room ?? '','room'),kind:choice(v.kind ?? 'lecture',MEETING_KINDS,'kind')};
    const existing=before ?? getDb().prepare('SELECT * FROM course_meetings WHERE course_id=? AND weekday=? AND start_time=? AND kind=?').get(courseId,values.weekday,start,values.kind) as CourseMeeting | undefined;
    return existing ? patch<CourseMeeting>('course_meeting',existing.id,values,meta(audit)) : insert<CourseMeeting>('course_meeting',values,meta(audit));
  });
}
export const removeMeeting = (id: number, audit?: AuditMeta) => write(()=>remove('course_meeting',id,meta(audit)));
export function upsertCategory(value: unknown, audit?: AuditMeta): GradeCategory {
  return write(()=>{
    const {id,...input}=fields(value,['id','course_id','name','weight_pct','sort']);
    const before=id !== undefined ? row<GradeCategory>('grade_category',number(id,'id',1,Infinity,true)) : undefined;
    const v={...before,...input}; const courseId=number(v.course_id,'course_id',1,Infinity,true); row('course',courseId);
    if (before && before.course_id!==courseId) throw new SternError(400,'Category cannot move between courses');
    const values={course_id:courseId,name:text(v.name,'name',true),weight_pct:number(v.weight_pct ?? 0,'weight_pct',0,100),sort:number(v.sort ?? 0,'sort',0,Infinity,true)};
    const existing=before ?? getDb().prepare('SELECT * FROM grade_categories WHERE course_id=? AND name=?').get(courseId,values.name) as GradeCategory | undefined;
    const total=(getDb().prepare('SELECT COALESCE(SUM(weight_pct),0) n FROM grade_categories WHERE course_id=? AND id<>?').get(courseId,existing?.id ?? 0) as {n:number}).n;
    if(total+values.weight_pct>100+1e-8) throw new SternError(400,'Category weights must sum to at most 100');
    return existing ? patch<GradeCategory>('grade_category',existing.id,values,meta(audit)) : insert<GradeCategory>('grade_category',values,meta(audit));
  });
}
export function removeCategory(id:number,audit?:AuditMeta) { return write(()=>{ const m=meta(audit); row('grade_category',id); for(const a of getDb().prepare('SELECT id FROM assignments WHERE category_id=?').all(id) as {id:number}[]) patch('assignment',a.id,{category_id:0},m); remove('grade_category',id,m); }); }
export function assignmentKey(code:string,title:string) { return `${code.toLowerCase()}:${title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}`; }
const ASSIGNMENT_FIELDS=['course_id','title','kind','due_at','status','points_earned','points_possible','category_id','notes'];
function assignmentValues(value:unknown,before?:Assignment):Values {
  const input=fields(value,ASSIGNMENT_FIELDS), v={...before,...input};
  const course=row<Course>('course',number(v.course_id,'course_id',1,Infinity,true));
  if(before && before.course_id!==course.id) throw new SternError(400,'Assignment cannot move between courses');
  const title=text(v.title,'title',true); const due=text(v.due_at ?? '','due_at'); if(!validDate(due)) throw new SternError(400,'Invalid due_at');
  const category=number(v.category_id ?? 0,'category_id',0,Infinity,true);
  if(category && row<GradeCategory>('grade_category',category).course_id!==course.id) throw new SternError(400,'Category belongs to another course');
  const earned=v.points_earned == null ? null : number(v.points_earned,'points_earned');
  const possible=v.points_possible == null ? null : number(v.points_possible,'points_possible',0.000001);
  const status=choice(v.status ?? 'upcoming',ASSIGNMENT_STATUSES,'status');
  if(status==='graded' && (earned===null || possible===null)) throw new SternError(400,'Graded assignments require earned and possible points');
  return {course_id:course.id,title,kind:choice(v.kind ?? 'homework',ASSIGNMENT_KINDS,'kind'),due_at:due,status,points_earned:earned,points_possible:possible,category_id:category,notes:text(v.notes ?? '','notes'),dedupe_key:assignmentKey(course.code,title)};
}
export function createAssignment(value:unknown,audit?:AuditMeta):Assignment {
  return write(()=>{
    const {source='manual',gmail_message_id='',...input}=object(value), values=assignmentValues(input);
    const s=choice(source,ASSIGNMENT_SOURCES,'source'), message=text(gmail_message_id,'gmail_message_id');
    const existing=getDb().prepare('SELECT * FROM assignments WHERE dedupe_key=?').get(values.dedupe_key) as Assignment | undefined;
    if(existing) { if(existing.course_id!==values.course_id) throw new SternError(409,'Assignment title already exists for this course code in another term'); return existing; }
    return insert<Assignment>('assignment',{...values,source:s,gmail_message_id:message},audit ?? {...meta(),source:s});
  });
}
export function updateAssignment(id:number,value:unknown,audit?:AuditMeta):Assignment {return write(()=>patch<Assignment>('assignment',id,assignmentValues(value,row<Assignment>('assignment',id)),meta(audit)));}
export const setAssignmentStatus=(id:number,status:unknown,m?:AuditMeta)=>updateAssignment(id,{status},m);
export const gradeAssignment=(id:number,earned:unknown,possible:unknown,m?:AuditMeta)=>updateAssignment(id,{points_earned:earned,points_possible:possible,status:'graded'},m);
export const deleteAssignment=(id:number,m?:AuditMeta)=>write(()=>remove('assignment',id,meta(m)));
/** WP3 calls once per message, passing the same audit metadata/batchId as its other changes. */
export function upsertAssignmentFromEmail(courseCode:string, value:{title:string;kind?:string;dueAt?:string;points?:number|null;gmailMessageId?:string}, audit?:AuditMeta):Assignment {
  return write(()=>{
    const m=audit ?? {...meta(),source:'auto_email'};
    const matches=getDb().prepare('SELECT * FROM courses WHERE lower(code)=lower(?) AND archived=0 ORDER BY term DESC,id DESC').all(text(courseCode,'courseCode',true).replace(/\s+/g,' ')) as Course[];
    if(matches.length!==1) throw new SternError(matches.length?409:404,matches.length?'Ambiguous active course code':'Course not found');
    const course=matches[0], key=assignmentKey(course.code,text(value.title,'title',true));
    const existing=getDb().prepare('SELECT * FROM assignments WHERE dedupe_key=?').get(key) as Assignment | undefined;
    if(existing && existing.course_id!==course.id) throw new SternError(409,'Assignment belongs to another term');
    const input={title:value.title,...(value.kind!==undefined?{kind:value.kind}:{}),...(value.dueAt!==undefined?{due_at:value.dueAt}:{}),...(value.points!==undefined?{points_possible:value.points}:{})};
    if(existing) { const result=updateAssignment(existing.id,input,m); if(value.gmailMessageId) return patch<Assignment>('assignment',existing.id,{gmail_message_id:text(value.gmailMessageId,'gmailMessageId')},m); return result; }
    return createAssignment({...input,course_id:course.id,source:'auto_email',gmail_message_id:value.gmailMessageId ?? ''},m);
  });
}
export function computeStanding(courseId:number):Standing {
  row('course',courseId);
  const categories=getDb().prepare(`SELECT c.*, COALESCE(SUM(CASE WHEN a.status='graded' THEN a.points_earned END),0) earned, COALESCE(SUM(CASE WHEN a.status='graded' THEN a.points_possible END),0) possible FROM grade_categories c LEFT JOIN assignments a ON a.category_id=c.id AND a.course_id=c.course_id WHERE c.course_id=? GROUP BY c.id ORDER BY c.sort,c.id`).all(courseId) as (GradeCategory & {earned:number;possible:number})[];
  const totals=getDb().prepare("SELECT COALESCE(SUM(points_earned),0) earned,COALESCE(SUM(points_possible),0) possible FROM assignments WHERE course_id=? AND status='graded' AND points_earned IS NOT NULL AND points_possible>0").get(courseId) as {earned:number;possible:number};
  const graded=categories.filter(c=>c.possible>0 && c.weight_pct>0), weight=graded.reduce((n,c)=>n+c.weight_pct,0);
  const percentage=weight ? graded.reduce((n,c)=>n+c.earned/c.possible*c.weight_pct,0)/weight*100 : totals.possible ? totals.earned/totals.possible*100 : null;
  return {...totals,percentage,gradedWeight:weight,method:weight?'weighted':totals.possible?'unweighted':'none',categories:categories.map(c=>({...c,percentage:c.possible?c.earned/c.possible*100:null}))};
}
export function getCourse(id:number):CourseDetailData {
  const course=row<Course>('course',id), db=getDb();
  const assignments=(db.prepare('SELECT * FROM assignments WHERE course_id=?').all(id) as Assignment[]).sort((a,b)=>(a.due_at?deadlineInstant(a.due_at):Infinity)-(b.due_at?deadlineInstant(b.due_at):Infinity)||a.id-b.id);
  return {...course,assignments,meetings:db.prepare('SELECT * FROM course_meetings WHERE course_id=? ORDER BY weekday,start_time').all(id) as CourseMeeting[],categories:db.prepare('SELECT * FROM grade_categories WHERE course_id=? ORDER BY sort,id').all(id) as GradeCategory[],standing:computeStanding(id),nextDue:assignments.find(a=>['upcoming','in_progress'].includes(a.status)&&a.due_at)||null};
}
// Resolve wall-clock meetings through the NY day helper, correcting for the offset at
// the meeting itself (a DST change can occur after midnight).
function meetingInstant(date:string,time:string):string {
  const target=Date.parse(`${date}T${time}:00Z`); let guess=Date.parse(nyDayBounds(`${date}T12:00Z`).startIso)+(Number(time.slice(0,2))*60+Number(time.slice(3)))*60000;
  for(let i=0;i<2;i++){ const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)); const p=Object.fromEntries(parts.map(v=>[v.type,v.value])); const wall=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`); guess+=target-wall; }
  return new Date(guess).toISOString();
}
function scheduleDays(now:Date,start:number,end:number):ScheduledMeeting[] {
  const meetings=getDb().prepare("SELECT m.*,c.code,c.title,CASE WHEN m.room='' THEN c.room ELSE m.room END room FROM course_meetings m JOIN courses c ON c.id=m.course_id WHERE c.archived=0 AND m.start_time<>''").all() as (CourseMeeting & {code:string;title:string})[];
  const result:ScheduledMeeting[]=[];
  for(let i=start;i<=end;i++){const date=nyDayBounds(now,i).dateKey,weekday=new Date(`${date}T12:00Z`).getUTCDay(); for(const m of meetings.filter(m=>m.weekday===weekday)) result.push({...m,date,start_at:meetingInstant(date,m.start_time)});}
  return result.sort((a,b)=>a.start_at.localeCompare(b.start_at)||a.id-b.id);
}
export function weeklySchedule(now=new Date()):ScheduledMeeting[] {const weekday=new Date(`${nyDayBounds(now).dateKey}T12:00Z`).getUTCDay();const monday=1-(weekday||7);return scheduleDays(now,monday,monday+6);}
export function nextMeeting(now=new Date()):ScheduledMeeting|null {return scheduleDays(now,0,7).find(m=>Date.parse(m.start_at)>=now.getTime())??null;}
export function classesSnapshot(now=new Date()):ClassesSnapshot {
  const db=getDb(),courses=(db.prepare('SELECT id FROM courses WHERE archived=0 ORDER BY term DESC,code').all() as {id:number}[]).map(c=>getCourse(c.id));
  const dueSoon=db.prepare(`SELECT a.*,c.code course_code FROM assignments a JOIN courses c ON c.id=a.course_id WHERE c.archived=0 AND a.status IN ('upcoming','in_progress') AND ${dayWindowSql('a.due_at')}`).all(...dayWindowParams(nyDayBounds(now),nyDayBounds(now,7))) as ClassesSnapshot['dueSoon'];
  dueSoon.sort((a,b)=>deadlineInstant(a.due_at)-deadlineInstant(b.due_at));
  return {updatedAt:nowIso(),courses,schedule:weeklySchedule(now),nextMeeting:nextMeeting(now),dueSoon,standings:courses.map(c=>({courseId:c.id,standing:c.standing})),credits:(db.prepare('SELECT COALESCE(SUM(credits),0) n FROM courses WHERE archived=0').get() as {n:number}).n};
}
