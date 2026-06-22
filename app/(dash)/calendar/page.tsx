"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { CalendarPanel } from "@/components/panels/CalendarPanel";
import { useLiveData } from "@/hooks/useLiveData";
import { hhmm } from "@/lib/time";
import { Calendar as CalIcon } from "lucide-react";

export default function CalendarPage() {
  const cal = useLiveData<any>("calendar");
  const connected = cal?.connected ?? 0;
  const events = cal?.events ?? [];
  const now = Date.now();
  const next = events.find((e: any) => e.start && Date.parse(e.start) >= now);
  return (
    <ProjectPage
      title="Calendar"
      icon={<CalIcon size={18} />}
      subtitle="Today's events unified across every connected Google account."
      statusDot={connected > 0 ? "healthy" : "off"}
      statusLabel={connected > 0 ? `${connected} calendar${connected > 1 ? "s" : ""}` : "none connected"}
      hero={
        <div className="grid gap-3 sm:grid-cols-2">
          <HeroStat label="Events today" value={connected > 0 ? events.length : "—"} tone="accent" sub={connected > 0 ? "across calendars" : "connect a calendar"} />
          <HeroStat label="Next up" value={next ? hhmm(next.start) : "clear"} tone="primary" sub={next ? next.summary : "nothing left today"} />
        </div>
      }
    >
      <CalendarPanel expanded />
    </ProjectPage>
  );
}
