// Connections engine. Seeds rows, runs real health checks on a schedule, derives the
// 3-state per surface, persists to SQLite, and exposes read/toggle/api-key actions.
import { REGISTRY, getDef, type Surface } from "@/lib/connections/registry";
import { all, get, run, nowIso } from "@/db";
import { setSecret } from "@/lib/secrets";

export type ConnState = "on_healthy" | "on_broken" | "off";

export type SurfaceState = {
  service: string;
  label: string;
  surface: Surface;
  state: ConnState;
  enabled: boolean;
  health: "ok" | "fail" | "unknown";
  detail: string | null;
  reconnect: string;
  note?: string;
  lastOkAt: string | null;
  lastChecked: string | null;
  configured: boolean;
};

function deriveState(enabled: boolean, health: "ok" | "fail" | "unknown"): ConnState {
  if (!enabled) return "off";
  return health === "ok" ? "on_healthy" : "on_broken";
}

/** Create a row per (service, surface) the first time, preserving user intent thereafter. */
export function ensureSeeded() {
  for (const def of REGISTRY) {
    for (const surface of def.surfaces) {
      const existing = get("SELECT service FROM connections WHERE service=? AND surface=?", def.id, surface);
      if (!existing) {
        run(
          `INSERT INTO connections (service, surface, enabled, health, state, detail, updated_at)
           VALUES (?, ?, ?, 'unknown', ?, ?, ?)`,
          def.id,
          surface,
          def.defaultEnabled ? 1 : 0,
          def.defaultEnabled ? "on_broken" : "off",
          "not yet checked",
          nowIso()
        );
      }
    }
  }
}

/** Run every health check once and persist resolved states. Returns the new state list. */
export async function refreshAll(): Promise<SurfaceState[]> {
  ensureSeeded();
  const results = await Promise.all(
    REGISTRY.map(async (def) => {
      try {
        return { def, res: await def.check() };
      } catch (e: any) {
        return { def, res: { ok: false, detail: String(e?.message || e) } };
      }
    })
  );

  const ts = nowIso();
  for (const { def, res } of results) {
    const health: "ok" | "fail" = res.ok ? "ok" : "fail";
    for (const surface of def.surfaces) {
      const row = get<{ enabled: number; last_ok_at: string | null }>(
        "SELECT enabled, last_ok_at FROM connections WHERE service=? AND surface=?",
        def.id,
        surface
      );
      const enabled = row ? !!row.enabled : def.defaultEnabled;
      const state = deriveState(enabled, health);
      run(
        `UPDATE connections SET health=?, state=?, detail=?, last_checked=?,
           last_ok_at=CASE WHEN ?='ok' THEN ? ELSE last_ok_at END, updated_at=?
         WHERE service=? AND surface=?`,
        health,
        state,
        res.detail,
        ts,
        health,
        ts,
        ts,
        def.id,
        surface
      );
    }
  }
  return getStates();
}

export function getStates(): SurfaceState[] {
  const rows = all<any>(
    "SELECT service, surface, enabled, health, state, detail, last_ok_at, last_checked FROM connections ORDER BY service, surface"
  );
  return rows.map((r) => {
    const def = getDef(r.service);
    return {
      service: r.service,
      label: def?.label ?? r.service,
      surface: r.surface as Surface,
      state: r.state as ConnState,
      enabled: !!r.enabled,
      health: r.health,
      detail: r.detail,
      reconnect: def?.reconnect ?? "none",
      note: def?.note,
      lastOkAt: r.last_ok_at,
      lastChecked: r.last_checked,
      configured: def ? def.configured() : false,
    };
  });
}

/** Toggle a connection on/off for a surface, then recompute its state from stored health. */
export function setEnabled(service: string, surface: string, enabled: boolean) {
  const row = get<{ health: "ok" | "fail" | "unknown" }>(
    "SELECT health FROM connections WHERE service=? AND surface=?",
    service,
    surface
  );
  const health = (row?.health ?? "unknown") as "ok" | "fail" | "unknown";
  const state = deriveState(enabled, health);
  run(
    "UPDATE connections SET enabled=?, state=?, updated_at=? WHERE service=? AND surface=?",
    enabled ? 1 : 0,
    state,
    nowIso(),
    service,
    surface
  );
  return getStates();
}

/** API-key paste (e.g. Mercury): write to the secret store server-side, enable, recheck next loop. */
export async function setApiKey(service: string, envKey: string, value: string) {
  const def = getDef(service);
  if (!def) throw new Error("unknown service");
  setSecret(envKey, value.trim());
  // enable on all its surfaces
  for (const surface of def.surfaces) {
    run("UPDATE connections SET enabled=1, updated_at=? WHERE service=? AND surface=?", nowIso(), service, surface);
  }
  return refreshAll();
}

/** Map service -> the env key its API-key paste writes to. */
export const API_KEY_ENV: Record<string, string> = {
  mercury: "MERCURY_API_TOKEN",
};
