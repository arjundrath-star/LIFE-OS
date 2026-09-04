"use client";
import { useEffect, useState } from "react";
import { SternPage, SternSection, StatTile, EmptyState, SkeletonRows } from "@/components/stern/Page";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import type { SternSnapshot } from "@/lib/stern-types";

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
}

export default function SternOverviewPage() {
  const { data: initial, loading, error } = useApi<SternSnapshot>("/api/stern");
  const live = useLiveData<SternSnapshot>("stern");
  const snapshot = live ?? initial;
  const [today, setToday] = useState("");
  useEffect(() => setToday(todayLabel()), []);
  const counts = snapshot?.counts;
  const hasAnything = !!counts && (counts.people > 0 || counts.clubsInterested > 0 || counts.tasksDueToday > 0 || counts.tasksOverdue > 0);

  return (
    <SternPage title="Today," subtitle={today || undefined} testId="stern-overview">
      {!snapshot && loading ? (
        <SternSection title="At a glance">
          <SkeletonRows rows={4} />
        </SternSection>
      ) : !snapshot && error ? (
        <EmptyState title="Snapshot unavailable" hint={error} testId="stern-overview-error" />
      ) : (
        <div className="stern-tiles" data-testid="stern-overview-tiles">
          <StatTile label="Coffee chats owed" value={counts?.coffeeChatsOwed ?? 0} tone={counts?.coffeeChatsOwed ? "warn" : "neutral"} testId="stern-tile-chats" />
          <StatTile label="Deadlines in 14 days" value={counts?.deadlines14d ?? 0} testId="stern-tile-deadlines" />
          <StatTile label="Tasks due today" value={counts?.tasksDueToday ?? 0} tone={counts?.tasksOverdue ? "error" : "neutral"} sub={counts?.tasksOverdue ? `${counts.tasksOverdue} overdue` : undefined} testId="stern-tile-tasks" />
          <StatTile label="Follow-ups owed" value={counts?.followUpsOwed ?? 0} tone={counts?.followUpsOwed ? "warn" : "neutral"} testId="stern-tile-followups" />
        </div>
      )}
      {snapshot && !hasAnything && (
        <EmptyState
          title="Nothing to show yet"
          hint="Stat tiles fill in as clubs, people, and tasks are added. Deadlines, today's schedule, and auto-applied changes appear here once data exists."
          testId="stern-overview-empty"
        />
      )}
    </SternPage>
  );
}
