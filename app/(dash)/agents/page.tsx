"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { AgentRunsPanel } from "@/components/panels/AgentRunsPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { Bot } from "lucide-react";

export default function AgentsPage() {
  const agents = useLiveData<any>("agents");
  const runs = useLiveData<any>("agent_runs");
  const hermes = agents?.hermes;
  const tg = agents?.telegram;
  const stats = runs?.stats;
  const namedActive = (stats?.active ?? 0) + (stats?.waiting ?? 0);
  return (
    <ProjectPage
      title="Agents"
      icon={<Bot size={18} />}
      subtitle="The control tower: named agent runs and sub-agent flows, plus the Hermes gateway, Telegram listener, and Claude Code self-reports — live."
      statusDot={hermes?.online ? "healthy" : "error"}
      statusLabel={hermes?.online ? "online" : "offline"}
      hero={
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            label="Named agents"
            value={namedActive > 0 ? namedActive : (stats?.total ?? "—")}
            tone={namedActive > 0 ? "accent" : "muted"}
            sub={namedActive > 0 ? `${stats?.active ?? 0} active · ${stats?.waiting ?? 0} waiting` : `${stats?.total ?? 0} registered · idle`}
          />
          <HeroStat label="Hermes" value={hermes?.online ? "ONLINE" : "OFFLINE"} tone={hermes?.online ? "healthy" : "error"} sub={hermes?.version ? `v${hermes.version} · ${hermes.gatewayState}` : hermes?.detail || "gateway"} />
          <HeroStat label="Active sessions" value={hermes?.activeSessions ?? 0} tone="accent" sub="across platforms" />
          <HeroStat label="Telegram" value={tg?.state ?? "—"} tone={tg?.state === "active" || tg?.state === "idle" ? "healthy" : tg?.state === "conflict" ? "warn" : "error"} sub={tg?.detail || ""} />
        </div>
      }
    >
      <AgentRunsPanel />
      <AgentsPanel expanded />
    </ProjectPage>
  );
}
