"use client";
import { useEffect, useState } from "react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Button, Badge } from "@/components/ui";
import { EmptyState } from "@/components/Panel";
import { useApi, apiPost } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { daysUntilTerm, termStarted, TERM_LABEL } from "@/lib/school";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/cn";
import { GraduationCap, CheckSquare, Square, Plus, X, Calendar as CalIcon } from "lucide-react";

const NYU_EMAIL = "student@example.edu";

export default function SchoolPage() {
  const [days, setDays] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const tick = () => {
      setDays(daysUntilTerm());
      setStarted(termStarted());
    };
    tick();
    const t = setInterval(tick, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const { data, refetch } = useApi<any>("/api/school");
  const [text, setText] = useState("");
  const checklist = data?.checklist ?? [];
  const open = checklist.filter((i: any) => !i.done).length;

  const cal = useLiveData<any>("calendar");
  const nyuConnected = (cal?.events ?? []).some((e: any) => e.account === NYU_EMAIL) || false;
  const nyuEvents = (cal?.events ?? []).filter((e: any) => e.account === NYU_EMAIL);

  const post = async (body: any) => {
    await apiPost("/api/school", body);
    refetch();
  };
  const add = async () => {
    if (!text.trim()) return;
    await post({ action: "add", text: text.trim() });
    setText("");
  };

  const weeks = days === null ? null : Math.ceil(days / 7);

  return (
    <ProjectPage
      title="School"
      icon={<GraduationCap size={18} />}
      subtitle="NYU. The countdown owns the page until classes begin, then it flips to today's schedule."
      statusDot={started ? "healthy" : "off"}
      statusLabel={started ? "in session" : "pre-term"}
      hero={
        <div className="flex flex-col items-center gap-4 py-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-center sm:text-left">
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-txt-faint">
              {started ? "term in session" : "days until classes start"}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-7xl font-semibold leading-none text-accent text-glow tabular lg:text-8xl">
                {started ? "0" : days ?? "—"}
              </span>
              {!started && <span className="font-mono text-xl text-txt-faint">days</span>}
            </div>
            <div className="mt-2 font-mono text-sm text-txt-muted">{TERM_LABEL}</div>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
            <HeroStat label="Weeks" value={weeks ?? "—"} tone="primary" sub="to go" />
            <HeroStat label="Checklist" value={`${open}`} tone={open > 0 ? "warn" : "healthy"} sub="items left" />
          </div>
        </div>
      }
    >
      {started ? (
        <Section title="Today's classes" icon={<CalIcon size={13} />}>
          {!nyuConnected ? (
            <EmptyState title="NYU calendar not connected" hint={`Connect ${NYU_EMAIL} in the Email panel to see today's classes.`} />
          ) : nyuEvents.length === 0 ? (
            <EmptyState title="no classes today" hint="day is clear" />
          ) : (
            <div className="space-y-1.5">
              {nyuEvents.map((e: any, i: number) => (
                <div key={i} className="flex items-start gap-3 rounded-inner border border-border/60 bg-panel-2/30 px-3 py-2">
                  <div className="w-16 shrink-0 font-mono text-[11px] text-txt-muted">{e.allDay ? "all day" : hhmm(e.start)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-txt-primary">{e.summary}</div>
                    {e.location && <div className="truncate text-[11px] text-txt-faint">{e.location}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* checklist */}
          <Section
            title="Set up before term"
            icon={<CheckSquare size={13} />}
            right={<span className="font-mono text-[11px] text-txt-faint">{open} left</span>}
          >
            <div className="mb-2 flex items-center gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="add a setup task" className="flex-1 rounded-inner border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50" />
              <Button size="sm" variant="accent" onClick={add}><Plus size={12} /></Button>
            </div>
            {checklist.length === 0 ? (
              <div className="py-3 text-center text-xs text-txt-faint/70">loading…</div>
            ) : (
              <div className="space-y-0.5">
                {checklist.map((i: any) => (
                  <div key={i.id} className="group/ci flex items-start gap-2 rounded-inner px-1 py-1 hover:bg-white/5">
                    <button onClick={() => post({ action: "toggle", id: i.id })} className={cn("mt-0.5", i.done ? "text-healthy" : "text-txt-faint hover:text-accent")}>
                      {i.done ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                    <span className={cn("min-w-0 flex-1 text-xs", i.done ? "text-txt-faint line-through" : "text-txt-muted")}>{i.text}</span>
                    <button onClick={() => post({ action: "delete", id: i.id })} className="opacity-0 transition-opacity group-hover/ci:opacity-100 text-txt-faint hover:text-error" aria-label="delete"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* calendar feed placeholder */}
          <Section title="NYU calendar" icon={<CalIcon size={13} />}>
            <div className="flex items-center justify-between rounded-inner border border-border/60 bg-panel-2/30 px-3 py-2">
              <span className="font-mono text-xs text-txt-muted">{NYU_EMAIL}</span>
              <Badge tone={nyuConnected ? "healthy" : "off"} className="!normal-case">{nyuConnected ? "connected" : "not connected"}</Badge>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-txt-faint/70">
              The NYU managed calendar layers in automatically once the account is connected (Email panel → Add account) and classes begin. Pre-term it is intentionally quiet; today's classes, assignments due, and the week appear here from {TERM_LABEL.split(" · ")[1]}.
            </p>
          </Section>
        </div>
      )}
    </ProjectPage>
  );
}
