"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { Badge } from "@/components/ui";
import { GraduationCap } from "lucide-react";

const START = new Date("2026-09-02T00:00:00");

export function SchoolPanel({ onExpand }: { onExpand?: () => void }) {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    setDays(Math.max(0, Math.ceil((START.getTime() - Date.now()) / 86400000)));
  }, []);

  const started = days !== null && days === 0;

  return (
    <Panel title="School" icon={<GraduationCap size={13} />} state="off" onExpand={onExpand}>
      <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
        <Badge tone="off" className="!normal-case">{started ? "in session" : "not started"}</Badge>
        {!started ? (
          <>
            <div className="font-mono text-4xl font-semibold text-txt-primary tabular">{days ?? "—"}</div>
            <div className="text-xs text-txt-muted">days until classes start</div>
            <div className="text-[11px] text-txt-faint">NYU · Sep 2, 2026</div>
          </>
        ) : (
          <div className="text-sm text-txt-muted">Classes are in session. School calendar layers into Calendar.</div>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-txt-faint/70">
        Placeholder until 2026-09-02. The NYU calendar (student@example.edu) layers into the
        Calendar module when the term begins.
      </p>
    </Panel>
  );
}
