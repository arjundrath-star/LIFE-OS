"use client";
import { cn } from "@/lib/cn";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { Maximize2 } from "lucide-react";

export function Panel({
  title,
  icon,
  state,
  live = false,
  right,
  onExpand,
  className,
  bodyClassName,
  children,
  subtitle,
}: {
  title: string;
  icon?: React.ReactNode;
  state?: DotState;
  live?: boolean;
  right?: React.ReactNode;
  onExpand?: () => void;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <section
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-panel border border-border bg-panel shadow-panel transition-colors",
        live && "border-accent/25",
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="text-txt-faint">{icon}</span>}
          <h2 className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-txt-muted">
            {title}
          </h2>
          {state && <StatusDot state={state} pulse={live} size={7} />}
          {subtitle && <span className="truncate text-[11px] text-txt-faint">· {subtitle}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {right}
          {onExpand && (
            <button
              onClick={onExpand}
              aria-label={`Expand ${title}`}
              className="opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 text-txt-faint"
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Honest empty/not-connected state. Use whenever a source has no live data. */
export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
      {icon && <div className="text-txt-faint/60">{icon}</div>}
      <div className="font-mono text-xs uppercase tracking-wider text-txt-faint">{title}</div>
      {hint && <p className="max-w-[28ch] text-xs leading-relaxed text-txt-faint/70">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
