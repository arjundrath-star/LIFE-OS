"use client";
import Link from "next/link";
import { Clock3 } from "lucide-react";
import type { RecruitingDeadline } from "@/lib/stern-types";
import { EmptyState } from "./Page";
import { dateLabel } from "./recruiting/Controls";

export function DeadlineStrip({ deadlines }: { deadlines: RecruitingDeadline[] }) {
  const upcoming = deadlines.filter(d => d.days >= 0 && d.days <= 14);
  return <section data-component="DeadlineStrip" data-testid="stern-deadline-strip" className="stern-deadline-strip" aria-label="Upcoming deadlines">
    <h2><Clock3 size={14}/>Next 14 days</h2>
    {upcoming.length === 0 ? <EmptyState title="No application deadlines in the next 14 days" hint="Dates appear here for the clubs you are targeting."/> : <div className="stern-deadline-cards" data-testid="stern-deadline-list">{upcoming.map(d => <Link key={d.id} href={`/stern/recruiting/${d.clubId}`} data-testid={`stern-deadline-${d.id}`} className="stern-deadline-card" data-tone={d.days <= 1 ? "error" : d.days <= 3 ? "warn" : "neutral"}>
      <span className="stern-mono">{d.days === 0 ? "Due today" : `Due in ${d.days} ${d.days === 1 ? "day" : "days"}`}</span><strong>{d.club}</strong><small>{d.name}</small><time className="stern-mono" dateTime={d.deadlineAt}>{dateLabel(d.deadlineAt, true)}</time>
    </Link>)}</div>}
  </section>;
}
