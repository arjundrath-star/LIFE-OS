// WHOOP v2 integration. Single user (Arjun). OAuth authorization-code flow against
// developer.whoop.com; refresh token stored ENCRYPTED in SQLite (whoop_tokens) and
// ROTATED on every refresh (WHOOP issues a fresh refresh_token each time). Read-only:
// recovery / sleep / strain pulled into whoop_daily. Server-only — never import client-side.
//
// Endpoints + scopes verified against developer.whoop.com (API v2, 2026-06):
//   auth  : https://api.prod.whoop.com/oauth/oauth2/auth
//   token : https://api.prod.whoop.com/oauth/oauth2/token
//   api   : https://api.prod.whoop.com/developer/v2
import { requireSecret, hasSecret } from "@/lib/secrets";
import { encrypt, decrypt } from "@/lib/crypto";
import { all, get, run, nowIso } from "@/db";

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer/v2";

// `offline` is required to receive a refresh token. The six read scopes match the
// metric slots the Health panel fills (recovery, cycle/strain, sleep, profile).
const SCOPES = [
  "offline",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:body_measurement",
].join(" ");

export function configured(): boolean {
  return hasSecret("WHOOP_CLIENT_ID") && hasSecret("WHOOP_CLIENT_SECRET");
}

export function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}
export function redirectUri(): string {
  // Must match EXACTLY the redirect registered in the WHOOP developer dashboard.
  return `${baseUrl()}/api/whoop/callback`;
}

// ---- OAuth flow ----
export function connectUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: requireSecret("WHOOP_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    state, // WHOOP requires a self-generated state of >= 8 chars
  });
  return `${AUTH_URL}?${p.toString()}`;
}

type TokenResp = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResp> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`whoop token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function exchangeCode(code: string): Promise<TokenResp> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: requireSecret("WHOOP_CLIENT_ID"),
    client_secret: requireSecret("WHOOP_CLIENT_SECRET"),
    redirect_uri: redirectUri(),
  });
}

type BasicProfile = { user_id: number; email: string; first_name?: string; last_name?: string };

async function basicProfile(accessToken: string): Promise<BasicProfile> {
  const res = await fetch(`${API}/user/profile/basic`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`whoop profile ${res.status}`);
  return res.json();
}

/** Complete the connect flow: store the account + encrypted (rotating) refresh token. */
export async function handleCallback(code: string): Promise<{ name: string }> {
  const tok = await exchangeCode(code);
  if (!tok.refresh_token) {
    throw new Error("no refresh_token returned — the 'offline' scope must be granted");
  }
  const profile = await basicProfile(tok.access_token);
  run(
    `INSERT INTO whoop_tokens (user_id, email, first_name, last_name, refresh_token_enc, scopes, enabled, last_error, last_sync, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email, first_name=excluded.first_name, last_name=excluded.last_name,
       refresh_token_enc=excluded.refresh_token_enc, scopes=excluded.scopes,
       enabled=1, last_error=NULL`,
    profile.user_id,
    profile.email ?? null,
    profile.first_name ?? null,
    profile.last_name ?? null,
    encrypt(tok.refresh_token),
    tok.scope ?? SCOPES,
    nowIso()
  );
  // seed the access-token cache so the first poll doesn't immediately re-refresh
  cache().set("token", { token: tok.access_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return { name: profile.first_name || profile.email || "WHOOP" };
}

// ---- access token (in-memory cache + rotating-refresh) ----
const g = globalThis as any;
function cache(): Map<string, { token: string; exp: number }> {
  if (!g.__rw_whoop_tok) g.__rw_whoop_tok = new Map();
  return g.__rw_whoop_tok;
}

function account(): { user_id: number; refresh_token_enc: string | null } | undefined {
  return get("SELECT user_id, refresh_token_enc FROM whoop_tokens WHERE enabled=1 LIMIT 1");
}

export function isConnected(): boolean {
  const a = account();
  return !!a?.refresh_token_enc;
}

async function accessToken(): Promise<string | null> {
  const c = cache();
  const hit = c.get("token");
  if (hit && hit.exp > Date.now() + 30000) return hit.token;
  // Single-flight: WHOOP rotates (invalidates) the refresh token on every use, so two
  // concurrent refreshes — e.g. the 15-min health tick and the 30-sec connections tick
  // firing in the same instant after a restart — would consume the same token and one
  // would spuriously report "token expired", flickering the panel to broken. Coalesce all
  // concurrent callers onto one shared promise (on globalThis so every module instance,
  // tsx server + each route bundle, shares it).
  if (g.__rw_whoop_refreshing) return g.__rw_whoop_refreshing as Promise<string | null>;
  const p = refreshToken().finally(() => {
    g.__rw_whoop_refreshing = null;
  });
  g.__rw_whoop_refreshing = p;
  return p;
}

async function refreshToken(): Promise<string | null> {
  const c = cache();
  // A refresh that completed while we were queued may already have populated the cache.
  const hit = c.get("token");
  if (hit && hit.exp > Date.now() + 30000) return hit.token;

  const acct = account();
  if (!acct?.refresh_token_enc) return null;
  let refresh: string;
  try {
    refresh = decrypt(acct.refresh_token_enc);
  } catch {
    return null;
  }
  let tok: TokenResp;
  try {
    // `scope: offline` on refresh keeps WHOOP returning a fresh refresh_token to rotate in.
    tok = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: requireSecret("WHOOP_CLIENT_ID"),
      client_secret: requireSecret("WHOOP_CLIENT_SECRET"),
      scope: "offline",
    });
  } catch (e: any) {
    run("UPDATE whoop_tokens SET last_error=? WHERE user_id=?", `refresh failed: ${String(e?.message || e).slice(0, 160)}`, acct.user_id);
    return null;
  }
  // WHOOP rotates the refresh token — persist the new one or the next refresh fails.
  if (tok.refresh_token) {
    run("UPDATE whoop_tokens SET refresh_token_enc=?, last_error=NULL WHERE user_id=?", encrypt(tok.refresh_token), acct.user_id);
  }
  const exp = Date.now() + (tok.expires_in ?? 3600) * 1000;
  c.set("token", { token: tok.access_token, exp });
  return tok.access_token;
}

// ---- health check (cheapest authed call) ----
export type HealthResult = { ok: boolean; detail: string };
export async function healthCheck(): Promise<HealthResult> {
  if (!configured()) return { ok: false, detail: "developer app not created" };
  if (!isConnected()) return { ok: false, detail: "configured, not yet authorized" };
  const token = await accessToken();
  if (!token) return { ok: false, detail: "token expired — reconnect" };
  try {
    const p = await basicProfile(token);
    const who = p.first_name || p.email || `user ${p.user_id}`;
    run("UPDATE whoop_tokens SET last_error=NULL WHERE user_id=?", p.user_id);
    return { ok: true, detail: `connected · ${who}` };
  } catch (e: any) {
    return { ok: false, detail: `api error: ${String(e?.message || e).slice(0, 80)}` };
  }
}

// ---- data poll into whoop_daily ----
async function getJson(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`whoop ${res.status} ${path}`);
  return res.json();
}

const dayKey = (iso: string | undefined): string | null => (iso ? iso.slice(0, 10) : null);

/**
 * Pull recent cycles + recoveries + sleeps and upsert one row per WHOOP physiological
 * day into whoop_daily. Days are anchored to cycle.start (WHOOP's own day boundary), so
 * recovery and its source sleep land on the same row. Only real, scored values are written.
 */
export async function pollWhoop(): Promise<void> {
  const acct = account();
  if (!acct?.refresh_token_enc) return;
  const token = await accessToken();
  if (!token) {
    run("UPDATE whoop_tokens SET last_error=COALESCE(last_error,'auth failed') WHERE user_id=?", acct.user_id);
    return;
  }
  try {
    const [cycles, recoveries, sleeps] = await Promise.all([
      getJson(token, "/cycle?limit=15"),
      getJson(token, "/recovery?limit=15"),
      getJson(token, "/activity/sleep?limit=15"),
    ]);

    // cycle id -> { day, strain }
    const cycleById = new Map<number, { day: string | null; strain: number | null }>();
    for (const c of cycles.records ?? []) {
      cycleById.set(c.id, { day: dayKey(c.start), strain: c.score?.strain ?? null });
    }
    // sleep id -> { hours, performance } (asleep = in_bed - awake)
    const sleepById = new Map<string, { hours: number | null; perf: number | null }>();
    for (const s of sleeps.records ?? []) {
      const ss = s.score?.stage_summary;
      const asleepMs =
        ss && ss.total_in_bed_time_milli != null
          ? ss.total_in_bed_time_milli - (ss.total_awake_time_milli ?? 0)
          : null;
      sleepById.set(s.id, {
        hours: asleepMs != null ? +(asleepMs / 3_600_000).toFixed(2) : null,
        perf: s.score?.sleep_performance_percentage ?? null,
      });
    }

    // day -> merged metrics
    type Row = { recovery: number | null; hrv: number | null; rhr: number | null; sleepHours: number | null; sleepPerf: number | null; strain: number | null };
    const byDay = new Map<string, Row>();
    const ensure = (day: string): Row => {
      let r = byDay.get(day);
      if (!r) {
        r = { recovery: null, hrv: null, rhr: null, sleepHours: null, sleepPerf: null, strain: null };
        byDay.set(day, r);
      }
      return r;
    };

    // strain from cycles
    for (const [, c] of cycleById) {
      if (c.day) ensure(c.day).strain = c.strain;
    }
    // recovery (+ its sleep) keyed to the cycle's day
    for (const rec of recoveries.records ?? []) {
      const cyc = cycleById.get(rec.cycle_id);
      const day = cyc?.day ?? dayKey(rec.created_at);
      if (!day) continue;
      const row = ensure(day);
      row.recovery = rec.score?.recovery_score ?? row.recovery;
      row.hrv = rec.score?.hrv_rmssd_milli ?? row.hrv;
      row.rhr = rec.score?.resting_heart_rate ?? row.rhr;
      const sleep = rec.sleep_id ? sleepById.get(rec.sleep_id) : undefined;
      if (sleep) {
        row.sleepHours = sleep.hours ?? row.sleepHours;
        row.sleepPerf = sleep.perf ?? row.sleepPerf;
      }
    }

    for (const [day, r] of byDay) {
      run(
        `INSERT INTO whoop_daily (day, recovery, hrv_ms, rhr_bpm, sleep_hours, sleep_performance, strain, raw, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(day) DO UPDATE SET
           recovery=COALESCE(excluded.recovery, whoop_daily.recovery),
           hrv_ms=COALESCE(excluded.hrv_ms, whoop_daily.hrv_ms),
           rhr_bpm=COALESCE(excluded.rhr_bpm, whoop_daily.rhr_bpm),
           sleep_hours=COALESCE(excluded.sleep_hours, whoop_daily.sleep_hours),
           sleep_performance=COALESCE(excluded.sleep_performance, whoop_daily.sleep_performance),
           strain=COALESCE(excluded.strain, whoop_daily.strain),
           ts=excluded.ts`,
        day,
        r.recovery,
        r.hrv,
        r.rhr,
        r.sleepHours,
        r.sleepPerf,
        r.strain,
        nowIso()
      );
    }
    run("UPDATE whoop_tokens SET last_sync=?, last_error=NULL WHERE user_id=?", nowIso(), acct.user_id);
  } catch (e: any) {
    run("UPDATE whoop_tokens SET last_error=? WHERE user_id=?", String(e?.message || e).slice(0, 200), acct.user_id);
  }
}

// ---- snapshot for the Health panel (reads DB only; never fabricates) ----
export type HealthSnapshot = {
  connected: boolean;
  athlete: string | null;
  lastSync: string | null;
  lastError: string | null;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  sleepHours: number | null;
  sleepPerformance: number | null;
  strain: number | null;
  asOf: string | null;
  history: { day: string; recovery: number | null; sleepHours: number | null; strain: number | null }[];
};

// latest non-null value for one column (today may have strain but no recovery yet)
function latest(col: string): any {
  return get<any>(`SELECT day, ${col} v FROM whoop_daily WHERE ${col} IS NOT NULL ORDER BY day DESC LIMIT 1`)?.v ?? null;
}

export function healthSnapshot(): HealthSnapshot {
  const acct = get<any>("SELECT user_id, first_name, email, last_sync, last_error FROM whoop_tokens WHERE enabled=1 LIMIT 1");
  const connected = !!acct;
  const history = all<any>(
    "SELECT day, recovery, sleep_hours sleepHours, strain FROM whoop_daily ORDER BY day DESC LIMIT 7"
  ).reverse();
  const asOf = get<any>("SELECT day FROM whoop_daily ORDER BY day DESC LIMIT 1")?.day ?? null;
  return {
    connected,
    athlete: acct?.first_name ?? null,
    lastSync: acct?.last_sync ?? null,
    lastError: acct?.last_error ?? null,
    recovery: connected ? latest("recovery") : null,
    hrv: connected ? latest("hrv_ms") : null,
    rhr: connected ? latest("rhr_bpm") : null,
    sleepHours: connected ? latest("sleep_hours") : null,
    sleepPerformance: connected ? latest("sleep_performance") : null,
    strain: connected ? latest("strain") : null,
    asOf,
    history,
  };
}

export function disconnect(): void {
  run("DELETE FROM whoop_tokens");
  cache().delete("token");
}
