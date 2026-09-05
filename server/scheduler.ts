// Server-side scheduler. The ONLY thing that polls sources. Pushes to the WS hub
// and writes history/events to SQLite. Panels never poll sources themselves.
import { getHub } from "@/server/live";
import { fetchHermesStatus } from "@/lib/sources/hermes";
import { readTelegramActivity } from "@/lib/sources/telegram";
import { listProjects } from "@/lib/sources/vault";
import { refreshAll, getStates, isConnectionEnabled } from "@/lib/connections";
import { agentsOrchestrationSnapshot } from "@/lib/agents";
import { kanbanSnapshot } from "@/lib/kanban";
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
  const hermes = await fetchHermesStatus();
  const telegram = readTelegramActivity(hermes);

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
  try {
    const whoop = await import("@/lib/sources/whoop");
    if (isConnectionEnabled("whoop") && whoop.isAuthorized()) {
      await whoop.pollWhoop();
    }
  } catch (e) {
    console.error("[scheduler] whoop poll failed:", (e as Error).message);
  }
  try {
    const { syncHevy } = await import("@/lib/sources/hevy");
    if(isConnectionEnabled("hevy"))await syncHevy();
  } catch (e) {
    console.error("[scheduler] hevy poll failed:", (e as Error).message);
  }
  const { dashboardHealthSnapshot } = await import("@/lib/health");
  hub.broadcast("health", dashboardHealthSnapshot());
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

async function tickPokemonOpsRules() {
  // Daily pokemon-ops rules evaluation. The engine is deterministic — asOf is
  // stamped here at the boundary and threaded through (no Date.now() inside
  // lib/pokemon-ops). Broadcast is a tiny summary; the recommendations
  // themselves live in pk_recommendations (UI / alerts read the table).
  const hub = getHub();
  const { runRules } = await import("@/lib/pokemon-ops/rules");
  const { listOpenRecommendations } = await import("@/lib/pokemon-ops/db");
  const result = runRules(nowIso());
  hub.broadcast("pokemon_ops_rules", {
    ...result,
    open: listOpenRecommendations().length,
    lastRunAt: nowIso(),
  });
}

async function tickPokemonOps() {
  // Dashboard snapshot broadcast for the /pokemon-ops tab's 'pokemon_ops'
  // channel. The snapshot is built server-side (lib/pokemon-ops/snapshot.ts)
  // from the metrics layer — panels never compute business math client-side.
  const hub = getHub();
  const { pokemonOpsSnapshot } = await import("@/lib/pokemon-ops/snapshot");
  hub.broadcast("pokemon_ops", pokemonOpsSnapshot(nowIso()));
}

async function tickKanban() {
  // Shared Hermes Kanban board. Read-only dashboard mirror: task writes remain in Hermes
  // (`hermes kanban ...` / /kanban) so Rathworkspace cannot drift into a second source of truth.
  const hub = getHub();
  hub.broadcast("kanban", kanbanSnapshot());
}

async function tickCareer() {
  const { careerSnapshot } = await import("@/lib/career");
  getHub().broadcast("career", careerSnapshot());
}

async function tickCareerEmail() {
  const { runCareerEmailSync } = await import("@/lib/career-scout");
  await runCareerEmailSync();
  await tickCareer();
}

async function tickCareerHunter() {
  const { runCareerOpportunityHunter } = await import("@/lib/career-scout");
  await runCareerOpportunityHunter();
  await tickCareer();
}

async function tickStern() {
  // One guarded Stern tick owns deadline automation and live snapshots. No panel polls.
  const { markMissedPrograms } = await import("@/lib/stern/recruiting");
  markMissedPrograms();
  const { broadcastStern } = await import("@/lib/stern/snapshot");
  broadcastStern();
}

async function tickSternEmail() {
  const { runSternEmailScan } = await import("@/lib/stern/gmail-scan");
  await runSternEmailScan();
  await tickStern();
}
async function tickSternCalendar() {
  const { runSternCalendarSync } = await import("@/lib/stern/calendar-sync");
  await runSternCalendarSync();
  await tickStern();
}

export async function tickSternReminders() {
  const { evaluateRules, dispatchDue } = await import("@/lib/stern/reminders");
  const { automationJob } = await import("@/lib/stern/automation-source");
  const { reminderMeta } = await import("@/lib/stern/reminder-store");
  await automationJob(async () => { const now = new Date(), audit = reminderMeta(); evaluateRules(now, { audit }); await dispatchDue(now, { audit }); });
  const { broadcastStern } = await import("@/lib/stern/snapshot");
  broadcastStern();
}
export async function tickSternMemo() {
  const { tickMemo } = await import("@/lib/stern/memo");
  const { automationJob } = await import("@/lib/stern/automation-source");
  await automationJob(async () => { await tickMemo(); });
  const { broadcastStern } = await import("@/lib/stern/snapshot");
  broadcastStern();
}

export function guarded(name: string, fn: () => Promise<void>) {
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
  const kanban = guarded("kanban", tickKanban);
  const pokemonOpsRules = guarded("pokemonOpsRules", tickPokemonOpsRules);
  const pokemonOps = guarded("pokemonOps", tickPokemonOps);
  const career = guarded("career", tickCareer);
  const careerEmail = guarded("careerEmail", tickCareerEmail);
  const careerHunter = guarded("careerHunter", tickCareerHunter);
  const stern = guarded("stern", tickStern);
  const sternEmail = guarded("sternEmail", tickSternEmail);
  const sternCalendar = guarded("sternCalendar", tickSternCalendar);
  const sternReminders = guarded("sternReminders", tickSternReminders);
  const sternMemo = guarded("sternMemo", tickSternMemo);

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
  kanban();
  pokemonOpsRules();
  pokemonOps();
  career();
  careerEmail();
  stern();
  sternEmail();
  sternCalendar();
  sternReminders();
  sternMemo();

  // retain handles so the scheduler can be stopped/reset cleanly
  g.__rw_timers = [
    setInterval(agents, 6000),
    setInterval(connections, 30000),
    setInterval(projects, 60000),
    setInterval(email, 60000),
    setInterval(calendar, 120000),
    setInterval(health, 30 * 60 * 1000), // bounded WHOOP + Hevy read-only polling
    setInterval(vending, 10 * 60 * 1000), // outreach moves slowly; 10 min keeps Gmail load tiny
    setInterval(agentRuns, 5000), // named-agent runs: read SQLite + broadcast, cheap and bounded
    setInterval(kanban, 5000), // Hermes Kanban: read shared board + broadcast, cheap and bounded
    setInterval(pokemonOpsRules, 24 * 60 * 60 * 1000), // pokemon-ops rules: daily cadence (+ boot burst above); on-demand via POST /api/pokemon-ops/rules/run
    setInterval(pokemonOps, 60000), // pokemon-ops dashboard snapshot: cheap read + broadcast, 60s per PHASE-4
    setInterval(career, 15000), // canonical SQLite snapshot; writes also broadcast immediately
    setInterval(careerEmail, 30 * 60 * 1000), // approved Gmail metadata only; review-gated suggestions
    setInterval(careerHunter, 24 * 60 * 60 * 1000), // bounded configurable watchlist fetch
    setInterval(sternReminders, 60_000),
    setInterval(sternMemo, 60_000),
    setInterval(sternEmail, 10 * 60 * 1000),
    setInterval(sternCalendar, 5 * 60 * 1000),
    setInterval(stern, 15000), // Stern tab snapshot: SQL counts + broadcast, cheap and bounded
  ];

  console.log("[scheduler] started");
}
