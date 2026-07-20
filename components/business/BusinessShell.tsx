"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BarChart3, Bot, Boxes, Building2, ChevronLeft, CircleDollarSign, ContactRound, LogOut, Menu, PackageSearch, Plug, X } from "lucide-react";
import { BUSINESS_UNITS, BusinessProvider, useBusinessUnit } from "./BusinessContext";

const NAV = [
  { href: "/business", label: "Overview", Icon: BarChart3, exact: true },
  { href: "/business/crm", label: "CRM", Icon: ContactRound },
  { href: "/business/locations", label: "Locations", Icon: Building2 },
  { href: "/business/inventory", label: "Inventory", Icon: Boxes },
  { href: "/business/sourcing", label: "Sourcing", Icon: PackageSearch },
  { href: "/business/finance", label: "Finance", Icon: CircleDollarSign },
  { href: "/business/agents", label: "Agents", Icon: Bot },
  { href: "/business/integrations", label: "Integrations", Icon: Plug },
];

type User = { email?: string | null; name?: string | null; picture?: string | null };

function UnitSelect() {
  const { unit, setUnit } = useBusinessUnit();
  return (
    <label className="business-unit-control">
      <span>Business unit</span>
      <select value={unit} onChange={(event) => setUnit(event.target.value as any)}>
        {BUSINESS_UNITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  );
}

function ShellInner({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { if (open) drawer.current?.focus(); }, [open]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const nav = (
    <aside ref={drawer} tabIndex={-1} className="business-rail" aria-label="Business navigation">
      <div className="business-brand"><span>R</span><div><strong>Rathworkspace</strong><small>Business</small></div><button className="business-drawer-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X /></button></div>
      <nav>
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><Icon aria-hidden="true" /><span>{label}</span></Link>;
        })}
      </nav>
      <Link href="/" className="business-personal-switch"><ChevronLeft /> Personal workspace</Link>
    </aside>
  );

  const current = NAV.find((item) => item.exact ? pathname === item.href : pathname.startsWith(item.href));
  return (
    <div className="business-mode">
      <div className="business-desktop-rail">{nav}</div>
      {open && <div className="business-mobile-nav" role="dialog" aria-modal="true"><button className="business-scrim" onClick={() => setOpen(false)} aria-label="Close navigation" />{nav}</div>}
      <div className="business-column">
        <header className="business-header">
          <button className="business-menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="business-current"><small>Business</small><strong>{current?.label ?? "Workspace"}</strong></div>
          <UnitSelect />
          <div className="business-user"><span>{user.email}</span><button onClick={() => signOut({ callbackUrl: "/signin" })} aria-label="Sign out"><LogOut /></button></div>
        </header>
        <main className="business-main">{children}</main>
      </div>
    </div>
  );
}

export function BusinessShell(props: { user: User; children: React.ReactNode }) {
  return <BusinessProvider><ShellInner {...props} /></BusinessProvider>;
}
