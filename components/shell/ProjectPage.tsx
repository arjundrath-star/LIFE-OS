"use client";
import { cn } from "@/lib/cn";
import { StatusDot, type DotState } from "@/components/StatusDot";

// Shared full-page template: a header band (title + hero metric(s) + live status)
// over stacked content sections. One dominant element per page = the hero band.
export function ProjectPage({
  title,
  subtitle,
  icon,
  statusDot,
  statusLabel,
  actions,
  hero,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  statusDot?: DotState;
  statusLabel?: string;
  actions?: React.ReactNode;
  hero?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-5">
      <header className="panel-hairline relative overflow-hidden rounded-panel border border-border bg-panel/60 p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-inner border border-accent/30 bg-accent/5 text-accent">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-xl tracking-tight text-txt-primary">{title}</h1>
                {statusDot && (
                  <StatusDot state={statusDot} pulse={statusDot === "healthy" || statusDot === "live"} size={8} />
                )}
                {statusLabel && (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-txt-faint">{statusLabel}</span>
                )}
              </div>
              {subtitle && <p className="mt-1 max-w-2xl text-sm text-txt-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {hero && <div className="mt-6">{hero}</div>}
      </header>
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  primary: "text-txt-primary",
  accent: "text-accent text-glow",
  muted: "text-txt-faint",
  warn: "text-warn",
  error: "text-error",
  healthy: "text-healthy",
};

export function HeroStat({
  label,
  value,
  sub,
  tone = "primary",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: keyof typeof TONES | string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-inner border border-border/70 bg-panel-2/30 px-4 py-3.5", className)}>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-txt-faint">{label}</div>
      <div className={cn("font-mono text-3xl font-semibold tabular leading-none lg:text-4xl", TONES[tone] || TONES.primary)}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-txt-muted">{sub}</div>}
    </div>
  );
}

export function Section({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-panel border border-border bg-panel shadow-panel", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-border/70 px-5 py-3">
          <div className="flex items-center gap-2">
            {icon && <span className="text-txt-faint">{icon}</span>}
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-txt-muted">{title}</h2>
          </div>
          {right}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
