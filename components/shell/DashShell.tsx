"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { NavRail } from "@/components/shell/NavRail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { AmbientScreen } from "@/components/shell/AmbientScreen";
import { Ticker } from "@/components/Ticker";
import { NAV } from "@/components/shell/nav";
import { useIdle } from "@/hooks/useIdle";
import { cn } from "@/lib/cn";
import { Menu, X, Moon, Sun, LogOut } from "lucide-react";

type User = { email?: string | null; name?: string | null; picture?: string | null };

const RAIL_KEY = "rw_rail_collapsed";

export function DashShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [manualAmbient, setManualAmbient] = useState(false);
  const [idle] = useIdle(180000); // 3 min → cinematic
  const ambient = manualAmbient || idle;

  // restore rail state after mount (avoids SSR/CSR width mismatch)
  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(RAIL_KEY) === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  // ⌘K / Ctrl-K opens the palette anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close the mobile drawer on route change
  useEffect(() => setMobileOpen(false), [pathname]);

  // leaving manual ambient on real interaction (click/key/touch — not a mouse bump)
  useEffect(() => {
    if (!manualAmbient) return;
    const clear = () => setManualAmbient(false);
    const events = ["mousedown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, clear, { once: true }));
    return () => events.forEach((e) => window.removeEventListener(e, clear));
  }, [manualAmbient]);

  const section = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop rail */}
      <div className="hidden h-full shrink-0 lg:block">
        <NavRail collapsed={collapsed} onToggle={toggleCollapsed} onOpenPalette={() => setPaletteOpen(true)} />
      </div>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full animate-fade-in">
            <NavRail
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
              onOpenPalette={() => {
                setMobileOpen(false);
                setPaletteOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {/* content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-base/80 px-4 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-inner text-txt-muted hover:bg-white/5 hover:text-accent lg:hidden"
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
            <span className="truncate font-mono text-[12px] uppercase tracking-[0.18em] text-txt-faint">
              {section?.label ?? "rathworkspace"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setManualAmbient((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-inner border border-border bg-panel/60 px-2.5 text-txt-muted transition-colors hover:border-accent/50 hover:text-accent"
              title="Toggle ambient mode"
              aria-label="Toggle ambient mode"
            >
              {ambient ? <Sun size={14} /> : <Moon size={14} />}
              <span className="hidden font-mono text-[11px] sm:inline">{ambient ? "working" : "ambient"}</span>
            </button>
            <div className="flex items-center gap-2 rounded-inner border border-border bg-panel/60 px-2 py-1">
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
                  {user.email?.[0]?.toUpperCase()}
                </div>
              )}
              <span className="hidden max-w-[180px] truncate font-mono text-[11px] text-txt-muted md:inline">{user.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className="text-txt-faint transition-colors hover:text-error"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </header>

        <main className={cn("min-h-0 flex-1 overflow-y-auto", !pathname.match(/^\/(terminal|files)$/) && "px-4 py-5 lg:px-7 lg:py-6")}>
          {children}
        </main>

        {/* live event ticker — the always-present ambient health strip at the bottom */}
        <footer className="shrink-0 border-t border-border/70 bg-base/80">
          <Ticker />
        </footer>
      </div>

      {/* ambient screensaver overlay */}
      {mounted && ambient && <AmbientScreen />}

      {/* command palette */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onToggleAmbient={() => setManualAmbient((v) => !v)}
      />
    </div>
  );
}
