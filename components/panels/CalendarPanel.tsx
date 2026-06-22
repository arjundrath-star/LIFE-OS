"use client";
import { Panel, EmptyState } from "@/components/Panel";
import { Button } from "@/components/ui";
import { useLiveData } from "@/hooks/useLiveData";
import { hhmm } from "@/lib/time";
import { Calendar as CalIcon, Plus, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";

export function CalendarPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const cal = useLiveData<any>("calendar");
  const connected = cal?.connected ?? 0;
  const events = cal?.events ?? [];
  const now = Date.now();

  return (
    <Panel
      title="Calendar"
      icon={<CalIcon size={13} />}
      state={connected > 0 ? "healthy" : "off"}
      subtitle={connected > 0 ? `${events.length} today` : undefined}
      onExpand={onExpand}
      bodyClassName={cn("overflow-auto", expanded ? "max-h-[70vh]" : "max-h-[340px]")}
    >
      {connected === 0 ? (
        <EmptyState
          title="no calendars connected"
          hint="Connect Google accounts to unify today's events across all of them."
          icon={<CalIcon size={22} />}
          action={
            <a href="/api/google/connect">
              <Button variant="accent" size="sm">
                <Plus size={12} /> connect
              </Button>
            </a>
          }
        />
      ) : events.length === 0 ? (
        <EmptyState title="nothing today" hint={`${connected} calendar${connected > 1 ? "s" : ""} connected · day is clear`} />
      ) : (
        <div className="space-y-1.5">
          {events.map((e: any, i: number) => {
            const past = e.end && Date.parse(e.end) < now;
            const live = e.start && e.end && Date.parse(e.start) <= now && Date.parse(e.end) >= now;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-inner border px-3 py-2",
                  live ? "border-accent/40 bg-accent/5" : "border-border/60 bg-panel-2/30",
                  past && "opacity-50"
                )}
              >
                <div className="w-14 shrink-0 font-mono text-[11px] text-txt-muted">
                  {e.allDay ? "all day" : hhmm(e.start)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-txt-primary">{e.summary}</div>
                  <div className="flex items-center gap-2 text-[11px] text-txt-faint">
                    <span className="truncate">{e.account}</span>
                    {e.location && (
                      <span className="flex items-center gap-0.5 truncate">
                        <MapPin size={9} /> {e.location}
                      </span>
                    )}
                  </div>
                </div>
                {live && <span className="shrink-0 font-mono text-[10px] text-accent">now</span>}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
