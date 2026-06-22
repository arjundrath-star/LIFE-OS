"use client";
import { useState } from "react";
import { Panel, EmptyState } from "@/components/Panel";
import { StatusDot, type DotState } from "@/components/StatusDot";
import { Switch, Button, Badge } from "@/components/ui";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { Plug, RefreshCw, KeyRound, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

type Conn = {
  service: string;
  label: string;
  surface: string;
  state: "on_healthy" | "on_broken" | "off";
  enabled: boolean;
  health: string;
  detail: string | null;
  reconnect: string;
  note?: string;
  lastOkAt: string | null;
  lastChecked: string | null;
  configured: boolean;
};

const stateMap: Record<Conn["state"], { dot: DotState; label: string; tone: any }> = {
  on_healthy: { dot: "healthy", label: "healthy", tone: "healthy" },
  on_broken: { dot: "error", label: "broken", tone: "error" },
  off: { dot: "off", label: "off", tone: "off" },
};

async function post(url: string, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export function ConnectionsPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const conns = useLiveData<Conn[]>("connections") || [];
  const [busy, setBusy] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyVal, setKeyVal] = useState("");

  const recheck = async () => {
    setBusy(true);
    await post("/api/connections/recheck", {});
    setBusy(false);
  };

  const toggle = (c: Conn) => post("/api/connections/toggle", { service: c.service, surface: c.surface, enabled: !c.enabled });

  // group by service
  const groups = new Map<string, Conn[]>();
  for (const c of conns) {
    const arr = groups.get(c.service) || [];
    arr.push(c);
    groups.set(c.service, arr);
  }

  const healthy = conns.filter((c) => c.state === "on_healthy").length;
  const broken = conns.filter((c) => c.state === "on_broken").length;

  const submitKey = async (service: string) => {
    if (keyVal.length < 8) return;
    setBusy(true);
    await post("/api/connections/apikey", { service, value: keyVal });
    setKeyVal("");
    setKeyFor(null);
    setBusy(false);
  };

  return (
    <Panel
      title="Connections"
      icon={<Plug size={13} />}
      state={broken > 0 ? "warn" : "healthy"}
      subtitle={`${healthy} healthy${broken ? ` · ${broken} broken` : ""}`}
      onExpand={onExpand}
      right={
        <Button variant="ghost" size="sm" onClick={recheck} disabled={busy}>
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> recheck
        </Button>
      }
      bodyClassName={cn("space-y-2 overflow-auto", expanded ? "max-h-[70vh]" : "max-h-[340px]")}
    >
      {conns.length === 0 ? (
        <EmptyState title="loading control plane" />
      ) : (
        Array.from(groups.entries()).map(([service, surfaces]) => {
          const first = surfaces[0];
          return (
            <div key={service} className="rounded-inner border border-border/70 bg-panel-2/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-txt-primary">{first.label}</div>
                  {first.note && <div className="truncate text-[11px] text-txt-faint">{first.note}</div>}
                </div>
                <ReconnectAction conn={first} onKey={() => setKeyFor(keyFor === service ? null : service)} />
              </div>

              {/* per-surface states */}
              <div className="mt-2 flex flex-wrap gap-2">
                {surfaces.map((c) => {
                  const sm = stateMap[c.state];
                  return (
                    <div
                      key={c.surface}
                      className={cn(
                        "flex items-center gap-2 rounded border px-2 py-1",
                        c.state === "on_broken" ? "border-error/40 bg-error/5" : "border-border bg-panel/50"
                      )}
                      title={c.detail || ""}
                    >
                      <StatusDot state={sm.dot} size={6} pulse={c.state === "on_healthy"} />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-txt-muted">{c.surface}</span>
                      <Badge tone={sm.tone} className="!text-[9px]">{sm.label}</Badge>
                      <Switch checked={c.enabled} onCheckedChange={() => toggle(c)} />
                    </div>
                  );
                })}
              </div>

              {/* detail line */}
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-txt-faint">
                <span className="truncate">{first.detail}</span>
                {first.lastChecked && <span className="shrink-0 font-mono">checked {timeAgo(first.lastChecked)}</span>}
              </div>

              {/* api-key entry */}
              {keyFor === service && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="password"
                    value={keyVal}
                    onChange={(e) => setKeyVal(e.target.value)}
                    placeholder={`paste ${service} API token`}
                    className="flex-1 rounded-inner border border-border bg-base px-2 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-accent/50"
                  />
                  <Button size="sm" variant="accent" disabled={busy || keyVal.length < 8} onClick={() => submitKey(service)}>
                    save
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
    </Panel>
  );
}

function ReconnectAction({ conn, onKey }: { conn: Conn; onKey: () => void }) {
  if (conn.reconnect === "api_key") {
    return (
      <Button variant="outline" size="sm" onClick={onKey}>
        <KeyRound size={12} /> {conn.configured ? "update key" : "add key"}
      </Button>
    );
  }
  if (conn.reconnect === "oauth" && conn.service === "google") {
    return (
      <a href="/api/google/connect">
        <Button variant="accent" size="sm">
          <ExternalLink size={12} /> connect
        </Button>
      </a>
    );
  }
  if (conn.reconnect === "oauth") {
    return (
      <Badge tone="off" className="!normal-case">{conn.configured ? "authorize" : "needs setup"}</Badge>
    );
  }
  if (conn.reconnect === "device_code") {
    return <Badge tone="muted" className="!normal-case">re-auth on VPS</Badge>;
  }
  return <Badge tone="muted" className="!normal-case">systemd</Badge>;
}
