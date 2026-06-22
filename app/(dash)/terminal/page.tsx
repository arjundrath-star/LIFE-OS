"use client";
import { Terminal as TermIcon, ExternalLink } from "lucide-react";

// Full-size embedded terminal (ttyd, localhost-only, behind the gate). The iframe
// requests "/terminal/" which the custom server proxies to ttyd.
export default function TerminalPage() {
  return (
    <div className="h-full w-full p-3 lg:p-4">
      <div className="flex h-full flex-col overflow-hidden rounded-panel border border-border bg-base shadow-panel">
        <header className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-txt-muted">
            <TermIcon size={13} /> Terminal
          </div>
          <a href="/terminal/" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-txt-faint transition-colors hover:text-accent">
            <ExternalLink size={12} /> <span className="text-[11px]">open</span>
          </a>
        </header>
        <iframe src="/terminal/" title="Terminal" className="min-h-0 w-full flex-1 border-0 bg-base" />
      </div>
    </div>
  );
}
