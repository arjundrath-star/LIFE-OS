"use client";
// Flat, all-top-level nav (Arjun's explicit choice). One source of truth for the
// rail and the command palette. Order is intentional and must not be re-sorted.
import {
  Home,
  Bot,
  Mail,
  Calendar,
  Boxes,
  CircleDot,
  Clapperboard,
  GraduationCap,
  Activity,
  Plug,
  FolderGit2,
  Terminal,
  FolderOpen,
  Link2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  Icon: LucideIcon;
  /** terminal/files are embedded service views, not data pages */
  embed?: boolean;
};

export const NAV: NavItem[] = [
  { key: "home", label: "Home", href: "/", Icon: Home },
  { key: "agents", label: "Agents", href: "/agents", Icon: Bot },
  { key: "email", label: "Email", href: "/email", Icon: Mail },
  { key: "calendar", label: "Calendar", href: "/calendar", Icon: Calendar },
  { key: "vending", label: "Vending", href: "/vending", Icon: Boxes },
  { key: "pokemon-crm", label: "Pokemon CRM", href: "/pokemon-crm", Icon: CircleDot },
  { key: "ad-agency", label: "Ad Agency", href: "/ad-agency", Icon: Clapperboard },
  { key: "school", label: "School", href: "/school", Icon: GraduationCap },
  { key: "health", label: "Health", href: "/health", Icon: Activity },
  { key: "connections", label: "Connections", href: "/connections", Icon: Plug },
  { key: "projects", label: "Projects", href: "/projects", Icon: FolderGit2 },
  { key: "terminal", label: "Terminal", href: "/terminal", Icon: Terminal, embed: true },
  { key: "files", label: "Files", href: "/files", Icon: FolderOpen, embed: true },
  { key: "accounts", label: "Accounts", href: "/accounts", Icon: Link2 },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
