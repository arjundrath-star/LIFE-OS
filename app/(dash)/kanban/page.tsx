"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { KanbanPanel } from "@/components/panels/KanbanPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { Columns3 } from "lucide-react";

export default function KanbanPage() {
  const kanban = useLiveData<any>("kanban");
  const stats = kanban?.stats ?? {};
  const blocked = stats.blocked ?? 0;
  const active = stats.active ?? 0;
  return (
    <ProjectPage
      title="KANBAN"
      icon={<Columns3 size={18} />}
      subtitle="The real Hermes multi-agent board: triage, assign, nudge dispatch, watch workers, and keep durable human-in-the-loop coordination in one place."
      statusDot={blocked > 0 ? "error" : active > 0 ? "live" : "healthy"}
      statusLabel={kanban ? `${kanban.currentBoard} board` : "loading"}
      hero={
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HeroStat label="Active" value={active ?? "—"} tone={active > 0 ? "accent" : "muted"} sub={`${stats.total ?? 0} cards loaded`} />
          <HeroStat label="Ready" value={stats.ready ?? "—"} tone={(stats.ready ?? 0) > 0 ? "healthy" : "muted"} sub="waiting for dispatcher" />
          <HeroStat label="In flight" value={stats.running ?? "—"} tone={(stats.running ?? 0) > 0 ? "accent" : "muted"} sub="claimed workers" />
          <HeroStat label="Blocked" value={blocked ?? "—"} tone={blocked > 0 ? "error" : "muted"} sub="needs human input" />
          <HeroStat label="Done" value={stats.done ?? "—"} tone={(stats.done ?? 0) > 0 ? "healthy" : "muted"} sub={`event #${stats.latestEventId ?? 0}`} />
        </div>
      }
    >
      <KanbanPanel />
    </ProjectPage>
  );
}
