"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { ProjectsPanel } from "@/components/panels/ProjectsPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { FolderGit2 } from "lucide-react";

export default function ProjectsPage() {
  const projects = useLiveData<any[]>("projects");
  const total = projects?.length ?? 0;
  const files = (projects || []).reduce((s, p) => s + (p.fileCount || 0), 0);
  const latest = (projects || [])[0];
  return (
    <ProjectPage
      title="Projects"
      icon={<FolderGit2 size={18} />}
      subtitle="Every project folder in the command-center vault. Newest activity first."
      statusLabel={`${total} tracked`}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Projects" value={total} tone="accent" sub="from the vault" />
          <HeroStat label="Notes" value={files} tone="primary" sub="markdown files" />
          <HeroStat label="Latest" value={latest ? timeAgo(latest.latestModified) : "—"} tone="primary" sub={latest ? latest.name : "no activity"} />
        </div>
      }
    >
      <ProjectsPanel expanded />
    </ProjectPage>
  );
}
