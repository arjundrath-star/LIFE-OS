"use client";
// Stern page primitives. Client-safe: imports labels and tones from lib/stern-types only.
import type { ReactNode } from "react";
import { SOURCE_BADGE_LABELS, sourceBadgeKind, statusLabel, statusTone, type StatusTone } from "@/lib/stern-types";

export function SternPage({
  title,
  subtitle,
  actions,
  children,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="stern-page" data-testid={testId}>
      <div className="stern-page-header" data-component="PageHeader">
        <div>
          <h1>{title}</h1>
          {subtitle && <span className="stern-page-subtitle">{subtitle}</span>}
        </div>
        {actions && <div className="stern-page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function SternSection({
  title,
  note,
  children,
  className = "",
  flush = false,
  testId,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  /** remove the body padding for tables and lists that manage their own rows */
  flush?: boolean;
  testId?: string;
}) {
  return (
    <section className={`stern-section ${className}`.trim()} data-testid={testId}>
      <header>
        <h2>{title}</h2>
        {note && <div>{note}</div>}
      </header>
      <div className={flush ? "stern-section-body flush" : "stern-section-body"}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  tone = "neutral",
  sub,
  testId,
}: {
  label: string;
  value: ReactNode;
  tone?: StatusTone;
  sub?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="stern-stat-tile" data-component="StatTile" data-tone={tone} data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Renders the display label for any Stern enum value with its status color. */
export function StatusChip({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  return (
    <span className={`stern-chip ${className}`.trim()} data-tone={statusTone(value)} data-value={value}>
      <i aria-hidden="true" />
      {label ?? statusLabel(value)}
    </span>
  );
}

export function StrengthDots({
  value,
  onChange,
  editable = false,
  label = "Relationship strength",
}: {
  value: number;
  onChange?: (next: number) => void;
  editable?: boolean;
  label?: string;
}) {
  const current = Math.max(0, Math.min(5, Math.round(value || 0)));
  const dots = [1, 2, 3, 4, 5];
  if (editable && onChange) {
    return (
      <span className="stern-dots" role="radiogroup" aria-label={label} data-testid="stern-strength-dots">
        {dots.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === current}
            aria-label={`${n} of 5`}
            data-testid={`stern-strength-${n}`}
            onClick={() => onChange(n)}
          >
            <i className={n <= current ? "on" : ""} />
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="stern-dots" role="img" aria-label={`${label} ${current} of 5`} data-testid="stern-strength-dots">
      {dots.map((n) => (
        <i key={n} className={n <= current ? "on" : ""} />
      ))}
    </span>
  );
}

/** Change-source badge: Manual, Auto (email), Auto (calendar), Auto (iMessage), Suggested. */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  const kind = sourceBadgeKind(source);
  return (
    <span className="stern-source-badge" data-kind={kind} data-testid="stern-source-badge">
      {SOURCE_BADGE_LABELS[kind]}
    </span>
  );
}

/** Honest empty state: says what data is missing and how it arrives. Never fake data. */
export function EmptyState({
  title,
  hint,
  action,
  icon,
  testId,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="stern-empty" data-component="EmptyState" data-testid={testId}>
      {icon}
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stern-skeleton" aria-busy="true" aria-label="Loading" data-testid="stern-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
