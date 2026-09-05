"use client";
import Link from "next/link";
import { useState } from "react";
import { Archive, Plus, Search, Users } from "lucide-react";
import { SternPage, EmptyState, SkeletonRows, StatusChip } from "@/components/stern/Page";
import { DeadlineStrip } from "@/components/stern/DeadlineStrip";
import { statusLabel, type RecruitingSnapshot } from "@/lib/stern-types";
import { useRecruiting } from "./useRecruiting";
import { RecruitingButton, RecruitingDialog, PriorityStars, dateLabel, MutationNotice } from "./Controls";

function ProcessTimeline({ snapshot }: { snapshot: RecruitingSnapshot }) {
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
  const start = Math.min(day(snapshot.today), ...snapshot.windows.map(w => day(w.applications_open))) - 86400000;
  const end = Math.max(day(snapshot.today), ...snapshot.windows.map(w => day(w.decisions))) + 86400000;
  const position = (value: string) => (day(value)-start)/(end-start)*100;
  return <section className="stern-panel stern-process-timeline" data-testid="stern-process-timeline" aria-label="Fall 2026 recruiting windows">
    <div className="stern-process-axis" data-testid="stern-timeline-windows">
      <div className="stern-today-marker" style={{ left: `${position(snapshot.today)}%` }}><span>Today · {dateLabel(snapshot.today)}</span></div>
      {snapshot.windows.map(w => <div key={w.track} className="stern-process-lane">
        <div className={`stern-application-window ${w.track}`} style={{ left: `${position(w.applications_open)}%`, width: `${Math.max(1,position(w.applications_close)-position(w.applications_open))}%` }} title={`${statusLabel(w.track)} applications: ${dateLabel(w.applications_open)}–${dateLabel(w.applications_close)}`} />
        <div className="stern-interview-window" style={{ left: `${position(w.interviews_start)}%`, width: `${Math.max(.5,position(w.interviews_end)-position(w.interviews_start))}%` }}/>
        <div className="stern-decision-marker" style={{ left: `${position(w.decisions)}%` }} title={`Decision ${dateLabel(w.decisions)}`}/>
      </div>)}
    </div>
    <div className="stern-window-legend" data-testid="stern-window-legend">{snapshot.windows.map(w => <div key={w.track}><strong>{statusLabel(w.track)}</strong><span>Applications <time className="stern-mono">{dateLabel(w.applications_open)}–{dateLabel(w.applications_close)}</time></span><span>Interviews <time className="stern-mono">{dateLabel(w.interviews_start)}–{dateLabel(w.interviews_end)}</time></span><span>Decision <time className="stern-mono">{dateLabel(w.decisions)}</time></span></div>)}</div>
  </section>;
}
export function RecruitingBoard() {
  const state = useRecruiting(); const { snapshot, mutate, busy } = state;
  const [filter, setFilter] = useState("all"); const [timeline, setTimeline] = useState(true);
  const [adding, setAdding] = useState(false); const [query, setQuery] = useState(""); const [archiving, setArchiving] = useState(false);
  const clubs = snapshot?.clubs.filter(c => filter === "all" || c.status === filter) ?? [];
  const catalog = snapshot?.catalog.filter(c => `${c.name} ${c.short_name} ${statusLabel(c.category)}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <SternPage title="Club Recruiting, Fall 2026" testId="stern-recruiting-board" actions={<>
    <div className="stern-filter-chips" data-testid="stern-recruiting-filters">{["all","applying","interviewing","archived"].map(value => <button key={value} data-testid={`stern-recruiting-filter-${value}`} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{statusLabel(value)} <span className="stern-mono">{value === "all" ? snapshot?.clubs.length ?? 0 : snapshot?.clubs.filter(c => c.status === value).length ?? 0}</span></button>)}</div>
    <label className="stern-timeline-toggle"><input type="checkbox" checked={timeline} data-testid="stern-recruiting-timeline-toggle" onChange={e => setTimeline(e.target.checked)}/>Process timeline</label>
    <RecruitingButton primary data-testid="stern-club-add" onClick={() => setAdding(true)} disabled={!snapshot || snapshot.process?.status === "archived"}><Plus size={14}/>Add clubs</RecruitingButton>
  </>}>
    <MutationNotice {...state} undo={() => void state.undo()}/>
    {!snapshot ? state.error ? <EmptyState title="Could not load recruiting" hint={state.error} action={<RecruitingButton data-testid="stern-recruiting-retry" onClick={state.refetch}>Retry</RecruitingButton>}/> : <SkeletonRows rows={8}/> : <>
      {timeline && <ProcessTimeline snapshot={snapshot}/>}
      <DeadlineStrip deadlines={snapshot.deadlines}/>
      {clubs.length === 0 ? <EmptyState testId="stern-recruiting-empty" icon={<Users/>} title={filter === "all" ? "No clubs tracked yet" : `No ${filter} clubs`} hint={filter === "all" ? "Add clubs you are interested in to see programs, deadlines, checklists, and coffee chats." : "Clubs appear here when their recruiting status changes."}/> :
        <div className="stern-club-grid" data-testid="stern-club-list">{clubs.map(club => <article key={club.id} className={`stern-panel stern-club-card ${club.status === "archived" ? "archived" : ""}`} data-component="ClubCard" data-testid="stern-club-card">
          <div className="stern-card-heading"><div><Link data-testid={`stern-club-open-${club.id}`} href={`/stern/recruiting/${club.id}`}>{club.name}</Link><div className="stern-inline"><span className="stern-note-chip">{statusLabel(club.category) || "Uncategorized"}</span><PriorityStars priority={club.priority} disabled={busy || club.status === "archived"} onChange={priority => void mutate({ action: "club.update", clubId: club.id, patch: { priority } })}/></div></div><StatusChip value={club.status}/></div>
          <dl className="stern-club-metrics"><dt>Next deadline</dt><dd className="stern-mono">{club.nextDeadline ? dateLabel(club.nextDeadline.deadlineAt) : "No upcoming deadline"}</dd><dt>Coffee chats</dt><dd><span className="stern-mono">{club.chatsDone} of {club.target_chats}</span> chats done</dd><dt>Checklist</dt><dd className="stern-mono">{club.checklistDone} of {club.checklistTotal}</dd></dl>
          <progress className="stern-checklist-progress" value={club.checklistDone} max={club.checklistTotal || 1} aria-label={`${club.checklistDone} of ${club.checklistTotal} checklist items complete`}/>
          <div className="stern-club-eboard"><span>E-board</span><div className="stern-avatars" data-testid={`stern-club-people-${club.id}`}>{club.people.length ? club.people.map(p => <span className="stern-avatar" key={p.id} title={`${p.display_name} · ${p.chat ? statusLabel(p.chat.state) : "No chat tracked"}`}>{p.display_name.split(/\s+/).slice(0,2).map(n => n[0]).join("")}</span>) : <span className="stern-muted">No people linked yet</span>}</div></div>
        </article>)}</div>}
      {snapshot.process && <div className="stern-recruiting-footer"><span>{snapshot.process.status === "archived" ? "This recruiting process is archived. Its history is preserved." : "Archive this process when the season is finished."}</span><RecruitingButton data-testid="stern-process-archive" disabled={busy || snapshot.process.status === "archived"} onClick={() => setArchiving(true)}><Archive size={14}/>Archive process</RecruitingButton></div>}
    </>}
    <RecruitingDialog title="Add clubs" open={adding} onOpenChange={setAdding}>
      <label className="stern-catalog-search"><Search size={16}/><input autoFocus className="stern-input" data-testid="stern-catalog-search" aria-label="Search club catalog" placeholder="Search clubs or categories" value={query} onChange={e => setQuery(e.target.value)}/></label>
      {state.notice && <p role="alert" className="stern-recruiting-error">{state.notice}</p>}
      {!snapshot?.catalog.length ? <EmptyState title="The club catalog has not been loaded" hint="Load the public Fall 2026 catalog to choose your clubs." action={<RecruitingButton primary data-testid="stern-catalog-seed" disabled={busy} onClick={() => void mutate({ action: "seed_catalog" })}>Load club catalog</RecruitingButton>}/> : !catalog.length ? <EmptyState title="No clubs match your search" hint="Try a different club name or category."/> :
        <div data-testid="stern-catalog-list" className="stern-catalog-list">{catalog.map(club => <label key={club.id} className="stern-catalog-row"><div><strong>{club.name}</strong><small>{statusLabel(club.category)}{club.status === "archived" ? " · Archived" : ""}</small></div><input type="checkbox" role="switch" data-testid={`stern-catalog-toggle-${club.id}`} aria-label={`Track ${club.name}`} checked={club.interested === 1} disabled={busy || club.status === "archived"} onChange={e => void mutate({ action: "club.set_interested", clubId: club.id, interested: e.target.checked })}/></label>)}</div>}
    </RecruitingDialog>
    <RecruitingDialog title="Archive recruiting process" open={archiving} onOpenChange={setArchiving}><p>All clubs in this season will be archived. Programs, notes, people and history stay available.</p><RecruitingButton primary data-testid="stern-process-archive-confirm" disabled={busy} onClick={async () => { if (await mutate({ action: "process.archive", processId: snapshot?.process?.id })) setArchiving(false); }}>Archive season</RecruitingButton></RecruitingDialog>
  </SternPage>;
}
