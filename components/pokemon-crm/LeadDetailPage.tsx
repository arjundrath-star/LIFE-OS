"use client";
// Full-screen lead detail: replaces the table inside the shell (no overlay).
// Summary band + contacts/phone selector (left) + notes/next-action/timeline (right).
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";
import { ContactPhoneSelector } from "./ContactPhoneSelector";
import { TouchpointTimeline } from "./TouchpointTimeline";
import {
  type EmailStatus,
  type LeadDetail,
  type Phone,
  type PhoneStatus,
  type Stage,
  STAGES,
  STAGE_CLASS,
  clusterLabel,
  scoreTone,
  usableCount,
} from "./types";

function callNextId(detail: LeadDetail): number | null {
  const ordered: Phone[] = [
    ...detail.contacts.flatMap((c) => c.phones),
    ...detail.leadPhones,
  ];
  const next = ordered.find((p) => p.status === "untested" || p.status === "good");
  return next ? next.id : null;
}

export function LeadDetailPage({
  detail,
  actor,
  onActorChange,
  busy,
  onBack,
  onStageChange,
  onNotesSave,
  onNextActionSave,
  onOutcome,
  onQuickMark,
  onEmailStatus,
  onAddPhone,
  onAddContact,
  onQuickLog,
}: {
  detail: LeadDetail;
  actor: string;
  onActorChange: (a: string) => void;
  busy: boolean;
  onBack: () => void;
  onStageChange: (stage: Stage) => void;
  onNotesSave: (notes: string) => void;
  onNextActionSave: (next: string, due: string) => void;
  onOutcome: (phoneId: number, outcome: PhoneStatus) => void;
  onQuickMark: (phoneId: number, status: "good" | "bad") => void;
  onEmailStatus: (emailId: number, status: EmailStatus) => void;
  onAddPhone: (contactId: number | null, phone: string) => void;
  onAddContact: (name: string, title: string) => void;
  onQuickLog: (kind: "visit" | "note" | "followup", notes: string, next: string) => void;
}) {
  const l = detail.lead;
  const allPhones = [...detail.contacts.flatMap((c) => c.phones), ...detail.leadPhones];
  const usable = usableCount(allPhones);

  // Next action + due save together through one endpoint; read both live DOM
  // values on blur so one field's save can't revert the other's in-progress edit.
  const nextRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const saveNextAction = () => {
    const next = nextRef.current?.value ?? "";
    const due = dueRef.current?.value ?? "";
    if (next !== (l.next_action || "") || due !== (l.next_action_due || "")) {
      onNextActionSave(next, due);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc inside a field just leaves the field (firing its blur-save);
      // only a second Esc, with nothing focused, closes the detail view.
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select")) {
        t.blur();
        return;
      }
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      {/* back bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="font-mono uppercase tracking-[0.08em]">
          <ArrowLeft size={13} /> back to leads
        </Button>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-txt-faint">
          leads / <span className="text-accent">{l.venue_name}</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-txt-faint">
            acting as
          </span>
          <input
            value={actor}
            onChange={(e) => onActorChange(e.target.value)}
            aria-label="Acting as"
            className="w-20 rounded-inner border border-border bg-base px-2 py-1 text-center font-mono text-[11px] text-accent outline-none focus:border-accent/50"
          />
        </span>
      </div>

      {/* summary band */}
      <header className="panel-hairline relative overflow-hidden rounded-panel border border-border bg-panel/60 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight text-txt-primary">{l.venue_name}</h1>
              <Badge tone={scoreTone(l.pokemon_fit_score)} className="font-bold">
                PK score {l.pokemon_fit_score ?? "—"}
              </Badge>
              {l.vending_score != null && (
                <Badge tone="muted" className="!normal-case !tracking-normal">
                  source vending {l.vending_score}
                </Badge>
              )}
              <Badge tone={l.active ? "accent" : "off"}>{l.active ? "active" : "not active"}</Badge>
            </div>
            <div className="mt-1 text-[13px] text-txt-muted">{l.address || "no address on file"}</div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {l.category && (
                <Badge tone="accent" className="!normal-case !tracking-normal">
                  {l.category}
                </Badge>
              )}
              <Badge tone="muted">{clusterLabel(l)}</Badge>
              {l.best_visit_window && <Badge tone="warn">best visit {l.best_visit_window}</Badge>}
              {l.rating != null && (
                <Badge tone="muted" className="!normal-case !tracking-normal">
                  ★ {l.rating.toFixed(1)} · {l.reviews ?? 0} reviews
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <div className="min-w-[130px] rounded-inner border border-border/70 bg-base/50 px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-txt-faint">venue phone</div>
              <div className="mt-0.5 font-mono text-xs text-txt-muted">{l.venue_phone || "—"}</div>
            </div>
            <div className="min-w-[130px] max-w-[210px] rounded-inner border border-border/70 bg-base/50 px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-txt-faint">website</div>
              <div className="mt-0.5 truncate font-mono text-xs">
                {l.website ? (
                  <a
                    href={l.website.startsWith("http") ? l.website : `https://${l.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-glow"
                  >
                    {l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  </a>
                ) : (
                  <span className="text-txt-faint">none listed</span>
                )}
              </div>
            </div>
            <div className="rounded-inner border border-border/70 bg-base/50 px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-txt-faint">stage</div>
              <select
                value={l.stage}
                onChange={(e) => onStageChange(e.target.value as Stage)}
                disabled={busy}
                aria-label="Lead stage"
                className={cn(
                  "mt-1 cursor-pointer appearance-none rounded-[6px] border border-border bg-base px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.05em] outline-none focus:border-accent/50",
                  STAGE_CLASS[l.stage] || "text-txt-muted"
                )}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* two-column body */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* left: contacts & phone selector */}
        <section className="overflow-hidden rounded-panel border border-border bg-panel shadow-panel">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-txt-muted">
              01 · contacts &amp; phone selector
            </span>
            <span className={cn("font-mono text-[10px]", usable > 0 ? "text-healthy" : "text-txt-faint")}>
              {usable} usable #
            </span>
          </div>
          <div className="p-4">
            <ContactPhoneSelector
              contacts={detail.contacts}
              leadPhones={detail.leadPhones}
              leadEmails={detail.leadEmails}
              callNextPhoneId={callNextId(detail)}
              busy={busy}
              onOutcome={onOutcome}
              onQuickMark={onQuickMark}
              onEmailStatus={onEmailStatus}
              onAddPhone={onAddPhone}
              onAddContact={onAddContact}
            />
          </div>
        </section>

        {/* right: notes / next action / timeline */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="overflow-hidden rounded-panel border border-border bg-panel shadow-panel">
            <div className="border-b border-border/70 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-txt-muted">
              02 · venue notes
            </div>
            <div className="p-4">
              <textarea
                key={`notes-${l.id}`}
                defaultValue={l.notes || ""}
                onBlur={(e) => {
                  if (e.target.value !== (l.notes || "")) onNotesSave(e.target.value);
                }}
                rows={4}
                placeholder="counter space, foot traffic, who was behind the register…"
                className="w-full resize-y rounded-inner border border-border bg-base px-2.5 py-2 text-xs leading-relaxed text-txt-primary outline-none focus:border-accent/50"
              />
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-txt-faint/70">
                saves when you click away
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-panel border border-accent/30 bg-accent/[0.04]">
            <div className="border-b border-accent/20 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
              03 · next action
            </div>
            <div className="flex flex-wrap items-center gap-2 p-4">
              <input
                key={`next-${l.id}`}
                ref={nextRef}
                defaultValue={l.next_action || ""}
                onBlur={saveNextAction}
                placeholder="call the owner's best line, walk in Sat AM…"
                className="min-w-0 flex-1 rounded-inner border border-border bg-base px-2.5 py-2 text-[12.5px] text-txt-primary outline-none focus:border-accent/50"
              />
              <input
                key={`due-${l.id}`}
                ref={dueRef}
                defaultValue={l.next_action_due || ""}
                onBlur={saveNextAction}
                placeholder="due Thu · 7-10 PM"
                className="w-36 rounded-inner border border-warn/40 bg-warn/10 px-2.5 py-2 text-center font-mono text-[10px] uppercase text-warn outline-none placeholder:normal-case placeholder:text-warn/50 focus:border-warn"
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-panel border border-border bg-panel shadow-panel">
            <TouchpointTimeline touchpoints={detail.touchpoints} busy={busy} onQuickLog={onQuickLog} />
          </section>
        </div>
      </div>
    </div>
  );
}
