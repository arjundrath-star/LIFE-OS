"use client";
// Stern takeover shell: charcoal rail (240px, collapsible to 64px), 56px header with
// search, Quick add, sync status, and account. Mirrors BusinessShell; theme is the
// .stern-mode scope in app/globals.css.
import Link from "next/link";
import { SternSearch } from "./Search";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  ContactRound,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Target,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { STERN_ROUTES, activeSternRoute, sternPageTitle } from "@/lib/stern-workspace";
import type { SternSnapshot } from "@/lib/stern-types";
import { useConnStatus, useLiveData } from "@/hooks/useLiveData";
import { useApi } from "@/hooks/useApi";
import { timeAgo } from "@/lib/time";

import { QuickAddSheet } from "@/components/stern/network/QuickAddSheet";

const ICONS: Record<(typeof STERN_ROUTES)[number]["key"], LucideIcon> = {
  overview: LayoutDashboard,
  recruiting: Handshake,
  network: ContactRound,
  tasks: CheckSquare,
  classes: BookOpen,
  career: Target,
  automation: Workflow,
};

const RAIL_KEY = "stern_rail_collapsed";

type User = { email?: string | null; name?: string | null; picture?: string | null };

function initials(user: User): string {
  const name = (user.name || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }
  return (user.email?.[0] ?? "?").toUpperCase();
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select, [contenteditable='true']");
}

function SyncStatus() {
  const { data: initial } = useApi<SternSnapshot>("/api/stern");
  const snapshot = useLiveData<SternSnapshot>("stern") || initial;
  const conn = useConnStatus();
  const lastError = snapshot?.automation?.lastError || "";
  const state = conn === "open" ? (snapshot ? (lastError ? "warn" : "ok") : "warn") : conn === "connecting" ? "warn" : "error";
  const lastScan = snapshot?.automation?.lastScanAt || "";
  const text =
    conn === "closed" ? "Live updates offline" : lastError ? "Scan error" : lastScan ? `Last scan ${timeAgo(lastScan)}` : "No scan yet";
  return (
    <span className="stern-sync" data-testid="stern-sync" data-state={state} title={lastError ? `Last scan error: ${lastError}` : `WebSocket ${conn}`}>
      <i aria-hidden="true" />
      <span className="stern-mono">{text}</span>
    </span>
  );
}

export function SternShell({ user, children }: { user: User; children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add("stern-theme");
    return () => document.body.classList.remove("stern-theme");
  }, []);
  const pathname = usePathname();
  const { data: initialSnapshot } = useApi<SternSnapshot>("/api/stern");
  const liveSnapshot = useLiveData<SternSnapshot>("stern");
  const networkCount = (liveSnapshot || initialSnapshot)?.network.counts.needToReachOut || 0;
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);

  // Restore rail state after mount so SSR and CSR widths match on first paint.
  useEffect(() => {
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

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) drawer.current?.focus();
  }, [open]);

  // Escape: close the mobile drawer if open; otherwise, with no dialog open and focus
  // outside a field, return to the dashboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (document.querySelector("[role='dialog']")) return;
      if (isEditableTarget(event.target)) return;
      router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  const quickAdd = () => window.dispatchEvent(new CustomEvent("stern:quick-add"));

  const nav = (
    <aside ref={drawer} tabIndex={-1} className="stern-rail" aria-label="Stern navigation" data-testid="stern-rail">
      <div className="stern-brand">
        <span aria-hidden="true">S</span>
        <strong>Stern</strong>
        <button data-testid="stern-rail-close" className="stern-rail-close" onClick={() => setOpen(false)} aria-label="Close navigation">
          <X />
        </button>
      </div>
      <nav>
        {STERN_ROUTES.map(({ href, label, key }) => {
          const Icon = ICONS[key];
          const active = activeSternRoute(pathname)?.href === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={active ? "active" : ""}
              title={collapsed ? label : undefined}
              data-testid={`stern-nav-${key}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {key === "network" && networkCount > 0 && <b className="stern-network-rail-count stern-mono" data-testid="stern-network-rail-count" title="People who need outreach">{networkCount}</b>}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        data-testid="stern-rail-toggle" className="stern-rail-toggle"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>
      <Link href="/" className="stern-rail-back" title="Back to dashboard" data-testid="stern-back">
        <ChevronLeft aria-hidden="true" />
        <span>Back to dashboard</span>
      </Link>
    </aside>
  );

  return (
    <div className={collapsed ? "stern-mode stern-rail-collapsed" : "stern-mode"} data-testid="stern-shell">
      <div className="stern-desktop-rail">{nav}</div>
      {open && (
        <div className="stern-mobile-nav" role="dialog" aria-modal="true" aria-label="Stern navigation">
          <button data-testid="stern-rail-scrim" className="stern-scrim" onClick={() => setOpen(false)} aria-label="Close navigation" />
          {nav}
        </div>
      )}
      <div className="stern-column">
        <header className="stern-header">
          <button data-testid="stern-rail-menu" className="stern-menu" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </button>
          <div className="stern-header-title" data-testid="stern-page-title">{sternPageTitle(pathname)}</div>
          <SternSearch />
          <div className="stern-header-right">
            <button type="button" className="stern-quick-add" onClick={quickAdd} data-testid="stern-quick-add-button">
              <Plus aria-hidden="true" />
              Quick add
            </button>
            <SyncStatus />
            <span className="stern-avatar" title={user.email ?? undefined} data-testid="stern-avatar">
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                initials(user)
              )}
            </span>
            <button
              type="button"
              data-testid="stern-signout" className="stern-signout"
              onClick={() => signOut({ callbackUrl: "/signin" })}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut />
            </button>
          </div>
        </header>
        <main className="stern-main">{children}</main>
        <Suspense fallback={null}><QuickAddSheet /></Suspense>
      </div>
    </div>
  );
}
