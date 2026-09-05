import { getDb, nowIso } from '@/db';
import { TASK_DOMAINS, TASK_STATUSES, TASK_SOURCES, type SternTask, type TaskFilters, type TaskGroup, type TasksSnapshot, type TaskBucket } from '@/lib/stern-types';
import { type AuditMeta } from './audit';
import { SternError } from './errors';
import { nyDayBounds, deadlineDays, deadlineInstant, validDate, dayWindowSql, dayWindowParams, beforeDaySql } from './time';
import { object, text, number, choice, meta, write, insert, patch, row, type Values } from './records';
export const EDITABLE = ['title', 'domain', 'course_id', 'club_id', 'program_id', 'person_id', 'assignment_id', 'due_at', 'priority', 'notes'] as const;
const links = { course_id: 'courses', club_id: 'stern_clubs', program_id: 'stern_programs', person_id: 'people', assignment_id: 'assignments' } as const;
function clean(value: unknown): Values {
  const input = object(value), result: Values = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(EDITABLE as readonly string[]).includes(k)) throw new SternError(400, `Task field is not editable: ${k}`);
    if (k in links) {
      result[k] = number(v, k, 0, Infinity, true);
      if (v && !getDb().prepare(`SELECT id FROM ${links[k as keyof typeof links]} WHERE id=?`).get(v)) throw new SternError(400, `Unknown ${k}`);
    } else if (k === 'priority') result[k] = number(v, k, 1, 3, true);
    else if (k === 'domain') result[k] = choice(v, TASK_DOMAINS, k);
    else { result[k] = text(v, k, k === 'title'); if (k === 'due_at' && !validDate(result[k] as string)) throw new SternError(400, 'Invalid due_at'); }
  }
  return result;
}
export function createTask(value: unknown, audit?: AuditMeta): SternTask {
  return write(() => {
    const { source = 'manual', dedupe_key = '', ...input } = object(value);
    const s = choice(source, TASK_SOURCES, 'source'), key = text(dedupe_key, 'dedupe_key');
    if (['auto', 'agent'].includes(s) && !key) throw new SternError(400, 'Automated tasks require dedupe_key');
    const values = clean(input); text(values.title, 'title', true);
    if (key) { const existing = getDb().prepare('SELECT id FROM stern_tasks WHERE dedupe_key=?').get(key) as { id: number } | undefined; if (existing) return getTask(existing.id); }
    const m = audit ?? { ...meta(), source: s === 'auto' ? 'auto_email' : s };
    const created = insert<SternTask>('task', { ...values, source: s, dedupe_key: key }, m); return getTask(created.id);
  });
}
export function updateTask(id: number, value: unknown, audit?: AuditMeta): SternTask { return write(() => { patch('task', id, clean(value), meta(audit)); return getTask(id); }); }
function transition(id: number, status: string, audit?: AuditMeta) {
  return write(() => { row('task', id); patch('task', id, { status, completed_at: status === 'done' ? (row<SternTask>('task', id).completed_at || nowIso()) : '' }, meta(audit)); return getTask(id); });
}
export const complete = (id: number, m?: AuditMeta) => transition(id, 'done', m);
export const reopen = (id: number, m?: AuditMeta) => transition(id, 'open', m);
export const drop = (id: number, m?: AuditMeta) => transition(id, 'dropped', m);
const SELECT = `SELECT t.*, COALESCE(c.code,'') course_code, COALESCE(cl.name,'') club_name, COALESCE(p.display_name,'') person_name FROM stern_tasks t LEFT JOIN courses c ON c.id=t.course_id LEFT JOIN stern_clubs cl ON cl.id=t.club_id LEFT JOIN people p ON p.id=t.person_id`;
export function getTask(id: number): SternTask { row('task', id); return getDb().prepare(`${SELECT} WHERE t.id=?`).get(id) as SternTask; }
export function listTasks(filters: TaskFilters = {}, now = new Date()): SternTask[] {
  const where: string[] = [], params: (string | number)[] = [];
  if (filters.status !== 'all') { where.push('t.status=?'); params.push(choice(filters.status ?? 'open', TASK_STATUSES, 'status')); }
  if (filters.domain?.length) { where.push(`t.domain IN (${filters.domain.map(() => '?').join(',')})`); params.push(...filters.domain.map(d => choice(d, TASK_DOMAINS, 'domain'))); }
  if (filters.linked) { const column = `${filters.linked.type}_id`; if (!(column in links)) throw new SternError(400, 'Invalid linked entity'); where.push(`t.${column}=?`); params.push(number(filters.linked.id, 'linked id', 1, Infinity, true)); }
  const today = nyDayBounds(now), weekEnd = nyDayBounds(now, 7 - (new Date(`${today.dateKey}T12:00Z`).getUTCDay() || 7));
  if (filters.due) {
    choice(filters.due, ['today','overdue','week','later','none'], 'due bucket');
    if (filters.due === 'none') where.push("t.due_at=''");
    else if (filters.due === 'overdue') { where.push(beforeDaySql('t.due_at')); params.push(today.dateKey, today.startIso); }
    else if (filters.due === 'later') { const next = nyDayBounds(weekEnd.endIso); where.push(`t.due_at<>'' AND NOT ${beforeDaySql('t.due_at')}`); params.push(next.dateKey, next.startIso); }
    else { const start = filters.due === 'today' ? today : nyDayBounds(now, 1); const end = filters.due === 'today' ? today : weekEnd; where.push(dayWindowSql('t.due_at')); params.push(...dayWindowParams(start, end)); }
  }
  const rows = getDb().prepare(`${SELECT}${where.length ? ' WHERE '+where.join(' AND ') : ''}`).all(...params) as SternTask[];
  return rows.sort((a,b) => (a.due_at ? deadlineInstant(a.due_at) : Infinity) - (b.due_at ? deadlineInstant(b.due_at) : Infinity) || a.priority-b.priority || a.id-b.id);
}
export function groupForUi(tasks: SternTask[], now = new Date()): TaskGroup[] {
  const daysLeft = 7 - (new Date(`${nyDayBounds(now).dateKey}T12:00Z`).getUTCDay() || 7);
  const groups: TaskGroup[] = [{ key:'overdue',title:'Overdue',rows:[] },{ key:'today',title:'Today',rows:[] },{ key:'week',title:'This week',rows:[] },{ key:'later',title:'Later',rows:[] },{ key:'none',title:'No due date',rows:[] }];
  for (const task of tasks) { const days = task.due_at ? deadlineDays(task.due_at, now) : Infinity; const key: TaskBucket = !task.due_at ? 'none' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= daysLeft ? 'week' : 'later'; groups.find(g => g.key === key)!.rows.push(task); }
  return groups;
}
export function tasksSnapshot(now = new Date()): TasksSnapshot {
  const tasks = listTasks({status:'all'}, now), today = nyDayBounds(now), db = getDb();
  const counts = db.prepare(`SELECT COUNT(*) open, SUM(CASE WHEN domain='academic' THEN 1 ELSE 0 END) academic, SUM(CASE WHEN domain='professional' THEN 1 ELSE 0 END) professional, SUM(CASE WHEN domain='campus' THEN 1 ELSE 0 END) campus FROM stern_tasks WHERE status='open'`).get() as Record<string,number>;
  const dueToday = listTasks({due:'today'}, now), overdue = listTasks({due:'overdue'}, now);
  const doneToday = db.prepare(`${SELECT} WHERE t.status='done' AND ${dayWindowSql('t.completed_at')}`).all(...dayWindowParams(today,today)) as SternTask[];
  return { updatedAt: nowIso(), tasks, dueToday, overdue, doneToday, groups: groupForUi(tasks.filter(t=>t.status==='open'),now), counts: { open:counts.open, dueToday:(db.prepare(`SELECT COUNT(*) n FROM stern_tasks WHERE status='open' AND ${dayWindowSql('due_at')}`).get(...dayWindowParams(today,today)) as {n:number}).n, overdue:(db.prepare(`SELECT COUNT(*) n FROM stern_tasks WHERE status='open' AND ${beforeDaySql('due_at')}`).get(today.dateKey,today.startIso) as {n:number}).n, perDomain:{academic:counts.academic||0,professional:counts.professional||0,campus:counts.campus||0} }, links: db.prepare(`SELECT 'course' type,id,code label FROM courses WHERE archived=0 UNION ALL SELECT 'club',id,name FROM stern_clubs WHERE status<>'archived' UNION ALL SELECT 'person',id,display_name FROM people WHERE archived=0 ORDER BY label`).all() as TasksSnapshot['links'] };
}
