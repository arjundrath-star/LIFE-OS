"use client";
import { Panel, EmptyState } from "@/components/Panel";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { FolderGit2, FileText } from "lucide-react";
import { cn } from "@/lib/cn";

type Project = {
  name: string;
  slug: string;
  fileCount: number;
  latestFile: string | null;
  latestModified: string | null;
  preview: string | null;
};

export function ProjectsPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const projects = useLiveData<Project[]>("projects");

  return (
    <Panel
      title="Projects"
      icon={<FolderGit2 size={13} />}
      subtitle={projects ? `${projects.length} from command-center` : undefined}
      onExpand={onExpand}
      bodyClassName={cn("overflow-auto", expanded ? "max-h-[70vh]" : "max-h-[340px]")}
    >
      {!projects ? (
        <EmptyState title="reading vault" hint="command-center folders" />
      ) : projects.length === 0 ? (
        <EmptyState title="no projects" hint="command-center vault has no project folders yet" />
      ) : (
        <div className={cn("grid gap-2", expanded ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>
          {projects.map((p) => (
            <div key={p.slug} className="rounded-inner border border-border/70 bg-panel-2/30 p-3 transition-colors hover:border-accent/30">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-txt-primary">{p.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-txt-faint">{p.fileCount} files</span>
              </div>
              {p.preview && <p className="mt-1 line-clamp-2 text-xs text-txt-muted">{p.preview}</p>}
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-txt-faint">
                <FileText size={10} />
                <span className="truncate">{p.latestFile || "—"}</span>
                <span className="ml-auto shrink-0 font-mono">{timeAgo(p.latestModified)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
