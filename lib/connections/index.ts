// Connections engine. Seeds rows, runs real health checks on a schedule, derives the
// 3-state per surface, persists to SQLite, and exposes read/toggle/api-key actions.
import { REGISTRY, getDef, type ConnectionDef, type Surface } from "@/lib/connections/registry";
import { all, get, getDb, run, nowIso } from "@/db";
import { bumpSourceGeneration, quarantineImportedRows } from "@/lib/health/source-state";
import { secret, setSecret } from "@/lib/secrets";
export { isConnectionEnabled } from "@/lib/connections/enabled";

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
export async function refreshAll(definitions:ConnectionDef[]=REGISTRY, options: { force?: boolean } = {}): Promise<SurfaceState[]> {
  ensureSeeded();
  const results = await Promise.all(
    definitions.map(async (def) => {
      const enabled = def.surfaces.some((surface) => !!get<{enabled:number}>(
        "SELECT enabled FROM connections WHERE service=? AND surface=?", def.id, surface
      )?.enabled);
      if (!enabled) return { def, res: { ok: false, detail: "disabled by user" }, skipped: true };
      try {
        return { def, res: await def.check(options), skipped: false };
      } catch (e: any) {
        return { def, res: { ok: false, detail: String(e?.message || e) }, skipped: false };
      }
    })
  );

  const ts = nowIso();
  for (const { def, res, skipped } of results) {
    const health: "ok" | "fail" | "unknown" = skipped ? "unknown" : res.ok ? "ok" : "fail";
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
  const row = get<{ health: "ok" | "fail" | "unknown"; enabled: number }>(
    "SELECT health,enabled FROM connections WHERE service=? AND surface=?",
    service,
    surface
  );
  const health = (row?.health ?? "unknown") as "ok" | "fail" | "unknown";
  const state = deriveState(enabled, health);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE connections SET enabled=?, state=?, updated_at=? WHERE service=? AND surface=?")
      .run(enabled ? 1 : 0, state, nowIso(), service, surface);
    if ((service === "whoop" || service === "hevy") && row && enabled !== (row.enabled === 1)) {
      bumpSourceGeneration(db, service);
    }
  }).immediate();
  return getStates();
}

/** API-key paste (e.g. Mercury): write to the secret store server-side, enable, recheck next loop. */
export async function setApiKey(service: string, envKey: string, value: string, options:{definitions?:ConnectionDef[]}={}) {
  const def = getDef(service);
  if (!def) throw new Error("unknown service");
  const normalized=value.trim(),credentialReplaced=service==="hevy"&&secret(envKey)!==normalized;
  setSecret(envKey, normalized);
  const db = getDb();
  db.transaction(() => {
    const ts=nowIso();
    if(service==="hevy"&&credentialReplaced){
      quarantineImportedRows(db,"hevy",ts);bumpSourceGeneration(db,"hevy");
      db.prepare(`UPDATE health_sync_state SET account_identity=NULL,cursor=NULL,last_attempt_at=NULL,last_success_at=NULL,last_error=NULL,
        records_seen=0,records_changed=0,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE source='hevy'`).run(ts);
    }else if(service==="whoop")bumpSourceGeneration(db,service);
    for (const surface of def.surfaces) db.prepare("UPDATE connections SET enabled=1, health='unknown',state='on_broken',detail=?,last_checked=NULL,last_ok_at=NULL,updated_at=? WHERE service=? AND surface=?").run(credentialReplaced?"credential updated; awaiting verification and sync":"credential saved; verifying",ts,service,surface);
  }).immediate();
  return refreshAll(options.definitions??REGISTRY, { force: true });
}

/** Map service -> the env key its API-key paste writes to. */
export const API_KEY_ENV: Record<string, string> = {
  hevy: "HEVY_API_KEY",
  mercury: "MERCURY_API_TOKEN",
  pocket: "POCKET_API_TOKEN",
  granola: "GRANOLA_API_TOKEN",
};
