"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive, type NavItem } from "@/components/shell/nav";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import { daysUntilTerm } from "@/lib/school";
import { cn } from "@/lib/cn";
import { ChevronsLeft, ChevronsRight, Command } from "lucide-react";

type Indicator = { dot?: { state: DotState; pulse?: boolean }; badge?: string; badgeTone?: "accent" | "warn" };

// Per-item live status. Honest: only render an indicator when there is real live data.
function indicatorFor(item: NavItem, live: Live): Indicator | null {
  switch (item.key) {
    case "home":
      return { dot: { state: live.connStatus === "open" ? "live" : "warn", pulse: live.connStatus === "open" } };
    case "kanban": {
      const k = live.kanban;
      if (!k) return { dot: { state: "off" } };
      const blocked = k.stats?.blocked ?? 0;
      const active = k.stats?.active ?? 0;
      if (blocked > 0) return { badge: String(blocked), badgeTone: "warn" };
      if (active > 0) return { badge: active > 99 ? "99+" : String(active), badgeTone: "accent" };
      return { dot: { state: "off" } };
    }
    case "agents": {
      const p = live.pulse;
      if (!p) return { dot: { state: "off" } };
      const state: DotState = p.hermesOnline
        ? p.telegramState === "conflict"
          ? "warn"
          : "healthy"
        : "error";
      return { dot: { state, pulse: state === "healthy" } };
    }
    case "email": {
      const u = live.email?.totalUnread ?? 0;
      return u > 0 ? { badge: u > 99 ? "99+" : String(u), badgeTone: "accent" } : null;
    }
    case "calendar": {
      const n = live.cal?.connected ? live.cal?.events?.length ?? 0 : 0;
      return n > 0 ? { badge: String(n), badgeTone: "accent" } : null;
    }
    case "school":
      return live.days === null ? null : { badge: `${live.days}d`, badgeTone: "warn" };
    case "connections": {
      const broken = (live.conns || []).filter((c) => c.state === "on_broken").length;
      return broken > 0 ? { dot: { state: "warn", pulse: true } } : null;
    }
    default:
      return null;
  }
}

type Live = {
  pulse: any;
  kanban: any;
  email: any;
  cal: any;
  conns: { state: string }[];
  days: number | null;
  connStatus: "connecting" | "open" | "closed";
};

export function NavRail({
  collapsed,
  onToggle,
  onNavigate,
  onOpenPalette,
  toggleLabel,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  onOpenPalette?: () => void;
  /** overrides the collapse-button label (the mobile drawer uses "Close navigation") */
  toggleLabel?: string;
}) {
  const pathname = usePathname();
  const pulse = useLiveData<any>("pulse");
  const kanban = useLiveData<any>("kanban");
  const email = useLiveData<any>("email");
  const cal = useLiveData<any>("calendar");
  const conns = useLiveData<{ state: string }[]>("connections");
  const connStatus = useConnStatus();
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setDays(daysUntilTerm());
    tick();
    const t = setInterval(tick, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const live: Live = { pulse, kanban, email, cal, conns: conns || [], days, connStatus };

  return (
    <nav
      className={cn(
        "flex h-full flex-col border-r border-border bg-panel/60 backdrop-blur-sm transition-[width] duration-200 ease-out",
        collapsed ? "w-[56px]" : "w-[220px]"
      )}
      aria-label="Primary"
    >
      {/* brand + collapse */}
      <div className={cn("flex h-14 shrink-0 items-center border-b border-border/70", collapsed ? "justify-center px-0" : "justify-between px-3")}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-inner border border-accent/40 bg-accent/5 shadow-glow-sm">
              <span className="font-mono text-sm font-bold text-accent text-glow">R</span>
            </div>
            <span className="font-mono text-[13px] tracking-tight text-txt-primary">rathworkspace</span>
          </div>
        )}
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-inner text-txt-faint transition-colors hover:bg-white/5 hover:text-accent"
          aria-label={toggleLabel ?? (collapsed ? "Expand nav" : "Collapse nav")}
          title={toggleLabel ?? (collapsed ? "Expand" : "Collapse")}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      {/* items */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 py-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const ind = indicatorFor(item, live);
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-10 items-center rounded-inner transition-colors",
                collapsed ? "justify-center px-0" : "gap-3 px-3",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-txt-muted hover:bg-white/5 hover:text-txt-primary"
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent shadow-glow-sm" />}
              <span className="relative shrink-0">
                <item.Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                {/* collapsed: indicator floats on the icon corner */}
                {collapsed && ind?.dot && (
                  <span className="absolute -right-1.5 -top-1.5">
                    <StatusDot state={ind.dot.state} pulse={ind.dot.pulse} size={7} />
                  </span>
                )}
                {collapsed && ind?.badge && (
                  <span
                    className={cn(
                      "absolute -right-2.5 -top-2 rounded-full px-1 py-px font-mono text-[8px] font-semibold leading-none",
                      ind.badgeTone === "warn" ? "bg-warn/20 text-warn" : "bg-accent/20 text-accent"
                    )}
                  >
                    {ind.badge}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-[13px]">{item.label}</span>
                  {ind?.dot && <StatusDot state={ind.dot.state} pulse={ind.dot.pulse} size={7} />}
                  {ind?.badge && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none",
                        ind.badgeTone === "warn" ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent"
                      )}
                    >
                      {ind.badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>

      {/* footer: command palette hint + live status */}
      <div className="shrink-0 border-t border-border/70 p-2">
        <button
          onClick={onOpenPalette}
          className={cn(
            "flex w-full items-center rounded-inner text-txt-faint transition-colors hover:bg-white/5 hover:text-txt-muted",
            collapsed ? "h-9 justify-center" : "h-9 gap-2 px-3"
          )}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
        >
          <Command size={15} />
          {!collapsed && (
            <span className="flex flex-1 items-center justify-between">
              <span className="text-[12px]">Jump to…</span>
              <kbd className="rounded border border-border bg-base px-1.5 py-0.5 font-mono text-[10px] text-txt-faint">⌘K</kbd>
            </span>
          )}
        </button>
        <div className={cn("mt-1 flex items-center", collapsed ? "justify-center" : "gap-2 px-3 py-1")}>
          <StatusDot
            state={connStatus === "open" ? "live" : connStatus === "connecting" ? "warn" : "error"}
            pulse={connStatus === "open"}
            size={6}
          />
          {!collapsed && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-txt-faint">
              {connStatus === "open" ? "live" : connStatus === "connecting" ? "sync" : "offline"}
            </span>
          )}
        </div>
      </div>
    </nav>
  );
}
