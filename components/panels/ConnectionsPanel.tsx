"use client";
import { useEffect, useState } from "react";
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
  // Whoop developer-app credential entry (two fields, then OAuth redirect)
  const [whoopForm, setWhoopForm] = useState(false);
  const [wId, setWId] = useState("");
  const [wSecret, setWSecret] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [callbackUri, setCallbackUri] = useState("/api/whoop/callback");
  const [discordForm,setDiscordForm]=useState(false); const [discordToken,setDiscordToken]=useState(""); const [discordChannels,setDiscordChannels]=useState(""); const [discordMeta,setDiscordMeta]=useState<any>(null);

  // Surface the OAuth round-trip result (callback redirects back with a query flag).
  useEffect(() => {
    setCallbackUri(`${window.location.origin}/api/whoop/callback`);
    fetch("/api/connections/discord").then(r=>r.ok?r.json():null).then(setDiscordMeta).catch(()=>{});
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("whoop_connected");
    const err = p.get("whoop_error");
    if (ok) setNotice({ tone: "ok", text: `Whoop connected (${ok}). Vitals will fill in shortly.` });
    else if (err) setNotice({ tone: "err", text: `Whoop connect failed: ${err.replace(/_/g, " ")}` });
    if (ok || err) window.history.replaceState({}, "", window.location.pathname);
  }, []);

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

  // Save the WHOOP developer-app credentials, then bounce straight into the OAuth consent.
  const saveWhoopCreds = async () => {
    if (wId.trim().length < 8 || wSecret.trim().length < 8) return;
    setBusy(true);
    const r = await post("/api/whoop/credentials", { clientId: wId.trim(), clientSecret: wSecret.trim() });
    setBusy(false);
    if (r?.error) {
      setNotice({ tone: "err", text: r.error });
      return;
    }
    setWId("");
    setWSecret("");
    setWhoopForm(false);
    window.location.href = "/api/whoop/connect"; // start the WHOOP authorize flow
  };
  const saveDiscord=async()=>{setBusy(true);const r=await post("/api/connections/discord",{token:discordToken,channelIds:discordChannels});setBusy(false);if(r?.error){setNotice({tone:"err",text:r.error});return;}setDiscordToken("");setDiscordChannels("");setDiscordForm(false);setNotice({tone:"ok",text:"Discord bot verified and watched channels saved."});};

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
      {notice && (
        <div
          className={cn(
            "rounded-inner border px-3 py-2 text-[11px]",
            notice.tone === "ok" ? "border-healthy/40 bg-healthy/5 text-healthy" : "border-error/40 bg-error/5 text-error"
          )}
        >
          {notice.text}
        </div>
      )}
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
                <ReconnectAction
                  conn={first}
                  onKey={() => setKeyFor(keyFor === service ? null : service)}
                  onWhoopSetup={() => setWhoopForm((v) => !v)}
                  onDiscordSetup={() => setDiscordForm(v=>!v)}
                />
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

              {/* whoop developer-app credential entry → then OAuth */}
              {service === "whoop" && whoopForm && (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] leading-relaxed text-txt-faint">
                    Create an app at developer.whoop.com (v2), add redirect URI{" "}
                    <span className="font-mono text-txt-muted">{callbackUri}</span>, enable the recovery/sleep/cycles/profile
                    scopes + offline, then paste the Client ID and Secret here.
                  </p>
                  <input
                    type="text"
                    value={wId}
                    onChange={(e) => setWId(e.target.value)}
                    placeholder="WHOOP Client ID"
                    className="w-full rounded-inner border border-border bg-base px-2 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-accent/50"
                  />
                  <input
                    type="password"
                    value={wSecret}
                    onChange={(e) => setWSecret(e.target.value)}
                    placeholder="WHOOP Client Secret"
                    className="w-full rounded-inner border border-border bg-base px-2 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-accent/50"
                  />
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busy || wId.trim().length < 8 || wSecret.trim().length < 8}
                    onClick={saveWhoopCreds}
                  >
                    <ExternalLink size={12} /> save &amp; connect
                  </Button>
                </div>
              )}
              {service === "discord" && discordForm && <div className="mt-2 space-y-2"><p className="text-[11px] leading-relaxed text-txt-faint">Use an official Discord application bot already invited to each watched channel with View Channel and Read Message History. User accounts and self-bots are not supported.</p>{discordMeta?.installUrl?<a className="inline-flex text-xs text-accent underline" href={discordMeta.installUrl} target="_blank" rel="noreferrer">Install bot in a guild</a>:<a className="inline-flex text-xs text-accent underline" href={discordMeta?.developerUrl||"https://discord.com/developers/applications"} target="_blank" rel="noreferrer">Create or configure a Discord application</a>}<label className="block text-[11px] text-txt-muted">Bot token<input type="password" value={discordToken} onChange={e=>setDiscordToken(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-inner border border-border bg-base px-2 py-1.5 font-mono text-xs text-txt-primary"/></label><label className="block text-[11px] text-txt-muted">Watched numeric channel IDs<input value={discordChannels} onChange={e=>setDiscordChannels(e.target.value)} placeholder="123…, 456…" className="mt-1 w-full rounded-inner border border-border bg-base px-2 py-1.5 font-mono text-xs text-txt-primary"/></label><Button size="sm" variant="accent" disabled={busy||discordToken.length<20||!discordChannels.trim()} onClick={saveDiscord}>save &amp; verify</Button></div>}
            </div>
          );
        })
      )}
    </Panel>
  );
}

function ReconnectAction({ conn, onKey, onWhoopSetup, onDiscordSetup }: { conn: Conn; onKey: () => void; onWhoopSetup: () => void; onDiscordSetup:()=>void }) {
  if(conn.service==="discord") return <Button variant="outline" size="sm" onClick={onDiscordSetup}><KeyRound size={12}/>{conn.configured?"update bot":"set up bot"}</Button>;
  if (conn.reconnect === "api_key") {
    return (
      <Button variant="outline" size="sm" onClick={onKey}>
        <KeyRound size={12} /> {conn.configured ? "update key" : "add key"}
      </Button>
    );
  }
  if (conn.reconnect === "oauth" && conn.service === "whoop") {
    // Need the developer-app creds first → reveal the two-field form. Once configured,
    // the same button kicks off (or repairs) the OAuth authorize flow.
    if (!conn.configured) {
      return (
        <Button variant="accent" size="sm" onClick={onWhoopSetup}>
          <ExternalLink size={12} /> set up
        </Button>
      );
    }
    return (
      <a href="/api/whoop/connect">
        <Button variant={conn.state === "on_broken" ? "outline" : "accent"} size="sm">
          <ExternalLink size={12} /> {conn.state === "on_healthy" ? "reconnect" : "connect"}
        </Button>
      </a>
    );
  }
  if (conn.reconnect === "oauth" && (conn.service === "google" || conn.service.startsWith("career-google-"))) {
    const target = conn.service.startsWith("career-google-") ? `?target=${encodeURIComponent(conn.service.slice("career-google-".length))}` : "";
    return (
      <a href={`/api/google/connect${target}`}>
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
