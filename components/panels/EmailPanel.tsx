"use client";
import { Panel, EmptyState } from "@/components/Panel";
import { Button } from "@/components/ui";
import { CountUp } from "@/components/CountUp";
import { StatusDot } from "@/components/StatusDot";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { Mail, Plus, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmailPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const email = useLiveData<any>("email");
  const connected = email?.connected ?? 0;

  const addBtn = (
    <a href="/api/google/connect">
      <Button variant="accent" size="sm">
        <Plus size={12} /> add account
      </Button>
    </a>
  );

  const removeAccount = (e: string) =>
    fetch("/api/google/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", email: e }),
    });

  return (
    <Panel
      title="Email radar"
      icon={<Mail size={13} />}
      state={connected > 0 ? "healthy" : "off"}
      subtitle={connected > 0 ? `${email.totalUnread} unread · ${connected} acct` : undefined}
      onExpand={onExpand}
      right={addBtn}
      bodyClassName={cn("overflow-auto", expanded ? "max-h-[70vh]" : "max-h-[340px]")}
    >
      {connected === 0 ? (
        <EmptyState
          title="no accounts connected"
          hint="Add any Google account to see unread + likely-missed mail. Read-only. Each account stores its own token."
          icon={<Mail size={22} />}
          action={addBtn}
        />
      ) : (
        <div className="space-y-2">
          {email.accounts.map((a: any) => (
            <div key={a.email} className="group/acct rounded-inner border border-border/70 bg-panel-2/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot state={a.last_error ? "error" : a.unread_count > 0 ? "live" : "healthy"} size={7} pulse={!a.last_error && a.unread_count > 0} />
                  <span className="truncate text-sm text-txt-primary">{a.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CountUp value={a.unread_count} className="text-lg font-semibold text-accent" />
                  <button
                    onClick={() => removeAccount(a.email)}
                    className="opacity-0 transition-opacity group-hover/acct:opacity-100 text-txt-faint hover:text-error"
                    aria-label="remove"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
              {a.last_error ? (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-error">
                  <AlertTriangle size={11} /> {a.last_error} — re-auth via Connections
                </div>
              ) : a.latest_subject ? (
                <div className="mt-1 truncate text-xs text-txt-muted">
                  {a.important_count > 0 && a.important_count < a.unread_count && (
                    <span className="mr-1 text-warn">★{a.important_count}</span>
                  )}
                  {a.latest_from ? `${a.latest_from.replace(/<.*>/, "").trim()} — ` : ""}
                  {a.latest_subject}
                </div>
              ) : (
                <div className="mt-1 text-xs text-txt-faint/70">inbox clear · synced {timeAgo(a.last_checked)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
