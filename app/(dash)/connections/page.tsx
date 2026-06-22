"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { ConnectionsPanel } from "@/components/panels/ConnectionsPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { Plug } from "lucide-react";

export default function ConnectionsPage() {
  const conns = useLiveData<any[]>("connections") || [];
  const healthy = conns.filter((c) => c.state === "on_healthy").length;
  const broken = conns.filter((c) => c.state === "on_broken").length;
  const off = conns.filter((c) => c.state === "off").length;
  return (
    <ProjectPage
      title="Connections"
      icon={<Plug size={18} />}
      subtitle="The integration control plane. Real health checks per surface — reconnect, toggle, or paste a key."
      statusDot={broken > 0 ? "warn" : "healthy"}
      statusLabel={broken > 0 ? `${broken} need attention` : "all healthy"}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Healthy" value={healthy} tone="healthy" sub="checks passing" />
          <HeroStat label="Broken" value={broken} tone={broken > 0 ? "warn" : "muted"} sub="need re-auth / attention" />
          <HeroStat label="Off" value={off} tone="muted" sub="intentionally disabled" />
        </div>
      }
    >
      <ConnectionsPanel expanded />
    </ProjectPage>
  );
}
