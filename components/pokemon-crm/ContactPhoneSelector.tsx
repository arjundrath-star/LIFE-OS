"use client";
// Contact cards with the per-number phone selector — the core CRM interaction.
// Every number is individually markable; dead numbers dim + strike through but
// are NEVER removed from the list.
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";
import {
  type Contact,
  type EmailAddr,
  type EmailStatus,
  type Phone,
  type PhoneStatus,
  DEAD_EMAIL_STATUSES,
  EMAIL_STATUSES,
  PHONE_OUTCOME_BUTTONS,
  PHONE_STATUS_META,
} from "./types";

function confMeta(conf: string): { label: string; tone: "healthy" | "muted" | "warn" } {
  if (conf === "high") return { label: "high confidence", tone: "healthy" };
  if (conf === "medium") return { label: "med confidence", tone: "muted" };
  return { label: "needs review", tone: "warn" };
}

function PhoneRow({
  phone,
  isCallNext,
  busy,
  onOutcome,
  onQuickMark,
}: {
  phone: Phone;
  isCallNext: boolean;
  busy: boolean;
  onOutcome: (phoneId: number, outcome: PhoneStatus) => void;
  onQuickMark: (phoneId: number, status: "good" | "bad") => void;
}) {
  const meta = PHONE_STATUS_META[phone.status] || PHONE_STATUS_META.untested;
  const dead = meta.dead;
  const metaBits = [
    phone.phone_type !== "unknown" ? phone.phone_type : null,
    phone.call_count > 0 ? `${phone.call_count} call${phone.call_count === 1 ? "" : "s"}` : null,
    phone.notes,
  ].filter(Boolean);
  return (
    <div
      className={cn(
        "rounded-inner border px-2.5 py-2",
        isCallNext
          ? "border-accent-glow/45 bg-accent/5 shadow-glow-sm"
          : dead
            ? "border-border/90 bg-base/40 opacity-55"
            : "border-border/90 bg-base/60"
      )}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "whitespace-nowrap font-mono text-[13.5px] font-semibold",
              dead
                ? "text-txt-faint line-through decoration-error decoration-[1.5px]"
                : meta.tone === "healthy"
                  ? "text-healthy"
                  : "text-txt-primary"
            )}
          >
            {phone.phone}
          </span>
          {isCallNext && (
            <span className="inline-flex rounded border border-accent-glow/50 bg-accent/15 px-1 py-px font-mono text-[8.5px] font-bold tracking-[0.1em] text-accent-glow">
              CALL NEXT
            </span>
          )}
          <Badge tone={meta.tone} className="!px-1.5 !text-[8.5px]">
            {meta.label}
          </Badge>
          {metaBits.length > 0 && (
            <span className="truncate font-mono text-[9px] text-txt-faint">
              {metaBits.join(" · ")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onQuickMark(phone.id, "good")}
            disabled={busy}
            title="Mark good number"
            aria-label={`Mark ${phone.phone} good`}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-full border border-healthy/45 text-healthy transition-colors hover:bg-healthy/25 disabled:opacity-40",
              phone.status === "good" && "bg-healthy/20"
            )}
          >
            <Check size={12} strokeWidth={3} />
          </button>
          <button
            onClick={() => onQuickMark(phone.id, "bad")}
            disabled={busy}
            title="Mark bad number — stays visible, crossed out"
            aria-label={`Mark ${phone.phone} bad`}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-full border border-error/45 text-error transition-colors hover:bg-error/25 disabled:opacity-40",
              phone.status === "bad" && "bg-error/20"
            )}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PHONE_OUTCOME_BUTTONS.map((o) => (
          <button
            key={o.key}
            onClick={() => onOutcome(phone.id, o.key)}
            disabled={busy}
            className={cn(
              "rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] transition-colors hover:border-accent/50 hover:text-txt-primary disabled:opacity-40",
              phone.status === o.key ? "text-accent" : "text-txt-faint"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmailRows({
  emails,
  busy,
  onEmailStatus,
}: {
  emails: EmailAddr[];
  busy: boolean;
  onEmailStatus: (emailId: number, status: EmailStatus) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {emails.map((em) => {
        const dead = DEAD_EMAIL_STATUSES.includes(em.status);
        return (
          <div key={em.id} className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate font-mono text-[11.5px]",
                dead
                  ? "text-txt-faint line-through"
                  : em.status === "replied"
                    ? "text-healthy"
                    : "text-txt-muted"
              )}
            >
              {em.email}
            </span>
            <select
              value={em.status}
              onChange={(e) => onEmailStatus(em.id, e.target.value as EmailStatus)}
              disabled={busy}
              aria-label={`Status for ${em.email}`}
              className={cn(
                "shrink-0 cursor-pointer appearance-none rounded-[5px] border border-border bg-base px-1.5 py-0.5 font-mono text-[9.5px] outline-none focus:border-accent/50 disabled:opacity-40",
                dead ? "text-error" : em.status === "replied" ? "text-healthy" : "text-txt-muted"
              )}
            >
              {EMAIL_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function AddPhoneInline({
  onAdd,
  busy,
}: {
  onAdd: (phone: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-txt-faint transition-colors hover:text-accent"
      >
        <Plus size={10} /> number
      </button>
    );
  }
  const submit = () => {
    if (value.trim()) onAdd(value.trim());
    setValue("");
    setOpen(false);
  };
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="(617) 555-0100"
        autoFocus
        className="w-36 rounded-inner border border-border bg-base px-2 py-1 font-mono text-[11px] text-txt-primary outline-none focus:border-accent/50"
      />
      <Button size="sm" variant="accent" onClick={submit} disabled={busy}>
        add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        cancel
      </Button>
    </div>
  );
}

export function ContactPhoneSelector({
  contacts,
  leadPhones,
  leadEmails,
  callNextPhoneId,
  busy,
  onOutcome,
  onQuickMark,
  onEmailStatus,
  onAddPhone,
  onAddContact,
}: {
  contacts: Contact[];
  leadPhones: Phone[];
  leadEmails: EmailAddr[];
  callNextPhoneId: number | null;
  busy: boolean;
  onOutcome: (phoneId: number, outcome: PhoneStatus) => void;
  onQuickMark: (phoneId: number, status: "good" | "bad") => void;
  onEmailStatus: (emailId: number, status: EmailStatus) => void;
  onAddPhone: (contactId: number | null, phone: string) => void;
  onAddContact: (name: string, title: string) => void;
}) {
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const submitContact = () => {
    if (newName.trim()) onAddContact(newName.trim(), newTitle.trim());
    setNewName("");
    setNewTitle("");
    setAddingContact(false);
  };

  return (
    <div className="flex flex-col gap-3.5">
      {contacts.length === 0 && leadPhones.length === 0 && (
        <div className="py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-txt-faint/70">
          no contacts found — needs owner lookup
        </div>
      )}
      {contacts.map((c) => {
        const conf = confMeta(c.confidence);
        const needsReview = !c.title || c.title.toLowerCase().includes("review");
        return (
          <div key={c.id} className="rounded-inner border border-border/80 bg-panel-2/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-txt-primary">{c.name}</span>
              <Badge tone={needsReview ? "warn" : "accent"} className="!normal-case !tracking-normal">
                {c.title || "Needs Review"}
              </Badge>
              <Badge tone={conf.tone} className="!px-1.5 !text-[8.5px]">
                {conf.label}
              </Badge>
            </div>
            {c.source_note && (
              <div className="mt-0.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-txt-faint">
                PeopleFinder · {c.source_note}
              </div>
            )}
            <div className="mt-2.5 flex flex-col gap-1.5">
              {c.phones.map((p) => (
                <PhoneRow
                  key={p.id}
                  phone={p}
                  isCallNext={p.id === callNextPhoneId}
                  busy={busy}
                  onOutcome={onOutcome}
                  onQuickMark={onQuickMark}
                />
              ))}
              {c.phones.length === 0 && (
                <div className="font-mono text-[10px] text-txt-faint/70">no numbers on file</div>
              )}
              <AddPhoneInline busy={busy} onAdd={(phone) => onAddPhone(c.id, phone)} />
            </div>
            {c.emails.length > 0 && (
              <div className="mt-3 border-t border-dashed border-border pt-2">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-txt-faint/70">
                  emails · secondary channel
                </div>
                <EmailRows emails={c.emails} busy={busy} onEmailStatus={onEmailStatus} />
              </div>
            )}
          </div>
        );
      })}

      {(leadPhones.length > 0 || leadEmails.length > 0) && (
        <div className="rounded-inner border border-border/80 bg-panel-2/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-txt-primary">Venue-level</span>
            <Badge tone="warn" className="!normal-case !tracking-normal">
              unmapped
            </Badge>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-txt-faint">
            PeopleFinder couldn&apos;t tie these to one person — reassign as you learn who answers
          </div>
          {leadPhones.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {leadPhones.map((p) => (
                <PhoneRow
                  key={p.id}
                  phone={p}
                  isCallNext={p.id === callNextPhoneId}
                  busy={busy}
                  onOutcome={onOutcome}
                  onQuickMark={onQuickMark}
                />
              ))}
            </div>
          )}
          {leadEmails.length > 0 && (
            <div className={cn(leadPhones.length > 0 && "mt-3 border-t border-dashed border-border pt-2")}>
              <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-txt-faint/70">
                emails · secondary channel
              </div>
              <EmailRows emails={leadEmails} busy={busy} onEmailStatus={onEmailStatus} />
            </div>
          )}
        </div>
      )}

      {addingContact ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-inner border border-border/80 bg-panel-2/30 p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="contact name"
            autoFocus
            className="w-40 rounded-inner border border-border bg-base px-2 py-1 text-xs text-txt-primary outline-none focus:border-accent/50"
          />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitContact()}
            placeholder="title (Owner, Manager…)"
            className="w-44 rounded-inner border border-border bg-base px-2 py-1 text-xs text-txt-primary outline-none focus:border-accent/50"
          />
          <Button size="sm" variant="accent" onClick={submitContact} disabled={busy || !newName.trim()}>
            add contact
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingContact(false)}>
            cancel
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setAddingContact(true)}
          className="inline-flex items-center gap-1 self-start font-mono text-[10px] uppercase tracking-[0.06em] text-txt-faint transition-colors hover:text-accent"
        >
          <Plus size={11} /> add contact
        </button>
      )}
    </div>
  );
}
