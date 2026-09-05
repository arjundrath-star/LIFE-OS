import { getDb } from '@/db';
import type { SternNeed, SternScheduleItem, CourseMeeting } from '@/lib/stern-types';
import { nyDayBounds, nyWallTime, dayWindowSql, dayWindowParams } from './time';

/** Recurring classes and synced calendar events share New York wall-clock ordering. */
export function todaySchedule(now = new Date()): SternScheduleItem[] {
  const db = getDb(), day = nyDayBounds(now);
  const weekday = new Date(`${day.dateKey}T12:00Z`).getUTCDay();
  const meetings = db.prepare(`SELECT m.*, c.code, c.title, COALESCE(NULLIF(m.room,''),c.room) location
    FROM course_meetings m JOIN courses c ON c.id=m.course_id WHERE c.archived=0 AND m.weekday=?`).all(weekday) as (CourseMeeting & {code:string;title:string;location:string})[];
  const rows: SternScheduleItem[] = meetings.filter(m => /^([01]\d|2[0-3]):[0-5]\d$/.test(m.start_time)).map(m => ({ key:`course-${m.id}`, title:`${m.code} · ${m.title}`,
    startAt:nyWallTime(day.dateKey,m.start_time).toISOString(), location:m.location, kind:m.kind,
    href:`/stern/classes/${m.course_id}`, prepHref:'' }));
  const events = db.prepare(`SELECT e.*, COALESCE(NULLIF(ch.club_id,0),p.club_id,0) club_id
    FROM stern_calendar_events e LEFT JOIN coffee_chats ch ON ch.id=e.coffee_chat_id
    LEFT JOIN stern_programs p ON p.id=e.program_id WHERE e.kind <> 'class' AND ${dayWindowSql('e.start_at')}
    ORDER BY e.id`).all(...dayWindowParams(day,day)) as {id:number;event_id:string;title:string;start_at:string;location:string;kind:string;club_id:number;person_id:number}[];
  // The same Google event may be visible in both connected accounts. Keep one occurrence.
  const seen = new Set<string>();
  for (const e of events) {
    const key = `${e.event_id || e.id}:${Date.parse(e.start_at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({key:`calendar-${e.id}`, title:e.title || 'Untitled calendar event',startAt:e.start_at,
      location:e.location,kind:e.kind,href:e.person_id?`/stern/network?person=${e.person_id}`:'',
      prepHref:e.club_id?`/stern/recruiting/${e.club_id}#prep`:''});
  }
  return rows.sort((a,b) => (Date.parse(a.startAt.length===10?day.startIso:a.startAt)-Date.parse(b.startAt.length===10?day.startIso:b.startAt)) || a.key.localeCompare(b.key));
}

export function needsYou(): SternNeed[] {
  const db=getDb();
  const chats=db.prepare(`SELECT c.id,c.person_id,c.state,c.reply_needs_me,c.reply_at,c.occurred_at,p.display_name
    FROM coffee_chats c JOIN people p ON p.id=c.person_id WHERE p.archived=0 AND
    ((c.reply_needs_me=1 AND c.state NOT IN ('done','thank_you_sent','declined','no_reply')) OR (c.state='done' AND c.thank_you_sent_at='')) ORDER BY c.id LIMIT 100`).all() as {id:number;person_id:number;state:string;reply_at:string;occurred_at:string;display_name:string}[];
  const rows: SternNeed[]=chats.map(c=>({key:`chat-${c.id}`,kind:c.state==='done'?'thank_you':'reply',
    title:`${c.state==='done'?'Thank-you due':'Reply waiting on you'} · ${c.display_name}`,at:c.state==='done'?c.occurred_at:c.reply_at,
    href:`/stern/network?person=${c.person_id}`,actionLabel:c.state==='done'?'Draft':'Open'}));
  const drafts=db.prepare(`SELECT d.id,d.person_id,d.subject,d.created_at,p.display_name FROM stern_drafts d
    LEFT JOIN people p ON p.id=d.person_id WHERE d.state='generated' AND (p.id IS NULL OR p.archived=0) ORDER BY d.id DESC LIMIT 100`).all().reverse() as {id:number;person_id:number;subject:string;created_at:string;display_name:string}[];
  for(const d of drafts) rows.push({key:`draft-${d.id}`,kind:'draft',title:`Draft ready to review · ${d.display_name||d.subject||'Draft'}`,at:d.created_at,href:`/stern/automation#draft-${d.id}`,actionLabel:'Review'});
  const suggestions=db.prepare("SELECT id,evidence_subject,created_at FROM stern_suggestions WHERE state='pending' ORDER BY id DESC LIMIT 100").all().reverse() as {id:number;evidence_subject:string;created_at:string}[];
  for(const s of suggestions) rows.push({key:`suggestion-${s.id}`,kind:'suggestion',title:`Suggestion pending · ${s.evidence_subject||'Review proposed change'}`,at:s.created_at,href:`/stern/automation#suggestion-${s.id}`,actionLabel:'Review'});
  return rows;
}

/** Full obligation total, independent of the bounded per-kind preview lists. */
export function needsYouTotal(): number {
  const db=getDb();
  const {n}=db.prepare(`SELECT
    (SELECT COUNT(*) FROM coffee_chats c JOIN people p ON p.id=c.person_id WHERE p.archived=0 AND
      ((c.reply_needs_me=1 AND c.state NOT IN ('done','thank_you_sent','declined','no_reply')) OR (c.state='done' AND c.thank_you_sent_at=''))) +
    (SELECT COUNT(*) FROM stern_drafts d LEFT JOIN people p ON p.id=d.person_id WHERE d.state='generated' AND (p.id IS NULL OR p.archived=0)) +
    (SELECT COUNT(*) FROM stern_suggestions WHERE state='pending') n`).get() as {n:number};
  return n;
}
