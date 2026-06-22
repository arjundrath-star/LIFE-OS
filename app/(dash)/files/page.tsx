"use client";
import { FolderOpen, ExternalLink } from "lucide-react";

// Full-size embedded file browser (filebrowser, localhost-only, behind the gate).
export default function FilesPage() {
  return (
    <div className="h-full w-full p-3 lg:p-4">
      <div className="flex h-full flex-col overflow-hidden rounded-panel border border-border bg-base shadow-panel">
        <header className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-txt-muted">
            <FolderOpen size={13} /> Files
          </div>
          <a href="/files/" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-txt-faint transition-colors hover:text-accent">
            <ExternalLink size={12} /> <span className="text-[11px]">open</span>
          </a>
        </header>
        <iframe src="/files/" title="Files" className="min-h-0 w-full flex-1 border-0 bg-base" />
      </div>
    </div>
  );
}
