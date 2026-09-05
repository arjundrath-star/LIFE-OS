"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Star, X, ExternalLink } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { statusLabel } from "@/lib/stern-types";

export function RecruitingButton({ className = "", primary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <Button {...props} className={`stern-btn ${primary ? "primary" : ""} ${className}`} />;
}
export function RecruitingDialog({ open, onOpenChange, title, children, error }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; error?: string }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="stern-recruiting-scrim" />
    <DialogPrimitive.Content className="stern-mode stern-recruiting-dialog" aria-describedby={undefined} onEscapeKeyDown={e => { e.preventDefault(); onOpenChange(false); }}>
      <header><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><RecruitingButton data-testid="stern-recruiting-dialog-close" aria-label="Close dialog"><X size={16}/></RecruitingButton></DialogPrimitive.Close></header>
      <div className="stern-recruiting-dialog-body">{error && <p role="alert" className="stern-recruiting-error">{error}</p>}{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></Dialog>;
}
export function PriorityStars({ priority, disabled, onChange }: { priority: number; disabled?: boolean; onChange: (n: number) => void }) {
  return <span className="stern-priority-stars" role="group" aria-label="Priority (three stars is top target)">{[1,2,3].map(stars => <button type="button" data-testid={`stern-club-priority-${stars}`} key={stars} disabled={disabled} onClick={() => onChange(4-stars)} aria-label={`Priority ${4-stars}${stars === 3 ? ', top target' : ''}`} aria-pressed={priority === 4-stars}><Star size={13} fill={stars <= 4-priority ? "currentColor" : "none"}/></button>)}</span>;
}
export function StatusSelect({ value, choices, label, disabled, onChange, testId }: { value: string; choices: readonly string[]; label: string; disabled?: boolean; onChange: (s: string) => void; testId: string }) {
  return <select className="stern-select stern-status-select" aria-label={label} data-testid={testId} value={value} disabled={disabled || choices.length === 0} onChange={e => onChange(e.target.value)}>{[value, ...choices].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>;
}
export function dateLabel(value: string, includeTime = false): string {
  if (!value) return "Not set";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return "Date needs review";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...(includeTime && !dateOnly ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const : {}) }).format(parsed);
}
export function SafeLink({ href, children, testId }: { href: string; children: ReactNode; testId: string }) {
  if (!/^https?:\/\//i.test(href)) return <span className="stern-muted">Link not posted yet</span>;
  return <a className="stern-recruiting-link" data-testid={testId} href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={12}/></a>;
}
export function MutationNotice({ notice, lastBatch, busy, undo }: { notice: string; lastBatch: string; busy: boolean; undo: () => void }) {
  return <>{notice && <p role="alert" className="stern-recruiting-error">{notice}</p>}{lastBatch && <div className="stern-recruiting-saved" role="status">Saved.<RecruitingButton data-testid="stern-recruiting-undo" disabled={busy} onClick={undo}>Undo last change</RecruitingButton></div>}</>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="stern-field"><span>{label}</span>{children}</label>; }
