'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarDays, Inbox } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useLiveData } from '@/hooks/useLiveData';
import { timeAgo } from '@/lib/time';
import type { SternSnapshot } from '@/lib/stern-types';
import { SternPage, SternSection, StatTile, EmptyState, SkeletonRows } from '../Page';
import { DeadlineStrip } from '../DeadlineStrip';
import { AuditLogRows, ActionNotice, useAutomationAction } from '../automation/shared';

const clock=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function Overview() {
  const api=useApi<SternSnapshot>('/api/stern'),live=useLiveData<SternSnapshot>('stern');
  const [saved,setSaved]=useState<SternSnapshot|null>(null);
  const data=[api.data,live,saved].filter((s):s is SternSnapshot=>!!s).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const action=useAutomationAction(r=>setSaved(r.snapshot),'/api/stern');
  const date=data?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'}).format(new Date(`${data.today}T12:00Z`)):'';
  if (!data && api.error) return <SternPage title="Today," testId="stern-overview"><EmptyState title="Overview could not be loaded" hint={api.error} action={<button className="stern-btn" data-testid="stern-overview-retry" onClick={api.refetch}>Retry</button>}/></SternPage>;
  return <SternPage title="Today," subtitle={<span className="stern-mono">{date}</span>} testId="stern-overview">
    <ActionNotice error={action.error||api.error||''} message={action.message}/>
    <div className="stern-stat-grid" data-testid="stern-overview-stats">{[['Coffee chats owed','coffeeChatsOwed','warn'],['Deadlines in 14 days','deadlines14d','neutral'],['Tasks due today','tasksDueToday','neutral'],['Follow-ups owed','followUpsOwed','warn']].map(([label,key,tone])=><StatTile key={key} label={label} value={data?data.counts[key as keyof SternSnapshot['counts']]:<SkeletonRows rows={1}/>} tone={tone==='warn'&&data&&data.counts[key as keyof SternSnapshot['counts']]>0?'warn':'neutral'} testId={`stern-overview-${key}`}/>)}</div>
    <div className="stern-overview-grid">
      <div className="stern-overview-deadlines">{data?<DeadlineStrip deadlines={data.recruiting.deadlines}/>:<SkeletonRows rows={2}/>}</div>
      <SternSection title="Needs you" className="stern-overview-needs" flush testId="stern-overview-needs"><div data-testid="stern-needs-list">{!data?<SkeletonRows/>:!data.needsYou.length?<EmptyState icon={<Inbox/>} title="Nothing waiting on you" hint="Replies, thank-yous, drafts, and suggestions appear here."/>:data.needsYou.map(n=><div className="stern-need-row" key={n.key}><i data-kind={n.kind}/><span>{n.title}</span><time className="stern-mono stern-muted" dateTime={n.at} title={n.at}>{n.at?timeAgo(n.at):''}</time><Link data-testid={`stern-need-${n.key}`} href={n.href}>{n.actionLabel}</Link></div>)}{data&&data.needsYouTotal>data.needsYou.length&&<p className="stern-memo-line"><span className="stern-mono">{data.needsYouTotal-data.needsYou.length}</span> more waiting. <Link data-testid="stern-needs-more" href="/stern/automation">Review Automation</Link></p>}</div></SternSection>
      <SternSection title="Today's schedule" className="stern-overview-schedule" flush note="America/New_York" testId="stern-overview-schedule"><div data-testid="stern-schedule-list">{!data?<SkeletonRows/>:!data.schedule.length?<EmptyState icon={<CalendarDays/>} title="No events scheduled today" hint="Add course meeting times or sync your calendar."/>:data.schedule.map(e=><div className="stern-schedule-row" key={e.key}><time className="stern-mono" dateTime={e.startAt}>{e.startAt.length===10?'All day':clock(e.startAt)}</time><span>{e.href?<Link data-testid={`stern-schedule-open-${e.key}`} href={e.href}>{e.title}</Link>:e.title}</span><small className="stern-muted stern-mono">{e.location||'Unconfirmed'}</small>{e.prepHref&&<Link data-testid={`stern-schedule-prep-${e.key}`} href={e.prepHref}>Prep</Link>}</div>)}</div></SternSection>
      <SternSection title="Auto-applied today" className="stern-overview-audit" flush testId="stern-overview-audit">{data?<AuditLogRows rows={data.autoAppliedToday} busy={action.busy} undo={batchId=>void action.act({action:'audit.undo',batchId})}/>:<SkeletonRows/>}<p className="stern-memo-line" data-testid="stern-overview-memo">{data?.reminders.lastMemoAt?<>Morning memo sent <time className="stern-mono" dateTime={data.reminders.lastMemoAt}>{clock(data.reminders.lastMemoAt)}</time></>:data?'Morning memo has not been sent today':'Loading memo status…'} <Link data-testid="stern-memo-view" href="/stern/automation#reminders">View</Link></p></SternSection>
    </div>
  </SternPage>;
}
