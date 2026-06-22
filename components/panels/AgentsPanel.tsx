"use client";
import { Panel, EmptyState } from "@/components/Panel";
import { StatusDot } from "@/components/StatusDot";
import { useLiveData, useConnStatus } from "@/hooks/useLiveData";
import { timeAgo, hhmm } from "@/lib/time";
import { Bot, Cpu, Send, Terminal as TermIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const sourceIcon: Record<string, React.ReactNode> = {
  hermes: <Cpu size={12} />,
  telegram: <Send size={12} />,
  claude: <TermIcon size={12} />,
};

export function AgentsPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const agents = useLiveData<any>("agents");
  const status = useConnStatus();
  const hermes = agents?.hermes;
  const tg = agents?.telegram;
  const claude = agents?.claude;

  const liveBadge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-widest",
        status === "open" ? "border-accent/40 text-accent bg-accent/10" : "border-warn/40 text-warn bg-warn/10"
      )}
    >
      <StatusDot state={status === "open" ? "live" : "warn"} size={5} pulse={status === "open"} />
      {status === "open" ? "LIVE WS" : status.toUpperCase()}
    </span>
  );

  return (
    <Panel
      title="Agents"
      icon={<Bot size={13} />}
      state={hermes?.online ? "healthy" : "error"}
      live={hermes?.online}
      right={liveBadge}
      onExpand={onExpand}
      bodyClassName="space-y-3"
    >
      {!agents ? (
        <EmptyState title="connecting" hint="reading Hermes gateway + Telegram listener" />
      ) : (
        <>
          {/* agent rows */}
          <div className="space-y-2">
            <AgentRow
              icon={<Cpu size={13} />}
              name="Hermes"
              state={hermes?.online ? "healthy" : "error"}
              status={hermes?.online ? `online · ${hermes.gatewayState}` : hermes?.detail || "offline"}
              meta={hermes?.version ? `v${hermes.version} · ${hermes.activeSessions} sessions` : ""}
            />
            <AgentRow
              icon={<Send size={13} />}
              name="Telegram"
              state={tg?.state === "active" || tg?.state === "idle" ? "healthy" : tg?.state === "conflict" ? "warn" : "error"}
              status={tg?.detail || tg?.state || "—"}
              meta={tg?.lastEventAt ? `last ${timeAgo(tg.lastEventAt)}` : ""}
            />
            <AgentRow
              icon={<TermIcon size={13} />}
              name="Claude Code"
              state={claude ? "healthy" : "off"}
              status={claude ? claude.summary : "no session reports yet"}
              meta={claude ? timeAgo(claude.lastAt) : "add Stop-hook to enable"}
            />
          </div>

          {/* hermes platforms */}
          {hermes?.platforms?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
              {hermes.platforms.map((p: any) => (
                <span key={p.name} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-txt-muted">
                  <StatusDot state={p.state === "connected" ? "healthy" : "warn"} size={5} />
                  {p.name}
                </span>
              ))}
            </div>
          )}

          {/* activity feed */}
          <div className="border-t border-border/60 pt-2">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">activity</div>
            <div className={cn("space-y-1 overflow-auto", expanded ? "max-h-[50vh]" : "max-h-32")}>
              {(agents.activity || []).length === 0 ? (
                <div className="text-xs text-txt-faint/70">no recent agent activity</div>
              ) : (
                agents.activity.map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 text-txt-faint/60">{sourceIcon[a.source]}</span>
                    <span className="font-mono text-[10px] text-txt-faint/70">{hhmm(a.ts)}</span>
                    <span className="min-w-0 flex-1 truncate text-txt-muted">{a.summary}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function AgentRow({
  icon,
  name,
  state,
  status,
  meta,
}: {
  icon: React.ReactNode;
  name: string;
  state: any;
  status: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-inner border border-border/60 bg-panel-2/40 px-3 py-2">
      <span className="text-txt-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-txt-primary">{name}</span>
          <StatusDot state={state} size={6} pulse={state === "healthy"} />
        </div>
        <div className="truncate text-xs text-txt-muted">{status}</div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-txt-faint">{meta}</span>
    </div>
  );
}
