'use client';
import Link from 'next/link';
import { BookOpen, MapPin } from 'lucide-react';
import { SternPage, EmptyState, SkeletonRows } from '@/components/stern/Page';
import { useSternArea } from '@/components/stern/useSternArea';
import { formatDue, percent, WEEKDAYS } from './format';
export function ClassesIndex(){
  const {data,error,refetch}=useSternArea('classes');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const todayDay=new Date(`${today}T12:00Z`).getUTCDay();
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
  const earliest=Math.min(9*60,...(data?.schedule.map(m=>minutes(m.start_time))??[]));
  const latest=Math.max(17*60,...(data?.schedule.map(m=>minutes(m.end_time||m.start_time)+120)??[]));
  const scale=300/(latest-earliest);
  return <SternPage title="Classes" testId="stern-classes-index" subtitle={data?<span className="stern-mono">{[...new Set(data.courses.map(c=>c.term))].join(' · ')||'No term added'} · {data.credits} credits</span>:undefined}>
    {data&&error&&<p className="stern-recruiting-error" role="alert">{error}</p>}
    {!data?(error?<EmptyState title="Classes could not be loaded" hint={error} action={<button className="stern-btn" data-testid="stern-classes-retry" onClick={refetch}>Retry</button>}/>:<SkeletonRows/>):<><div className="stern-week-scroll"><div className="stern-week" data-testid="stern-classes-schedule" aria-label="Weekly schedule in America/New_York"><section className="stern-week-axis"><h2>NY</h2><div>{Array.from({length:Math.ceil((latest-earliest)/120)},(_,i)=>earliest+i*120).map(min=><span className="stern-mono" key={min} style={{top:(min-earliest)*scale}}>{`${String(Math.floor(min/60)).padStart(2,'0')}:00`}</span>)}</div></section>{[1,2,3,4,5].map(day=><section key={day}><h2 aria-current={day===todayDay?'date':undefined}>{WEEKDAYS[day]}{day===todayDay&&<> · <span className="stern-mono">{formatDue(today)}</span></>}</h2><div data-testid={`stern-classes-day-${day}`}>{data.schedule.filter(m=>m.weekday===day).length?data.schedule.filter(m=>m.weekday===day).map(m=><Link className="stern-meeting-block" href={`/stern/classes/${m.course_id}`} key={m.id} style={{top:(minutes(m.start_time)-earliest)*scale,minHeight:m.end_time?Math.max(48,(minutes(m.end_time)-minutes(m.start_time))*scale):48}} data-testid={`stern-meeting-${m.id}`}><strong className="stern-mono">{m.code}</strong><span className="stern-mono">{m.start_time}{m.end_time?`–${m.end_time}`:''}</span><span className="stern-mono">{m.room||'Room not added'}</span>{m.kind!=='lecture'&&<small>{m.kind.replace('_',' ')}</small>}</Link>):<p className="stern-muted">No meetings added</p>}</div></section>)}</div></div>
      {data.schedule.some(m=>m.weekday===0||m.weekday===6)&&<div className="stern-row-surface stern-weekend" data-testid="stern-classes-weekend">{data.schedule.filter(m=>m.weekday===0||m.weekday===6).map(m=><p key={m.id}>{WEEKDAYS[m.weekday]} · {m.code} · <span className="stern-mono">{m.start_time} · {m.room}</span></p>)}</div>}
      <div className="stern-course-grid" data-testid="stern-classes-courses">{data.courses.length?data.courses.map(course=><article className="stern-course-card stern-row-surface" data-testid="stern-course-card" key={course.id}><header><span className="stern-mono stern-violet">{course.code}</span><h2>{course.title}</h2><p>{course.professor?`Prof. ${course.professor}`:'Professor not added'}</p></header><dl><dt>Meets</dt><dd className="stern-mono">{course.meetings.length?course.meetings.map(m=><div key={m.id}>{WEEKDAYS[m.weekday]} {m.start_time||'Time not added'}{m.end_time?`–${m.end_time}`:''}{m.kind!=='lecture'?` · ${m.kind}`:''}</div>):'Schedule not added'}</dd><dt>Room</dt><dd className="stern-mono">{course.room||'Room not added'}</dd><dt>Next due</dt><dd>{course.nextDue?<>{course.nextDue.title} · <span className="stern-mono">{formatDue(course.nextDue.due_at)}</span></>:'No assignments due'}</dd><dt>Standing</dt><dd className="stern-mono">{percent(course.standing.percentage)}</dd></dl><Link href={`/stern/classes/${course.id}`} className="stern-btn" data-testid={`stern-course-open-${course.id}`}>Open</Link></article>):<EmptyState title="No courses added" hint="Your courses will appear here once added." icon={<BookOpen/>}/>}</div>
      <p className="stern-muted"><MapPin size={13}/> All meeting times are America/New_York. Missing schedules stay blank until entered.</p>
    </>}
  </SternPage>;
}
