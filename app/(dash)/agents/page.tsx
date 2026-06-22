"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { Bot } from "lucide-react";

export default function AgentsPage() {
  const agents = useLiveData<any>("agents");
  const pulse = useLiveData<any>("pulse");
  const hermes = agents?.hermes;
  const tg = agents?.telegram;
  return (
    <ProjectPage
      title="Agents"
      icon={<Bot size={18} />}
      subtitle="Hermes gateway, the Telegram listener, and Claude Code self-reports — live."
      statusDot={hermes?.online ? "healthy" : "error"}
      statusLabel={hermes?.online ? "online" : "offline"}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Hermes" value={hermes?.online ? "ONLINE" : "OFFLINE"} tone={hermes?.online ? "healthy" : "error"} sub={hermes?.version ? `v${hermes.version} · ${hermes.gatewayState}` : hermes?.detail || "gateway"} />
          <HeroStat label="Active sessions" value={hermes?.activeSessions ?? 0} tone="accent" sub="across platforms" />
          <HeroStat label="Telegram" value={tg?.state ?? "—"} tone={tg?.state === "active" || tg?.state === "idle" ? "healthy" : tg?.state === "conflict" ? "warn" : "error"} sub={tg?.detail || ""} />
        </div>
      }
    >
      <AgentsPanel expanded />
    </ProjectPage>
  );
}
