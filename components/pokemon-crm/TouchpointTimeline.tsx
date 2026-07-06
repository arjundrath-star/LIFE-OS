"use client";
// Newest-first touchpoint history with quick-log composer (+ visit / + note / + follow-up).
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";
import { type Touchpoint, TIMELINE_ICON, fmtTs } from "./types";

type QuickLogKind = "visit" | "note" | "followup";

const QUICK_DEFAULTS: Record<QuickLogKind, { action: string; label: string; outcome: string }> = {
  visit: { action: "log_visit", label: "+ visit", outcome: "In-person visit" },
  note: { action: "log_note", label: "+ note", outcome: "Manual note" },
  followup: { action: "log_followup", label: "+ follow-up", outcome: "Follow-up scheduled" },
};

export function TouchpointTimeline({
  touchpoints,
  busy,
  onQuickLog,
}: {
  touchpoints: Touchpoint[];
  busy: boolean;
  onQuickLog: (kind: QuickLogKind, notes: string, next: string) => void;
}) {
  const [composer, setComposer] = useState<QuickLogKind | null>(null);
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState("");

  const submit = () => {
    if (!composer) return;
    onQuickLog(composer, notes.trim(), next.trim());
    setComposer(null);
    setNotes("");
    setNext("");
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-txt-muted">
          04 · touchpoint timeline
        </span>
        <div className="flex gap-1">
          {(Object.keys(QUICK_DEFAULTS) as QuickLogKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setComposer(composer === k ? null : k)}
              disabled={busy}
              className={cn(
                "rounded-[6px] border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors disabled:opacity-40",
                composer === k
                  ? "border-accent/50 text-accent"
                  : "border-border text-txt-muted hover:border-accent/50 hover:text-accent"
              )}
            >
              {QUICK_DEFAULTS[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {composer && (
          <div className="mb-4 rounded-inner border border-accent/30 bg-accent/[0.04] p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
              log {QUICK_DEFAULTS[composer].outcome.toLowerCase()}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              autoFocus
              placeholder="what happened?"
              className="mt-1.5 w-full resize-y rounded-inner border border-border bg-base px-2.5 py-1.5 text-xs leading-relaxed text-txt-primary outline-none focus:border-accent/50"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="next action (optional)"
                className="min-w-0 flex-1 rounded-inner border border-border bg-base px-2.5 py-1 text-xs text-txt-primary outline-none focus:border-accent/50"
              />
              <Button size="sm" variant="accent" onClick={submit} disabled={busy}>
                log it
              </Button>
            </div>
          </div>
        )}
        {touchpoints.length === 0 ? (
          <div className="py-3 text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-txt-faint/70">
            no touchpoints yet — lead stays not active until one is logged
          </div>
        ) : (
          <div className="relative flex flex-col">
            <span className="absolute bottom-2 left-[26px] top-2 w-px bg-border/90" aria-hidden />
            {touchpoints.map((t) => {
              const icon = TIMELINE_ICON[t.type] || TIMELINE_ICON.note;
              return (
                <div key={t.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                  <Badge
                    tone={icon.tone}
                    className="z-[1] w-[52px] shrink-0 justify-center self-start !rounded-[6px] !px-0 !py-[3px] !text-[8.5px] font-bold"
                  >
                    {icon.label}
                  </Badge>
                  <div className="min-w-0 flex-1 pt-px">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-txt-primary">{t.outcome}</span>
                      <span
                        className={cn(
                          "font-mono text-[9.5px]",
                          t.actor.toLowerCase() === "arjun" ? "text-accent" : "text-accent-glow"
                        )}
                      >
                        · {t.actor}
                      </span>
                      <span className="font-mono text-[9.5px] text-txt-faint">{fmtTs(t.occurred_at)}</span>
                    </div>
                    {(t.raw_notes || t.contact_name || t.phone_number) && (
                      <div className="mt-0.5 text-[11.5px] leading-relaxed text-txt-muted">
                        {[t.contact_name, t.phone_number && !t.raw_notes?.includes(t.phone_number) ? t.phone_number : null]
                          .filter(Boolean)
                          .join(" · ")}
                        {(t.contact_name || t.phone_number) && t.raw_notes ? " — " : ""}
                        {t.raw_notes}
                      </div>
                    )}
                    {t.next_action_at && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-[6px] border border-warn/35 bg-warn/[0.08] px-2 py-0.5 font-mono text-[10px] text-warn">
                        → {t.next_action_at}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
