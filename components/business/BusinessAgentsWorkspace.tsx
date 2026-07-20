"use client";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { BusinessPage, BusinessSection, SourceStamp } from "./Page";
import { useBusinessUnit } from "./BusinessContext";

const BUSINESS = /(pokemon|vending|portable[- ]?charging|subtap|rathworkspace[- ]platform|platform developer)/i;

export default function BusinessAgentsWorkspace() {
  const { unit } = useBusinessUnit();
  const { data: runHttp } = useApi<any>("/api/agents/runs");
  const runs = useLiveData<any>("agent_runs") || runHttp;
  const { data: kanbanHttp } = useApi<any>("/api/kanban");
  const kanban = useLiveData<any>("kanban") || kanbanHttp;
  const selected = unit === "pokemon" ? /pokemon|vending/i : unit === "portable-charging" ? /portable[- ]?charging/i : unit === "subtap" ? /subtap/i : BUSINESS;
  const agents = (runs?.agents ?? []).filter((agent: any) => selected.test(`${agent.slug} ${agent.display_name} ${agent.description || ""}`));
  const tasks = (kanban?.tasks ?? []).filter((task: any) => selected.test(`${task.id} ${task.title} ${task.body || ""} ${task.assignee || ""} ${task.tenant || ""}`));
  return <BusinessPage title="Agents" description="Business-relevant agent runs and Hermes Kanban work, filtered from the real control-plane sources." actions={<SourceStamp>agent_runs + Hermes Kanban</SourceStamp>}>
    <BusinessSection title="Business agents" note={<SourceStamp>{agents.length} matching registry entries</SourceStamp>}>{!runs ? <p className="text-sm text-txt-muted">Loading agent registry.</p> : agents.length === 0 ? <p className="text-sm text-txt-muted">No business-relevant agent runs are currently registered.</p> : <div className="business-list">{agents.map((agent: any) => <div key={agent.slug} className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3"><div><strong className="text-sm text-txt-primary">{agent.display_name}</strong><p className="max-w-3xl text-xs text-txt-muted">{agent.latestRun?.summary || agent.description || "No run summary"}</p></div><div className="text-right"><SourceStamp>{agent.current_status}</SourceStamp><p className="mt-1 text-[10px] text-txt-faint">{agent.last_run_at ? timeAgo(agent.last_run_at) : "never run"}</p></div></div>)}</div>}</BusinessSection>
    <BusinessSection title="Business Kanban work" note={<SourceStamp>{tasks.length} matching tasks</SourceStamp>}>{!kanban ? <p className="text-sm text-txt-muted">Loading Hermes Kanban.</p> : tasks.length === 0 ? <p className="text-sm text-txt-muted">No Pokemon, vending, portable-charging, Subtap, or platform business tasks match the current board.</p> : <div className="business-list">{tasks.map((task: any) => <div key={task.id} className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3"><div><strong className="text-sm text-txt-primary">{task.title}</strong><p className="text-xs text-txt-muted">{task.assignee || "unassigned"} · {task.tenant || "no tenant"}</p></div><SourceStamp>{task.status || task.column}</SourceStamp></div>)}</div>}</BusinessSection>
  </BusinessPage>;
}
