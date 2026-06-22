"use client";
import { useState } from "react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Button, Badge } from "@/components/ui";
import { EmptyState } from "@/components/Panel";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { Clapperboard, Sparkles, Globe, ExternalLink, RefreshCw, Github } from "lucide-react";

function VideoCard({ v }: { v: any }) {
  const ratio = (v.aspect || "16:9").replace(":", "/");
  return (
    <figure className="group overflow-hidden rounded-inner border border-border/70 bg-base transition-colors hover:border-accent/40">
      <div className="relative bg-black" style={{ aspectRatio: ratio }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={v.url} poster={v.poster || undefined} controls preload="metadata" className="h-full w-full object-contain" />
      </div>
      <figcaption className="space-y-1 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] text-txt-muted">{v.title}</span>
          <Badge tone="muted" className="!text-[9px]">{v.aspect}{v.duration ? ` · ${v.duration}s` : ""}</Badge>
        </div>
        <p className="line-clamp-2 text-[11px] leading-snug text-txt-faint/80">{v.prompt}</p>
      </figcaption>
    </figure>
  );
}

export default function AdAgencyPage() {
  const { data, refetch, loading } = useApi<any>("/api/adagency");
  const [refreshing, setRefreshing] = useState(false);
  const connected = !!data?.connected;
  const videos: any[] = data?.videos ?? [];

  const hardRefresh = async () => {
    setRefreshing(true);
    await fetch("/api/adagency?refresh=1").catch(() => {});
    refetch();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <ProjectPage
      title="Klade Ad Agency"
      icon={<Clapperboard size={18} />}
      subtitle="AI motion-design ad studio. Short product videos generated with Higgsfield, portfolio on the live site."
      statusDot={connected ? "healthy" : "off"}
      statusLabel={connected ? "Higgsfield live" : "CLI not connected"}
      actions={
        <>
          <a href="https://higgsfield.ai/create" target="_blank" rel="noreferrer"><Button size="sm" variant="accent"><Sparkles size={12} /> generate</Button></a>
          <a href="https://example.com" target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Globe size={12} /> live site</Button></a>
        </>
      }
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Higgsfield credits" value={connected ? data.account?.credits ?? "—" : "—"} tone={connected ? "accent" : "muted"} sub={connected ? `${data.account?.plan ?? ""} plan · ${data.account?.email ?? ""}` : (data?.reason || "device-login on the VPS")} />
          <HeroStat label="Recent generations" value={connected ? videos.length : "—"} tone="primary" sub="account-level history" />
          <HeroStat label="Portfolio" value="example.com" tone="primary" sub="live motion-studio site" />
        </div>
      }
    >
      {/* portfolio */}
      <Section
        title="Portfolio — recent generations"
        icon={<Clapperboard size={13} />}
        right={<Button size="sm" variant="ghost" onClick={hardRefresh} disabled={refreshing || loading}><RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> refresh</Button>}
      >
        {!data ? (
          <EmptyState title="loading Higgsfield…" />
        ) : !connected ? (
          <EmptyState
            title="Higgsfield CLI not connected"
            hint={(data.reason || "Re-auth the Higgsfield CLI on the VPS") + ". Until then the portfolio is on the live site."}
            icon={<Sparkles size={22} />}
            action={<a href="https://example.com" target="_blank" rel="noreferrer"><Button size="sm" variant="accent"><Globe size={12} /> view live site</Button></a>}
          />
        ) : videos.length === 0 ? (
          <EmptyState title="no generations yet" hint="Generate the first video to populate the portfolio." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {videos.map((v) => <VideoCard key={v.id} v={v} />)}
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* generate / links */}
        <Section title="Studio" icon={<Sparkles size={13} />}>
          <div className="space-y-2">
            <LinkRow icon={<Sparkles size={14} />} label="Generate a video" sub="higgsfield.ai/create" href="https://higgsfield.ai/create" />
            <LinkRow icon={<Globe size={14} />} label="Live portfolio site" sub="example.com" href="https://example.com" />
            <LinkRow icon={<Github size={14} />} label="Ad-engine repo" sub="arjundrath-star/ad-engine" href="https://github.com/arjundrath-star/ad-engine" />
          </div>
        </Section>

        {/* outreach pipeline — honest stub */}
        <Section title="Outreach pipeline" icon={<ExternalLink size={13} />}>
          <div className="grid grid-cols-3 gap-3">
            <HeroStat label="Leads" value="—" tone="muted" />
            <HeroStat label="Sent" value="—" tone="muted" />
            <HeroStat label="Replies" value="—" tone="muted" />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-txt-faint/70">
            The ad-engine outreach runs in <span className="font-mono text-txt-faint">~/ad-engine</span> (lead CSVs + sent emails), not yet wired into the dashboard. Connect its log to show live lead / sent / reply counts here.
          </p>
        </Section>
      </div>
    </ProjectPage>
  );
}

function LinkRow({ icon, label, sub, href }: { icon: React.ReactNode; label: string; sub: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-inner border border-border/70 bg-panel-2/30 p-3 transition-colors hover:border-accent/40 hover:bg-accent/5">
      <span className="text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-txt-primary">{label}</div>
        <div className="truncate font-mono text-[11px] text-txt-faint">{sub}</div>
      </div>
      <ExternalLink size={13} className="text-txt-faint" />
    </a>
  );
}
