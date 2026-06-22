"use client";
import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { Hero } from "@/components/Hero";
import { Ticker } from "@/components/Ticker";
import { Dialog, DialogContent, Button } from "@/components/ui";
import { useIdle } from "@/hooks/useIdle";
import { cn } from "@/lib/cn";
import { Moon, Sun, LogOut, Power } from "lucide-react";
import { Terminal as TermIcon, FolderOpen } from "lucide-react";

import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { ConnectionsPanel } from "@/components/panels/ConnectionsPanel";
import { ProjectsPanel } from "@/components/panels/ProjectsPanel";
import { EmailPanel } from "@/components/panels/EmailPanel";
import { CalendarPanel } from "@/components/panels/CalendarPanel";
import { HealthPanel } from "@/components/panels/HealthPanel";
import { VendingPanel } from "@/components/panels/VendingPanel";
import { AdAgencyPanel } from "@/components/panels/AdAgencyPanel";
import { SchoolPanel } from "@/components/panels/SchoolPanel";
import { AccountsPanel } from "@/components/panels/AccountsPanel";
import { TodosPanel } from "@/components/panels/TodosPanel";
import { EmbedPanel } from "@/components/panels/EmbedPanel";

type User = { email?: string | null; name?: string | null; picture?: string | null };

export function Dashboard({ user }: { user: User }) {
  const [idle] = useIdle(180000); // 3 min → cinematic
  const [manualAmbient, setManualAmbient] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const mode: "working" | "ambient" = manualAmbient || idle ? "ambient" : "working";

  // leaving ambient when the user interacts is handled by useIdle resetting idle=false;
  // also clear the manual flag on real interaction
  useEffect(() => {
    if (!manualAmbient) return;
    const clear = () => setManualAmbient(false);
    const events = ["mousedown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, clear, { once: true }));
    return () => events.forEach((e) => window.removeEventListener(e, clear));
  }, [manualAmbient]);

  const expandedNode = useMemo(() => {
    switch (expanded) {
      case "agents": return <AgentsPanel expanded />;
      case "connections": return <ConnectionsPanel expanded />;
      case "projects": return <ProjectsPanel expanded />;
      case "email": return <EmailPanel expanded />;
      case "calendar": return <CalendarPanel expanded />;
      case "vending": return <VendingPanel expanded />;
      case "accounts": return <AccountsPanel expanded />;
      case "terminal": return <EmbedPanel title="Terminal" icon={<TermIcon size={13} />} src="/terminal/" expanded />;
      case "files": return <EmbedPanel title="Files" icon={<FolderOpen size={13} />} src="/files/" expanded />;
      case "health": return <HealthPanel />;
      case "adagency": return <AdAgencyPanel />;
      case "school": return <SchoolPanel />;
      case "todos": return <TodosPanel />;
      default: return null;
    }
  }, [expanded]);

  const exp = (k: string) => () => setExpanded(k);

  return (
    <div className={cn("min-h-screen px-4 py-4 lg:px-6", mode === "ambient" && "cursor-none")}>
      {/* top bar */}
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-inner border border-accent/40 bg-accent/5 shadow-glow-sm">
            <span className="font-mono text-sm font-bold text-accent text-glow">R</span>
          </div>
          <div>
            <div className="font-mono text-sm tracking-tight text-txt-primary">rathworkspace</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-txt-faint">command center</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setManualAmbient((v) => !v)} title="Toggle ambient mode">
            {mode === "ambient" ? <Sun size={14} /> : <Moon size={14} />}
            <span className="hidden sm:inline">{mode === "ambient" ? "working" : "ambient"}</span>
          </Button>
          <div className="flex items-center gap-2 rounded-inner border border-border bg-panel/60 px-2 py-1">
            {user.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
                {user.email?.[0]?.toUpperCase()}
              </div>
            )}
            <span className="hidden font-mono text-[11px] text-txt-muted md:inline">{user.email}</span>
            <button onClick={() => signOut({ callbackUrl: "/signin" })} className="text-txt-faint hover:text-error" title="Sign out">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className={cn("rounded-panel border border-border bg-panel/40 p-4 transition-all", mode === "ambient" && "border-transparent bg-transparent")}>
        <Hero mode={mode} />
        {mode === "working" && (
          <div className="mt-3 border-t border-border/60">
            <Ticker />
          </div>
        )}
      </section>

      {/* ops grid */}
      {mode === "working" && (
        <main className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <div className="md:col-span-2"><AgentsPanel onExpand={exp("agents")} /></div>
          <div className="md:col-span-2"><ConnectionsPanel onExpand={exp("connections")} /></div>

          <EmailPanel onExpand={exp("email")} />
          <CalendarPanel onExpand={exp("calendar")} />
          <div className="md:col-span-2"><ProjectsPanel onExpand={exp("projects")} /></div>

          <VendingPanel onExpand={exp("vending")} />
          <HealthPanel onExpand={exp("health")} />
          <TodosPanel onExpand={exp("todos")} />
          <SchoolPanel onExpand={exp("school")} />

          <EmbedPanel title="Terminal" icon={<TermIcon size={13} />} src="/terminal/" onExpand={exp("terminal")} />
          <EmbedPanel title="Files" icon={<FolderOpen size={13} />} src="/files/" onExpand={exp("files")} />
          <div className="md:col-span-2"><AccountsPanel onExpand={exp("accounts")} /></div>
          <AdAgencyPanel onExpand={exp("adagency")} />
        </main>
      )}

      {/* drill-down */}
      <Dialog open={!!expanded} onOpenChange={(o) => !o && setExpanded(null)}>
        {expanded && <DialogContent title={expanded}>{<div className="p-4">{expandedNode}</div>}</DialogContent>}
      </Dialog>
    </div>
  );
}
