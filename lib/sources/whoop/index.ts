// WHOOP v2 integration. Single user. OAuth authorization-code flow against
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
import { all, get, getDb, nowIso } from "@/db";
import { isConnectionEnabled } from "@/lib/connections/enabled";
import { sanitizeWhoopDataError } from "@/lib/health/whoop-errors";
import {
  acquireSourceLease,
  ensureSourceState,
  quarantineImportedRows,
  releaseSourceLease,
  sourceCommitStillCurrent,
  sourceIdentity,
  sourceLeaseStillCurrent,
} from "@/lib/health/source-state";

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer/v2";
const DEFAULT_TIMEOUT_MS = 12_000;
type Requester = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function boundedRequest(request:Requester,input:RequestInfo|URL,init:RequestInit={},timeoutMs=DEFAULT_TIMEOUT_MS):Promise<Response>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await request(input,{...init,signal:controller.signal})}
  catch(error){if(controller.signal.aborted)throw new Error(`WHOOP request timed out after ${timeoutMs}ms`);throw error}
  finally{clearTimeout(timer)}
}

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

async function tokenRequest(body: Record<string, string>, request:Requester=fetch, timeoutMs=DEFAULT_TIMEOUT_MS): Promise<TokenResp> {
  const res = await boundedRequest(request, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  }, timeoutMs);
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 || res.status === 403 ? "WHOOP_TOKEN_REJECTED" : "WHOOP_TOKEN_UPSTREAM_ERROR");
  try { return await res.json(); } catch { throw new Error("WHOOP_TOKEN_MALFORMED_RESPONSE"); }
}

async function exchangeCode(code: string, request:Requester=fetch, timeoutMs=DEFAULT_TIMEOUT_MS): Promise<TokenResp> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: requireSecret("WHOOP_CLIENT_ID"),
    client_secret: requireSecret("WHOOP_CLIENT_SECRET"),
    redirect_uri: redirectUri(),
  }, request, timeoutMs);
}

type BasicProfile = { user_id: number; email: string; first_name?: string; last_name?: string };

async function basicProfile(accessToken: string, request:Requester=fetch, timeoutMs=DEFAULT_TIMEOUT_MS): Promise<BasicProfile> {
  const res = await boundedRequest(request, `${API}/user/profile/basic`, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, timeoutMs);
  if (!res.ok) throw new Error(`whoop profile ${res.status}`);
  try { return await res.json(); } catch { throw new Error("WHOOP_PROFILE_MALFORMED_RESPONSE"); }
}

/** Complete the connect flow: store the single active account + encrypted refresh token. */
export async function handleCallback(code: string, options:{request?:Requester;timeoutMs?:number}={}): Promise<{ name: string }> {
  const request=options.request ?? fetch;const timeoutMs=options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tok = await exchangeCode(code,request,timeoutMs);
  if (!tok.refresh_token) {
    throw new Error("no refresh_token returned — the 'offline' scope must be granted");
  }
  const callbackRefreshToken=tok.refresh_token;
  const profile = await basicProfile(tok.access_token,request,timeoutMs);
  if (!Number.isInteger(profile.user_id) || profile.user_id <= 0) throw new Error("WHOOP_PROFILE_INVALID");
  const accountIdentity = sourceIdentity("whoop-account", profile.user_id);
  const db=getDb();
  db.transaction(()=>{
    const state = ensureSourceState(db, "whoop");
    db.prepare("UPDATE whoop_tokens SET enabled=0,refresh_token_enc=NULL WHERE refresh_token_enc IS NOT NULL OR enabled=1").run();
    if (state.accountIdentity && state.accountIdentity !== accountIdentity) {
      quarantineImportedRows(db, "whoop", nowIso(), { accountIdentity: state.accountIdentity, reason: "account_replaced" });
    }
    db.prepare(`UPDATE health_sync_state SET account_identity=?,generation=generation+1,cursor=NULL,last_attempt_at=NULL,last_success_at=NULL,last_error=NULL,records_seen=0,records_changed=0,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE source='whoop'`).run(accountIdentity, nowIso());
    db.prepare(`INSERT INTO whoop_tokens (user_id, email, first_name, last_name, refresh_token_enc, scopes, enabled, last_error, last_sync, connected_at, auth_error, auth_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email=excluded.email, first_name=excluded.first_name, last_name=excluded.last_name,
         refresh_token_enc=excluded.refresh_token_enc, scopes=excluded.scopes,
         enabled=1, last_error=NULL, last_sync=NULL, connected_at=excluded.connected_at,
         auth_error=NULL,auth_checked_at=excluded.auth_checked_at`).run(
      profile.user_id,profile.email ?? null,profile.first_name ?? null,profile.last_name ?? null,
      encrypt(callbackRefreshToken),tok.scope ?? SCOPES,nowIso(),nowIso()
    );
  }).immediate();
  cache().clear();refreshing().clear();
  cache().set(String(profile.user_id), { token: tok.access_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return { name: profile.first_name || profile.email || "WHOOP" };
}

// ---- access token (in-memory cache + rotating-refresh) ----
const g = globalThis as any;
type Account={user_id:number;refresh_token_enc:string|null;accountIdentity:string;generation:number};
function cache(): Map<string, { token: string; exp: number }> {
  if (!g.__rw_whoop_tok) g.__rw_whoop_tok = new Map();
  return g.__rw_whoop_tok;
}
function refreshing():Map<string,Promise<string|null>>{
  if(!g.__rw_whoop_refreshing_by_user)g.__rw_whoop_refreshing_by_user=new Map();
  return g.__rw_whoop_refreshing_by_user;
}
function account(): Account | undefined {
  const token = get<{user_id:number;refresh_token_enc:string|null}>("SELECT user_id, refresh_token_enc FROM whoop_tokens WHERE enabled=1 ORDER BY connected_at DESC,user_id DESC LIMIT 1");
  if (!token) return undefined;
  const accountIdentity = sourceIdentity("whoop-account", token.user_id); const db = getDb(); let generation = 0;
  db.transaction(() => {
    const state = ensureSourceState(db, "whoop");
    if (!state.accountIdentity) db.prepare("UPDATE health_sync_state SET account_identity=?,generation=generation+1,updated_at=? WHERE source='whoop'").run(accountIdentity, nowIso());
    generation = Number((db.prepare("SELECT generation FROM health_sync_state WHERE source='whoop'").get() as any).generation);
  }).immediate();
  return {...token,accountIdentity,generation};
}
function accountStillCurrent(db:ReturnType<typeof getDb>,acct:Account):boolean{
  const enabled=(db.prepare("SELECT enabled FROM connections WHERE service='whoop' AND surface='dashboard'").get() as any)?.enabled===1;
  const active=(db.prepare("SELECT user_id FROM whoop_tokens WHERE enabled=1 ORDER BY connected_at DESC,user_id DESC LIMIT 1").get() as any)?.user_id;
  return active===acct.user_id&&sourceCommitStillCurrent(db,"whoop",acct.generation,acct.accountIdentity,enabled);
}
export function isConnected(): boolean {return !!account()?.refresh_token_enc}
export const isAuthorized = isConnected;

async function accessToken(acct:Account=account() as Account,request:Requester=fetch,timeoutMs=DEFAULT_TIMEOUT_MS): Promise<string | null> {
  if(!acct?.refresh_token_enc)return null;
  const key=String(acct.user_id);const c=cache();const hit=c.get(key);
  if(hit&&hit.exp>Date.now()+30000)return hit.token;
  const inflight=refreshing().get(key);if(inflight)return inflight;
  const promise=refreshToken(acct,request,timeoutMs).finally(()=>refreshing().delete(key));
  refreshing().set(key,promise);return promise;
}

async function refreshToken(acct:Account,request:Requester,timeoutMs:number): Promise<string | null> {
  const key=String(acct.user_id);const hit=cache().get(key);
  if(hit&&hit.exp>Date.now()+30000)return hit.token;
  if(!acct.refresh_token_enc)return null;
  let refresh:string;try{refresh=decrypt(acct.refresh_token_enc)}catch{return null}
  let tok:TokenResp;
  try{
    tok=await tokenRequest({grant_type:"refresh_token",refresh_token:refresh,client_id:requireSecret("WHOOP_CLIENT_ID"),client_secret:requireSecret("WHOOP_CLIENT_SECRET"),scope:"offline"},request,timeoutMs);
  }catch{const db=getDb();db.transaction(()=>{if(accountStillCurrent(db,acct))db.prepare("UPDATE whoop_tokens SET auth_error=?,auth_checked_at=? WHERE user_id=? AND enabled=1").run("WHOOP_AUTH_REFRESH_FAILED",nowIso(),acct.user_id)})();return null}
  const db=getDb();let updated=0;
  db.transaction(()=>{
    if(!accountStillCurrent(db,acct))return;
    if(tok.refresh_token){updated=db.prepare("UPDATE whoop_tokens SET refresh_token_enc=?,auth_error=NULL,auth_checked_at=? WHERE user_id=? AND enabled=1 AND refresh_token_enc=?").run(encrypt(tok.refresh_token),nowIso(),acct.user_id,acct.refresh_token_enc).changes}
    else{updated=db.prepare("UPDATE whoop_tokens SET auth_error=NULL,auth_checked_at=? WHERE user_id=? AND enabled=1 AND refresh_token_enc=?").run(nowIso(),acct.user_id,acct.refresh_token_enc).changes}
  }).immediate();
  if(updated!==1)return null;
  cache().set(key,{token:tok.access_token,exp:Date.now()+(tok.expires_in??3600)*1000});
  return tok.access_token;
}

// ---- health check (cheapest authed call) ----
export type HealthResult = { ok: boolean; detail: string };
export async function healthCheck(options:{request?:Requester;timeoutMs?:number}={}): Promise<HealthResult> {
  if(!isConnectionEnabled("whoop"))return {ok:false,detail:"disabled by user"};
  if(!configured())return {ok:false,detail:"developer app not created"};
  const acct=account();if(!acct?.refresh_token_enc)return {ok:false,detail:"configured, not yet authorized"};
  const request=options.request??fetch;const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;
  const token=await accessToken(acct,request,timeoutMs);if(!token)return {ok:false,detail:"token expired — reconnect"};
  try{
    const p=await basicProfile(token,request,timeoutMs);
    if(p.user_id!==acct.user_id)throw new Error("authorized profile does not match active WHOOP account");
    if(!accountStillCurrent(getDb(),acct))return {ok:false,detail:"WHOOP_AUTH_SESSION_CHANGED"};
    const db=getDb();db.transaction(()=>{if(accountStillCurrent(db,acct))db.prepare("UPDATE whoop_tokens SET auth_error=NULL,auth_checked_at=? WHERE user_id=? AND enabled=1").run(nowIso(),acct.user_id)})();
    return {ok:true,detail:"WHOOP authorization verified"};
  }catch{const detail="WHOOP_AUTH_PROFILE_CHECK_FAILED";const db=getDb();db.transaction(()=>{if(accountStillCurrent(db,acct))db.prepare("UPDATE whoop_tokens SET auth_error=?,auth_checked_at=? WHERE user_id=? AND enabled=1").run(detail,nowIso(),acct.user_id)})();return {ok:false,detail}}
}

// ---- data poll into whoop_daily ----
async function getJson(token:string,path:string,request:Requester=fetch,timeoutMs=DEFAULT_TIMEOUT_MS):Promise<any>{
  const res=await boundedRequest(request,`${API}${path}`,{headers:{authorization:`Bearer ${token}`}},timeoutMs);
  if(!res.ok)throw new Error(`whoop ${res.status} ${path}`);return res.json();
}
export async function getWhoopPages(token:string,path:string,maxPages=6,options:{request?:Requester;timeoutMs?:number}={}):Promise<{records:any[];pages:number}>{
  const request=options.request??fetch;const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;const records:any[]=[];let nextToken:string|null=null;let pages=0;
  do{
    const url=new URL(`${API}${path}`);if(nextToken)url.searchParams.set("nextToken",nextToken);
    const res=await boundedRequest(request,url,{headers:{authorization:`Bearer ${token}`}},timeoutMs);
    if(!res.ok)throw new Error(`whoop ${res.status} ${url.pathname}`);
    const payload=await res.json();if(!payload||!Array.isArray(payload.records))throw new Error(`whoop schema ${url.pathname}: records missing`);
    records.push(...payload.records);nextToken=payload.next_token??payload.nextToken??null;pages+=1;
  }while(nextToken&&pages<maxPages);
  if(nextToken)throw new Error(`whoop pagination exceeded page safety limit for ${new URL(`${API}${path}`).pathname}`);
  return {records,pages};
}

const WHOOP_TIMESTAMP_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function dayKey(value:unknown):string|null{
  if(typeof value!=="string"||!WHOOP_TIMESTAMP_RE.test(value)||!Number.isFinite(Date.parse(value)))return null;
  const day=value.slice(0,10),parsed=new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:null;
}
function sourceTime(...values:unknown[]):string|null{for(const value of values){if(typeof value!=="string")continue;const ms=Date.parse(value);if(Number.isFinite(ms))return new Date(ms).toISOString()}return null}
function incomingNotOlder(incoming:string|null,stored:string|null|undefined):boolean{return !stored?true:!!incoming&&incoming>=stored}

/**
 * Pull recent cycles + recoveries + sleeps and upsert one row per WHOOP physiological
 * day into whoop_daily. Days are anchored to cycle.start (WHOOP's own day boundary), so
 * recovery and its source sleep land on the same row. Only real, scored values are written.
 */
export async function pollWhoop(options:{request?:Requester;timeoutMs?:number;leaseTtlMs?:number;now?:()=>string}={}): Promise<{status:"healthy"|"degraded"|"disconnected";detail:string}> {
  if(!isConnectionEnabled("whoop"))return {status:"disconnected",detail:"WHOOP is disabled in Connections"};
  const acct = account();
  if (!acct?.refresh_token_enc) return {status:"disconnected",detail:"WHOOP is not authorized"};
  const request=options.request??fetch;const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;const clock=options.now??nowIso;const runStartedAt=clock();
  const lease=acquireSourceLease(getDb(),"whoop",{now:runStartedAt,ttlMs:options.leaseTtlMs});
  if(!lease)return {status:"degraded",detail:"WHOOP sync already in progress"};
  try {
    const token = await accessToken(acct,request,timeoutMs);
    if (!token) {
      const db=getDb();db.transaction(()=>{if(accountStillCurrent(db,acct)&&sourceLeaseStillCurrent(db,"whoop",lease,clock()))db.prepare("UPDATE whoop_tokens SET auth_error=COALESCE(auth_error,'WHOOP_AUTH_FAILED'),auth_checked_at=? WHERE user_id=? AND enabled=1").run(clock(),acct.user_id)})();
      return {status:"degraded",detail:"WHOOP authorization failed"};
    }
    const labels=["cycles","recoveries","sleep","workouts","body"];
    const settled=await Promise.allSettled([
      getWhoopPages(token,"/cycle?limit=25",6,{request,timeoutMs}),
      getWhoopPages(token,"/recovery?limit=25",6,{request,timeoutMs}),
      getWhoopPages(token,"/activity/sleep?limit=25",6,{request,timeoutMs}),
      getWhoopPages(token,"/activity/workout?limit=25",6,{request,timeoutMs}),
      getJson(token,"/user/measurement/body",request,timeoutMs),
    ]);
    const failures=settled.flatMap((entry,index)=>entry.status==="rejected"?[labels[index]]:[]);
    const page=(index:number)=>settled[index].status==="fulfilled"?(settled[index] as PromiseFulfilledResult<any>).value:{records:[],pages:0};
    const cycles=page(0),recoveries=page(1),sleeps=page(2),workouts=page(3);
    const body=settled[4].status==="fulfilled"?settled[4].value:null;
    // cycle id -> day-level strain/energy provenance
    const cycleById = new Map<number, { day: string | null; strain: number | null; energyKj:number|null; updatedAt:string|null; present:Set<string> }>();
    for (const c of cycles.records ?? []) {
      const present=new Set<string>();if(c.score&&Object.hasOwn(c.score,"strain"))present.add("strain");if(c.score&&Object.hasOwn(c.score,"kilojoule"))present.add("energyKj");
      cycleById.set(c.id, { day: dayKey(c.start), strain: c.score?.strain ?? null, energyKj:c.score?.kilojoule ?? null, updatedAt:sourceTime(c.updated_at,c.end,c.start),present });
    }
    // sleep id -> scored sleep details (asleep = in_bed - awake)
    const sleepById = new Map<string, { hours:number|null; perf:number|null; efficiency:number|null; consistency:number|null; needHours:number|null; updatedAt:string|null; cycleId:number|null; present:Set<string> }>();
    for (const s of sleeps.records ?? []) {
      const ss = s.score?.stage_summary;
      const asleepMs =
        ss && ss.total_in_bed_time_milli != null
          ? ss.total_in_bed_time_milli - (ss.total_awake_time_milli ?? 0)
          : null;
      const needed=s.score?.sleep_needed;
      const needMs=needed ? (needed.baseline_milli ?? 0)+(needed.need_from_sleep_debt_milli ?? 0)+(needed.need_from_recent_strain_milli ?? 0)+(needed.need_from_recent_nap_milli ?? 0) : null;
      const present=new Set<string>();if(ss&&(Object.hasOwn(ss,"total_in_bed_time_milli")||Object.hasOwn(ss,"total_awake_time_milli")))present.add("sleepHours");if(s.score&&Object.hasOwn(s.score,"sleep_performance_percentage"))present.add("sleepPerf");if(s.score&&Object.hasOwn(s.score,"sleep_efficiency_percentage"))present.add("sleepEfficiency");if(s.score&&Object.hasOwn(s.score,"sleep_consistency_percentage"))present.add("sleepConsistency");if(s.score&&Object.hasOwn(s.score,"sleep_needed"))present.add("sleepNeedHours");
      sleepById.set(s.id, {
        hours: asleepMs != null ? +(asleepMs / 3_600_000).toFixed(2) : null,
        perf: s.score?.sleep_performance_percentage ?? null,
        efficiency:s.score?.sleep_efficiency_percentage ?? null,
        consistency:s.score?.sleep_consistency_percentage ?? null,
        needHours:needMs != null ? +(needMs/3_600_000).toFixed(2) : null,
        updatedAt:sourceTime(s.updated_at,s.end,s.start),
        cycleId:s.cycle_id ?? null,
        present,
      });
    }

    // day -> merged metrics
    type Row = { recovery:number|null; hrv:number|null; rhr:number|null; sleepHours:number|null; sleepPerf:number|null; sleepEfficiency:number|null; sleepConsistency:number|null; sleepNeedHours:number|null; strain:number|null; energyKj:number|null; recoveryAt:string|null; sleepAt:string|null; strainAt:string|null; present:Set<string> };
    const byDay = new Map<string, Row>();
    const ensure = (day: string): Row => {
      let r = byDay.get(day);
      if (!r) {
        r = { recovery:null,hrv:null,rhr:null,sleepHours:null,sleepPerf:null,sleepEfficiency:null,sleepConsistency:null,sleepNeedHours:null,strain:null,energyKj:null,recoveryAt:null,sleepAt:null,strainAt:null,present:new Set() };
        byDay.set(day, r);
      }
      return r;
    };

    // strain from cycles
    for (const [, c] of cycleById) {
      if (c.day) { const row=ensure(c.day);if(incomingNotOlder(c.updatedAt,row.strainAt)){if(c.present.has("strain")){row.strain=c.strain;row.present.add("strain")}if(c.present.has("energyKj")){row.energyKj=c.energyKj;row.present.add("energyKj")}if(c.present.size)row.strainAt=c.updatedAt;} }
    }
    // Sleep can exist before recovery is scored. Attach it to its own cycle/day so the UI
    // never hides fresh sleep or presents it under a recovery date from another cycle.
    for (const [,sleep] of sleepById) {
      const cycle=sleep.cycleId != null ? cycleById.get(sleep.cycleId) : undefined;
      const day=cycle?.day;
      if(!day)continue;
      const row=ensure(day);
      if(incomingNotOlder(sleep.updatedAt,row.sleepAt)){if(sleep.present.has("sleepHours")){row.sleepHours=sleep.hours;row.present.add("sleepHours")}if(sleep.present.has("sleepPerf")){row.sleepPerf=sleep.perf;row.present.add("sleepPerf")}if(sleep.present.has("sleepEfficiency")){row.sleepEfficiency=sleep.efficiency;row.present.add("sleepEfficiency")}if(sleep.present.has("sleepConsistency")){row.sleepConsistency=sleep.consistency;row.present.add("sleepConsistency")}if(sleep.present.has("sleepNeedHours")){row.sleepNeedHours=sleep.needHours;row.present.add("sleepNeedHours")}if(sleep.present.size)row.sleepAt=sleep.updatedAt;}
    }
    // Recovery has no trustworthy day bucket until its referenced cycle is available.
    // Do not fall back to created_at: WHOOP can create a recovery on the calendar day
    // after its physiological cycle began, and a later cycle sync would leave two trend days.
    for (const rec of recoveries.records ?? []) {
      const cyc = cycleById.get(rec.cycle_id);
      const day = cyc?.day;
      if (!day) continue;
      const row = ensure(day);
      const recoveryAt=sourceTime(rec.updated_at,rec.created_at);
      if(incomingNotOlder(recoveryAt,row.recoveryAt)){
        if(rec.score&&Object.hasOwn(rec.score,"recovery_score")){row.recovery=rec.score.recovery_score??null;row.present.add("recovery")}
        if(rec.score&&Object.hasOwn(rec.score,"hrv_rmssd_milli")){row.hrv=rec.score.hrv_rmssd_milli??null;row.present.add("hrv")}
        if(rec.score&&Object.hasOwn(rec.score,"resting_heart_rate")){row.rhr=rec.score.resting_heart_rate??null;row.present.add("rhr")}
        if(row.present.has("recovery")||row.present.has("hrv")||row.present.has("rhr"))row.recoveryAt=recoveryAt;
      }
      const sleep = rec.sleep_id ? sleepById.get(rec.sleep_id) : undefined;
      if (sleep&&incomingNotOlder(sleep.updatedAt,row.sleepAt)) {
        if(sleep.present.has("sleepHours")){row.sleepHours=sleep.hours;row.present.add("sleepHours")}
        if(sleep.present.has("sleepPerf")){row.sleepPerf=sleep.perf;row.present.add("sleepPerf")}
        if(sleep.present.has("sleepEfficiency")){row.sleepEfficiency=sleep.efficiency;row.present.add("sleepEfficiency")}
        if(sleep.present.has("sleepConsistency")){row.sleepConsistency=sleep.consistency;row.present.add("sleepConsistency")}
        if(sleep.present.has("sleepNeedHours")){row.sleepNeedHours=sleep.needHours;row.present.add("sleepNeedHours")}
        if(sleep.present.size)row.sleepAt=sleep.updatedAt??row.sleepAt;
      }
    }

    const dataError=failures.length?"WHOOP_DATA_PARTIAL_SYNC":null;
    const db=getDb();
    db.transaction(()=>{
      const enabled=(db.prepare("SELECT enabled FROM connections WHERE service='whoop' AND surface='dashboard'").get() as any)?.enabled===1;
      const active=(db.prepare("SELECT user_id FROM whoop_tokens WHERE enabled=1 ORDER BY connected_at DESC,user_id DESC LIMIT 1").get() as any)?.user_id;
      if(active!==acct.user_id||!sourceLeaseStillCurrent(db,"whoop",lease,clock())||!sourceCommitStillCurrent(db,"whoop",acct.generation,acct.accountIdentity,enabled))throw new Error("WHOOP_DATA_SESSION_CHANGED");
      for (const [day, r] of byDay) {
        const ts=clock();
        const existing=db.prepare("SELECT recovery_updated_at recoveryAt,sleep_updated_at sleepAt,strain_updated_at strainAt FROM whoop_daily WHERE day=?").get(day) as any;
        if(!existing){db.prepare(`INSERT INTO whoop_daily (day,recovery,hrv_ms,rhr_bpm,sleep_hours,sleep_performance,strain,raw,ts,sleep_efficiency,sleep_need_hours,sleep_consistency,cycle_energy_kj,recovery_updated_at,sleep_updated_at,strain_updated_at)
          VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)`).run(day,r.recovery,r.hrv,r.rhr,r.sleepHours,r.sleepPerf,r.strain,ts,r.sleepEfficiency,r.sleepNeedHours,r.sleepConsistency,r.energyKj,r.recoveryAt,r.sleepAt,r.strainAt);continue;}
        const values:Record<string,unknown>={recovery:r.recovery,hrv_ms:r.hrv,rhr_bpm:r.rhr,sleep_hours:r.sleepHours,sleep_performance:r.sleepPerf,sleep_efficiency:r.sleepEfficiency,sleep_need_hours:r.sleepNeedHours,sleep_consistency:r.sleepConsistency,strain:r.strain,cycle_energy_kj:r.energyKj};
        const columns:Record<string,string>={recovery:"recovery",hrv:"hrv_ms",rhr:"rhr_bpm",sleepHours:"sleep_hours",sleepPerf:"sleep_performance",sleepEfficiency:"sleep_efficiency",sleepNeedHours:"sleep_need_hours",sleepConsistency:"sleep_consistency",strain:"strain",energyKj:"cycle_energy_kj"};
        const assignments:string[]=[];const params:unknown[]=[];
        const allowRecovery=incomingNotOlder(r.recoveryAt,existing.recoveryAt),allowSleep=incomingNotOlder(r.sleepAt,existing.sleepAt),allowStrain=incomingNotOlder(r.strainAt,existing.strainAt);
        for(const name of r.present){const column=columns[name];const allowed=name==="recovery"||name==="hrv"||name==="rhr"?allowRecovery:name.startsWith("sleep")?allowSleep:allowStrain;if(column&&allowed){assignments.push(`${column}=?`);params.push(values[column])}}
        if(allowRecovery&&(r.present.has("recovery")||r.present.has("hrv")||r.present.has("rhr"))){assignments.push("recovery_updated_at=?");params.push(r.recoveryAt)}
        if(allowSleep&&[...r.present].some(name=>name.startsWith("sleep"))){assignments.push("sleep_updated_at=?");params.push(r.sleepAt)}
        if(allowStrain&&(r.present.has("strain")||r.present.has("energyKj"))){assignments.push("strain_updated_at=?");params.push(r.strainAt)}
        if(assignments.length){assignments.push("ts=?");params.push(ts);db.prepare(`UPDATE whoop_daily SET ${assignments.join(",")} WHERE day=?`).run(...params,day)}
      }
      for(const workout of workouts.records ?? []){
        const sourceExternalId=String(workout.id ?? ""),startedAt=workout.start;if(!sourceExternalId||!startedAt)continue;
        const endedAt=workout.end ?? null,duration=endedAt?Math.max(0,Math.round((Date.parse(endedAt)-Date.parse(startedAt))/1000)):null,ts=clock(),sourceUpdatedAt=sourceTime(workout.updated_at,workout.end,workout.start);if(!sourceUpdatedAt)continue;
        const storedExternalId=sourceIdentity(`whoop-workout:${acct.accountIdentity}`,sourceExternalId);
        const existing=db.prepare("SELECT id,deleted_at deletedAt,source_updated_at sourceUpdatedAt,source_run_version sourceRunVersion FROM health_workouts WHERE source='whoop' AND source_account_identity=? AND source_external_id=?").get(acct.accountIdentity,sourceExternalId) as any;
        const mayReplace=!existing||incomingNotOlder(sourceUpdatedAt,existing.sourceUpdatedAt)&&(sourceUpdatedAt!==existing.sourceUpdatedAt||lease.runVersion>=Number(existing.sourceRunVersion??0));
        if(existing&&!mayReplace){
          // A current-account provider result proves the quarantined row still exists, but
          // must not let an older payload regress its already-preserved content.
          if(existing.deletedAt)db.prepare("UPDATE health_workouts SET deleted_at=NULL,updated_at=? WHERE id=? AND source_account_identity=?").run(ts,existing.id,acct.accountIdentity);
          continue;
        }
        if(existing){
          db.prepare(`UPDATE health_workouts SET title=?,description='',started_at=?,ended_at=?,duration_seconds=?,strain=?,energy_kj=?,energy_estimated=1,source_account_identity=?,source_external_id=?,source_payload=?,source_updated_at=?,source_run_version=?,deleted_at=NULL,updated_at=? WHERE id=? AND source_account_identity=?`)
            .run(workout.sport_name||`WHOOP activity ${workout.sport_id??""}`.trim(),startedAt,endedAt,duration,workout.score?.strain??null,workout.score?.kilojoule??null,acct.accountIdentity,sourceExternalId,JSON.stringify(workout),sourceUpdatedAt,lease.runVersion,ts,existing.id,acct.accountIdentity);
        }else{
          db.prepare(`INSERT INTO health_workouts (idempotency_key,source,external_id,source_account_identity,source_external_id,title,description,started_at,ended_at,duration_seconds,strain,energy_kj,energy_estimated,source_payload,source_updated_at,source_run_version,deleted_at,created_at,updated_at)
            VALUES (?,'whoop',?,?,?,?,'',?,?,?,?,?,1,?,?,?,NULL,?,?)`)
            .run(`whoop:workout:${storedExternalId}`,storedExternalId,acct.accountIdentity,sourceExternalId,workout.sport_name||`WHOOP activity ${workout.sport_id??""}`.trim(),startedAt,endedAt,duration,workout.score?.strain??null,workout.score?.kilojoule??null,JSON.stringify(workout),sourceUpdatedAt,lease.runVersion,ts,ts);
        }
      }
      if(body?.weight_kilogram!=null){
        const ts=clock(),sourceExternalId="current",storedExternalId=sourceIdentity(`whoop-body:${acct.accountIdentity}`,sourceExternalId);
        const existing=db.prepare("SELECT measured_at,source_run_version sourceRunVersion FROM health_body_measurements WHERE source='whoop' AND source_account_identity=? AND source_external_id=?").get(acct.accountIdentity,sourceExternalId) as any;
        if(!existing||lease.runVersion>=Number(existing.sourceRunVersion??0))db.prepare(`INSERT INTO health_body_measurements (idempotency_key,measured_at,weight_kg,context,estimated,source,external_id,source_account_identity,source_external_id,source_payload,source_updated_at,source_run_version,deleted_at,created_at,updated_at,observation_at_known)
          VALUES (?,?,?,'WHOOP current profile value; observation date unknown',0,'whoop',?,?,?,?,?,?,NULL,?,?,0) ON CONFLICT(source,external_id) DO UPDATE SET weight_kg=excluded.weight_kg,context=excluded.context,source_account_identity=excluded.source_account_identity,source_external_id=excluded.source_external_id,source_payload=excluded.source_payload,source_updated_at=excluded.source_updated_at,source_run_version=excluded.source_run_version,deleted_at=NULL,updated_at=excluded.updated_at,observation_at_known=0`)
          .run(`whoop:body:${storedExternalId}`,existing?.measured_at??ts,body.weight_kilogram??null,storedExternalId,acct.accountIdentity,sourceExternalId,JSON.stringify(body),runStartedAt,lease.runVersion,ts,ts);
      }
      const completedAt=clock();
      if(dataError)db.prepare("UPDATE whoop_tokens SET last_error=?,auth_error=NULL,auth_checked_at=CASE WHEN auth_checked_at IS NULL OR auth_checked_at<=? THEN ? ELSE auth_checked_at END WHERE user_id=? AND enabled=1").run(dataError,completedAt,completedAt,acct.user_id);
      else db.prepare("UPDATE whoop_tokens SET last_sync=CASE WHEN last_sync IS NULL OR last_sync<=? THEN ? ELSE last_sync END,last_error=NULL,auth_error=NULL,auth_checked_at=CASE WHEN auth_checked_at IS NULL OR auth_checked_at<=? THEN ? ELSE auth_checked_at END WHERE user_id=? AND enabled=1").run(completedAt,completedAt,completedAt,completedAt,acct.user_id);
      db.prepare(`UPDATE health_sync_state SET last_attempt_at=CASE WHEN last_attempt_at IS NULL OR last_attempt_at<=? THEN ? ELSE last_attempt_at END,last_success_at=CASE WHEN ? IS NULL THEN last_success_at WHEN last_success_at IS NULL OR last_success_at<=? THEN ? ELSE last_success_at END,last_error=?,updated_at=CASE WHEN updated_at<=? THEN ? ELSE updated_at END WHERE source='whoop' AND lease_token=? AND run_version=?`).run(runStartedAt,runStartedAt,dataError?null:completedAt,completedAt,completedAt,dataError,completedAt,completedAt,lease.token,lease.runVersion);
    }).immediate();
    return dataError?{status:"degraded",detail:"WHOOP data sync completed only partially"}:{status:"healthy",detail:"WHOOP sync complete"};
  } catch (e: any) {
    const changed=String(e?.message||"")==="WHOOP_DATA_SESSION_CHANGED";
    const dataError=changed?"WHOOP_DATA_SESSION_CHANGED":"WHOOP_DATA_SYNC_FAILED";
    const db=getDb();const state=db.prepare("SELECT account_identity accountIdentity,generation FROM health_sync_state WHERE source='whoop'").get() as any;
    if(state?.accountIdentity===acct.accountIdentity&&Number(state?.generation)===acct.generation&&sourceLeaseStillCurrent(db,"whoop",lease,clock()))db.prepare("UPDATE whoop_tokens SET last_error=? WHERE user_id=? AND enabled=1").run(dataError,acct.user_id);
    return {status:"degraded",detail:changed?"WHOOP data source changed during sync":"WHOOP data sync failed"};
  } finally {
    releaseSourceLease(getDb(),"whoop",lease);
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
    lastError: sanitizeWhoopDataError(acct?.last_error),
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
  const db=getDb();
  db.transaction(()=>{
    const state=ensureSourceState(db,"whoop");
    const active=db.prepare("SELECT user_id FROM whoop_tokens WHERE enabled=1 ORDER BY connected_at DESC,user_id DESC LIMIT 1").get() as any;
    const accountIdentity=state.accountIdentity||(active?.user_id?sourceIdentity("whoop-account",active.user_id):null);
    if(!accountIdentity)throw new Error("WHOOP disconnect cannot archive without an account identity");
    quarantineImportedRows(db,"whoop",nowIso(),{accountIdentity,reason:"disconnect"});
    db.prepare("UPDATE whoop_tokens SET enabled=0,refresh_token_enc=NULL,last_error=NULL,auth_error=NULL").run();
    db.prepare("UPDATE health_sync_state SET account_identity=NULL,generation=generation+1,cursor=NULL,last_success_at=NULL,last_error=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE source='whoop'").run(nowIso());
  }).immediate();
  cache().clear();refreshing().clear();
}
