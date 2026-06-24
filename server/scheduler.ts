// Server-side scheduler. The ONLY thing that polls sources. Pushes to the WS hub
// and writes history/events to SQLite. Panels never poll sources themselves.
import { getHub } from "@/server/live";
import { fetchHermesStatus } from "@/lib/sources/hermes";
import { readTelegramActivity } from "@/lib/sources/telegram";
import { listProjects } from "@/lib/sources/vault";
import { refreshAll, getStates } from "@/lib/connections";
import { agentsOrchestrationSnapshot } from "@/lib/agents";
import { all, get, run, pushEvent, recentEvents, nowIso } from "@/db";

const g = globalThis as any;

function claudeSelfReport() {
  const row = get<any>(
    "SELECT ts, summary, detail FROM agent_activity WHERE source='claude' ORDER BY id DESC LIMIT 1"
  );
  return row ? { lastAt: row.ts, summary: row.summary, detail: row.detail } : null;
}

function mergedActivity(limit = 14) {
  return all<any>(
    "SELECT ts, source, kind, summary FROM agent_activity ORDER BY id DESC LIMIT ?",
    limit
  );
}

async function tickAgents() {
  const hub = getHub();
  const [hermes, telegram] = [await fetchHermesStatus(), readTelegramActivity()];

  // --- change diffing -> ticker + activity log ---
  const last = hub.last;
  if (last.hermesOnline === undefined) last.hermesOnline = hermes.online;
  if (last.hermesOnline !== hermes.online) {
    last.hermesOnline = hermes.online;
    pushEvent("hermes", hermes.online ? "Hermes gateway back online" : "Hermes gateway offline", hermes.online ? "success" : "error");
    run("INSERT INTO agent_activity (source, kind, summary) VALUES ('hermes','event',?)", hermes.online ? "Gateway online" : "Gateway offline");
  }
  if (last.tgState === undefined) last.tgState = telegram.state;
  if (last.tgState !== telegram.state) {
    last.tgState = telegram.state;
    pushEvent("telegram", `Listener: ${telegram.state} — ${telegram.detail}`, telegram.state === "active" || telegram.state === "idle" ? "info" : "warn");
  }
  // new telegram meaningful event (dedupe by ts)
  const newestTg = telegram.events[0];
  if (newestTg && last.tgLastEventAt !== newestTg.ts) {
    last.tgLastEventAt = newestTg.ts;
    run("INSERT INTO agent_activity (ts, source, kind, summary) VALUES (?, 'telegram','message',?)", newestTg.ts, newestTg.message.slice(0, 200));
  }

  const claude = claudeSelfReport();

  hub.broadcast("agents", {
    hermes: {
      online: hermes.online,
      reachable: hermes.reachable,
      version: hermes.version,
      gatewayState: hermes.gatewayState,
      activeSessions: hermes.activeSessions,
      platforms: hermes.platforms,
      detail: hermes.error ?? null,
      checkedAt: hermes.checkedAt,
    },
    telegram,
    claude,
    activity: mergedActivity(),
    updatedAt: nowIso(),
  });

  // --- pulse (centerpiece source) ---
  const states = getStates();
  const healthy = states.filter((s) => s.state === "on_healthy").length;
  const broken = states.filter((s) => s.state === "on_broken").length;
  const off = states.filter((s) => s.state === "off").length;
  const activityRate = (get<any>(
    "SELECT COUNT(*) n FROM agent_activity WHERE ts > ?",
    new Date(Date.now() - 15 * 60 * 1000).toISOString()
  )?.n ?? 0) as number;

  const agentsActive =
    (hermes.online ? 1 : 0) +
    (telegram.state === "active" || telegram.state === "idle" ? 1 : 0);

  hub.broadcast("pulse", {
    hermesOnline: hermes.online,
    activeSessions: hermes.activeSessions,
    telegramState: telegram.state,
    agentsActive,
    agentsTotal: 3,
    connectionsHealthy: healthy,
    connectionsBroken: broken,
    connectionsOff: off,
    connectionsTotal: states.length,
    lastActivityAt: get<any>("SELECT ts FROM agent_activity ORDER BY id DESC LIMIT 1")?.ts ?? null,
    activityRate,
    ts: nowIso(),
  });

  hub.broadcast("ticker", recentEvents(40));
}

async function tickConnections() {
  const hub = getHub();
  const firstRun = hub.last.connStates === undefined;
  const before = (hub.last.connStates as any[]) || [];
  const beforeMap = new Map(before.map((s: any) => [`${s.service}:${s.surface}`, s.state]));
  const states = await refreshAll();

  if (firstRun) {
    // honest snapshot so the ticker isn't blank on boot — these are real current states
    const healthy = states.filter((s) => s.state === "on_healthy").length;
    const broken = states.filter((s) => s.state === "on_broken");
    pushEvent("connections", `${healthy} connections healthy across surfaces`, "success");
    for (const b of broken) {
      pushEvent("connections", `${b.label} (${b.surface}) needs attention: ${b.detail}`, "warn");
    }
  } else {
    for (const s of states) {
      const key = `${s.service}:${s.surface}`;
      const prev = beforeMap.get(key);
      if (prev && prev !== s.state) {
        pushEvent(
          "connections",
          `${s.label} (${s.surface}): ${prev} → ${s.state}`,
          s.state === "on_healthy" ? "success" : s.state === "on_broken" ? "warn" : "info"
        );
      }
    }
  }
  hub.last.connStates = states;
  hub.broadcast("connections", states);
}

async function tickProjects() {
  const hub = getHub();
  hub.broadcast("projects", listProjects());
}

async function tickEmail() {
  const hub = getHub();
  const mod = await import("@/lib/sources/google");
  try {
    await mod.pollEmailAccounts();
  } catch (e) {
    // a transient Gmail API error must NOT erase the known accounts — fall through
    // and still broadcast the last-known snapshot from the DB.
    console.error("[scheduler] email poll failed:", (e as Error).message);
  }
  hub.broadcast("email", mod.emailSnapshots());
}

async function tickCalendar() {
  const hub = getHub();
  try {
    const mod = await import("@/lib/sources/google");
    hub.broadcast("calendar", await mod.todaysEvents());
  } catch {
    hub.broadcast("calendar", { connected: 0, events: [] });
  }
}

async function tickVending() {
  const hub = getHub();
  const google = await import("@/lib/sources/google");
  try {
    await google.pollVendingOutreach();
  } catch (e) {
    // a transient Gmail error must not erase the cached counts — fall through and
    // broadcast the last-known snapshot from the DB.
    console.error("[scheduler] vending outreach poll failed:", (e as Error).message);
  }
  const { vendingSnapshot } = await import("@/lib/vending");
  const snap = vendingSnapshot();

  // Pulse only on change: announce new outreach / new replies on the ticker.
  const o = snap.outreach;
  if (o.connected) {
    const last = hub.last;
    if (last.vendReached !== undefined && o.reachedTotal > last.vendReached) {
      pushEvent("vending", `Reached out to ${o.reachedTotal - last.vendReached} new venue(s) — ${o.reachedTotal} total`, "info");
    }
    if (last.vendReplied !== undefined && o.respondedTotal > last.vendReplied) {
      pushEvent("vending", `${o.respondedTotal - last.vendReplied} new venue reply — ${o.respondedTotal} replied`, "success");
    }
    last.vendReached = o.reachedTotal;
    last.vendReplied = o.respondedTotal;
  }

  hub.broadcast("vending", snap);
}

async function tickHealth() {
  const hub = getHub();
  const mod = await import("@/lib/sources/whoop");
  // Only hit the WHOOP API when actually connected; otherwise just broadcast the
  // honest "not connected" snapshot so the Health panel shows connect-me, never fake vitals.
  if (mod.isConnected()) {
    try {
      await mod.pollWhoop();
    } catch (e) {
      console.error("[scheduler] whoop poll failed:", (e as Error).message);
    }
  }
  hub.broadcast("health", mod.healthSnapshot());
}

async function tickAgentRuns() {
  // Named-agent orchestration. The "source" is the SQLite orchestration tables, written by
  // scripts/agent-event.ts (Hermes/cron/Claude/shell) in a separate process. We only READ
  // and broadcast the snapshot here. Meaningful run events were already mirrored to the
  // `events` ticker by the writer (recordAgentEvent -> pushEvent), and tickAgents broadcasts
  // that `ticker` channel — so there is a single ticker path, no double-push here.
  const hub = getHub();
  hub.broadcast("agent_runs", agentsOrchestrationSnapshot());
}

function guarded(name: string, fn: () => Promise<void>) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[scheduler] ${name} failed:`, (e as Error).message);
    } finally {
      running = false;
    }
  };
}

export function startScheduler() {
  if (g.__rw_scheduler_started) return;
  g.__rw_scheduler_started = true;

  const agents = guarded("agents", tickAgents);
  const connections = guarded("connections", tickConnections);
  const projects = guarded("projects", tickProjects);
  const email = guarded("email", tickEmail);
  const calendar = guarded("calendar", tickCalendar);
  const health = guarded("health", tickHealth);
  const vending = guarded("vending", tickVending);
  const agentRuns = guarded("agentRuns", tickAgentRuns);

  // initial burst so first paint has data
  pushEvent("system", "rathworkspace command center online", "success");
  agents();
  connections();
  projects();
  email();
  calendar();
  health();
  vending();
  agentRuns();

  // retain handles so the scheduler can be stopped/reset cleanly
  g.__rw_timers = [
    setInterval(agents, 6000),
    setInterval(connections, 30000),
    setInterval(projects, 60000),
    setInterval(email, 60000),
    setInterval(calendar, 120000),
    setInterval(health, 15 * 60 * 1000), // WHOOP data updates ~once/day; 15 min is ample
    setInterval(vending, 10 * 60 * 1000), // outreach moves slowly; 10 min keeps Gmail load tiny
    setInterval(agentRuns, 5000), // named-agent runs: read SQLite + broadcast, cheap and bounded
  ];

  console.log("[scheduler] started");
}
