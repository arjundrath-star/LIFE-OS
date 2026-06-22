"use client";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui";
import { Clapperboard, ExternalLink, Sparkles, Globe } from "lucide-react";

// Klade Ad Agency: portfolio + live site + Higgsfield generate link. Links only,
// no fabricated metrics. Real artifacts live on example.com and in Higgsfield.
export function AdAgencyPanel({ onExpand }: { onExpand?: () => void }) {
  return (
    <Panel title="Klade Ad Agency" icon={<Clapperboard size={13} />} onExpand={onExpand} state="healthy" bodyClassName="space-y-3">
      <p className="text-xs leading-relaxed text-txt-muted">
        AI motion-design ad studio. Short product videos generated with Higgsfield, portfolio
        showcased on the live site.
      </p>

      <div className="grid grid-cols-1 gap-2">
        <LinkRow icon={<Globe size={14} />} label="Live site" sub="example.com" href="https://example.com" />
        <LinkRow icon={<Sparkles size={14} />} label="Generate a video" sub="higgsfield.ai" href="https://higgsfield.ai/create" />
        <LinkRow icon={<Clapperboard size={14} />} label="Ad-engine repo" sub="arjundrath-star/ad-engine" href="https://github.com/arjundrath-star/ad-engine" />
      </div>
    </Panel>
  );
}

function LinkRow({ icon, label, sub, href }: { icon: React.ReactNode; label: string; sub: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-inner border border-border/70 bg-panel-2/30 p-3 transition-colors hover:border-accent/40 hover:bg-accent/5"
    >
      <span className="text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-txt-primary">{label}</div>
        <div className="truncate font-mono text-[11px] text-txt-faint">{sub}</div>
      </div>
      <ExternalLink size={13} className="text-txt-faint" />
    </a>
  );
}
