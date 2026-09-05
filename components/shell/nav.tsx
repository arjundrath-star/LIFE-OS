"use client";
// Flat, all-top-level nav (deliberate: no nesting). One source of truth for the
// rail and the command palette. Order is intentional and must not be re-sorted:
// Home, Kanban, Agents, AgentMemory, Email, Calendar, Business, Ad Agency, Stern,
// Health, Connections, Projects, Terminal, Files, Accounts. The former School and
// Career entries live inside the Stern tab (/stern, /stern/career).
import {
  Home,
  Columns3,
  Bot,
  Mail,
  Calendar,
  BriefcaseBusiness,
  Clapperboard,
  GraduationCap,
  Activity,
  Plug,
  FolderGit2,
  Terminal,
  FolderOpen,
  Link2,
  BrainCircuit,
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
  { key: "kanban", label: "Kanban", href: "/kanban", Icon: Columns3 },
  { key: "agents", label: "Agents", href: "/agents", Icon: Bot },
  { key: "agentmemory", label: "AgentMemory", href: "/agentmemory", Icon: BrainCircuit },
  { key: "email", label: "Email", href: "/email", Icon: Mail },
  { key: "calendar", label: "Calendar", href: "/calendar", Icon: Calendar },
  { key: "business", label: "Business", href: "/business", Icon: BriefcaseBusiness },
  { key: "ad-agency", label: "Ad Agency", href: "/ad-agency", Icon: Clapperboard },
  { key: "stern", label: "Stern", href: "/stern", Icon: GraduationCap },
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
