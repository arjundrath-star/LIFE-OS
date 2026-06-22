"use client";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { EmailPanel } from "@/components/panels/EmailPanel";
import { EmptyState } from "@/components/Panel";
import { StatusDot } from "@/components/StatusDot";
import { useLiveData } from "@/hooks/useLiveData";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Mail } from "lucide-react";

export default function EmailPage() {
  const email = useLiveData<any>("email");
  const connected = email?.connected ?? 0;
  const recent: any[] = email?.recent ?? [];
  return (
    <ProjectPage
      title="Email radar"
      icon={<Mail size={18} />}
      subtitle="Unread + likely-missed mail across every connected Google inbox. Read-only, per-account tokens."
      statusDot={connected > 0 ? "healthy" : "off"}
      statusLabel={connected > 0 ? `${connected} connected` : "none connected"}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Unread" value={connected > 0 ? email.totalUnread : "—"} tone={connected > 0 ? "accent" : "muted"} sub="across inboxes" />
          <HeroStat label="Important" value={connected > 0 ? email.totalImportant : "—"} tone={email?.totalImportant > 0 ? "warn" : "muted"} sub="unread + important" />
          <HeroStat label="Accounts" value={connected} tone="primary" sub="read-only readers" />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <EmailPanel expanded />
        <Section title="Recent across inboxes" icon={<Mail size={13} />} bodyClassName="max-h-[70vh] overflow-auto">
          {connected === 0 ? (
            <EmptyState title="no inboxes connected" hint="Add a Google account from the panel on the left." />
          ) : recent.length === 0 ? (
            <EmptyState title="inboxes clear" hint="nothing recent" />
          ) : (
            <div className="space-y-1">
              {recent.map((m) => (
                <div key={`${m.account}-${m.id}`} className={cn("flex items-start gap-2.5 rounded-inner px-2.5 py-2", m.unread && "bg-panel-2/40")}>
                  <StatusDot state={m.unread ? "live" : "off"} size={6} pulse={m.unread} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", m.unread ? "text-txt-primary" : "text-txt-muted")}>
                        {m.important && <span className="mr-1 text-warn">★</span>}
                        {m.fromName || m.from || "(unknown)"}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-txt-faint">{hhmm(m.ts)}</span>
                    </div>
                    <div className="truncate text-xs text-txt-muted">{m.subject}</div>
                    <div className="truncate font-mono text-[10px] text-txt-faint/70">{m.account}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </ProjectPage>
  );
}
