// Dynamic multi-Google reader. Each account is connected via its own OAuth consent
// (same Google client as the gate, different flow + scopes), its refresh token stored
// ENCRYPTED in SQLite. Read-only: Gmail unread radar + today's calendar. Server-only.
import { requireSecret } from "@/lib/secrets";
import { encrypt, decrypt } from "@/lib/crypto";
import { all, get, run, nowIso } from "@/db";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}
export function redirectUri(): string {
  return `${baseUrl()}/api/google/callback`;
}

// ---- OAuth flow ----
export function connectUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: requireSecret("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    scope: SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireSecret("GOOGLE_CLIENT_ID"),
      client_secret: requireSecret("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function userInfo(accessToken: string): Promise<{ email: string; name?: string; picture?: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}

/** Complete the connect flow: store the account + encrypted refresh token. */
export async function handleCallback(code: string): Promise<{ email: string }> {
  const tok = await exchangeCode(code);
  const info = await userInfo(tok.access_token);
  const email = info.email.toLowerCase();
  const existing = get<any>("SELECT email, refresh_token_enc FROM google_accounts WHERE email=?", email);
  // Google only returns refresh_token on first consent; keep the old one if absent.
  const refreshEnc = tok.refresh_token
    ? encrypt(tok.refresh_token)
    : existing?.refresh_token_enc ?? null;
  run(
    `INSERT INTO google_accounts (email, name, picture, refresh_token_enc, scopes, enabled, last_error, added_at)
     VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
     ON CONFLICT(email) DO UPDATE SET
       name=excluded.name, picture=excluded.picture,
       refresh_token_enc=COALESCE(excluded.refresh_token_enc, google_accounts.refresh_token_enc),
       scopes=excluded.scopes, enabled=1, last_error=NULL`,
    email,
    info.name ?? null,
    info.picture ?? null,
    refreshEnc,
    SCOPES,
    nowIso()
  );
  return { email };
}

// ---- access token cache ----
const g = globalThis as any;
function tokenCache(): Map<string, { token: string; exp: number }> {
  if (!g.__rw_gtok) g.__rw_gtok = new Map();
  return g.__rw_gtok;
}

async function accessTokenFor(email: string): Promise<string | null> {
  const cache = tokenCache();
  const cached = cache.get(email);
  if (cached && cached.exp > Date.now() + 30000) return cached.token;

  const row = get<any>("SELECT refresh_token_enc FROM google_accounts WHERE email=?", email);
  if (!row?.refresh_token_enc) return null;
  let refresh: string;
  try {
    refresh = decrypt(row.refresh_token_enc);
  } catch {
    return null;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireSecret("GOOGLE_CLIENT_ID"),
      client_secret: requireSecret("GOOGLE_CLIENT_SECRET"),
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    run("UPDATE google_accounts SET last_error=? WHERE email=?", `refresh failed: ${res.status}`, email);
    return null;
  }
  const j = await res.json();
  if (!j.access_token) {
    run("UPDATE google_accounts SET last_error='refresh returned no access_token' WHERE email=?", email);
    return null;
  }
  const exp = Date.now() + (j.expires_in ?? 3600) * 1000;
  cache.set(email, { token: j.access_token, exp });
  return j.access_token;
}

async function gapi(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`gapi ${res.status} ${url}`);
  return res.json();
}

// ---- Gmail unread radar ----
async function pollOne(email: string) {
  const token = await accessTokenFor(email);
  if (!token) {
    run("UPDATE google_accounts SET last_error=COALESCE(last_error,'auth failed') WHERE email=?", email);
    return;
  }
  try {
    // Count unread the SAME way the latest-message lookup queries, so the headline
    // number matches the inbox view (labels/INBOX.messagesUnread overcounts: it
    // includes category-tabbed mail and counts messages, not the inbox-view threads).
    const unreadList = await gapi(
      token,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=" +
        encodeURIComponent("is:unread in:inbox")
    );
    const unread = unreadList.resultSizeEstimate ?? 0;
    let importantCount = 0;
    let latestSubject: string | null = null;
    let latestFrom: string | null = null;
    let latestTs: string | null = null;
    if (unread > 0) {
      const imp = await gapi(
        token,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=" +
          encodeURIComponent("is:unread is:important in:inbox")
      );
      importantCount = imp.resultSizeEstimate ?? 0;
      const id = unreadList.messages?.[0]?.id;
      if (id) {
        const msg = await gapi(
          token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`
        );
        const headers: any[] = msg.payload?.headers ?? [];
        latestSubject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        latestFrom = headers.find((h) => h.name === "From")?.value ?? null;
        latestTs = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
      }
    }
    run(
      `INSERT INTO email_state (email, unread_count, important_count, latest_subject, latest_from, latest_ts, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         unread_count=excluded.unread_count, important_count=excluded.important_count,
         latest_subject=excluded.latest_subject, latest_from=excluded.latest_from,
         latest_ts=excluded.latest_ts, last_checked=excluded.last_checked`,
      email,
      unread,
      importantCount,
      latestSubject,
      latestFrom,
      latestTs,
      nowIso()
    );
    run("UPDATE google_accounts SET last_sync=?, last_error=NULL WHERE email=?", nowIso(), email);
  } catch (e: any) {
    run("UPDATE google_accounts SET last_error=? WHERE email=?", String(e?.message || e).slice(0, 200), email);
  }
}

export async function pollEmailAccounts(): Promise<void> {
  const accts = all<any>("SELECT email FROM google_accounts WHERE enabled=1");
  for (const a of accts) await pollOne(a.email);
}

export function emailSnapshots() {
  const accounts = all<any>(
    `SELECT g.email, g.name, g.picture, g.last_error, g.last_sync,
            COALESCE(e.unread_count,0) unread_count, COALESCE(e.important_count,0) important_count,
            e.latest_subject, e.latest_from, e.latest_ts, e.last_checked
     FROM google_accounts g LEFT JOIN email_state e ON e.email=g.email
     WHERE g.enabled=1 ORDER BY unread_count DESC`
  );
  return {
    connected: accounts.length,
    totalUnread: accounts.reduce((s, a) => s + (a.unread_count || 0), 0),
    totalImportant: accounts.reduce((s, a) => s + (a.important_count || 0), 0),
    accounts,
  };
}

// ---- Calendar (today, aggregated) ----
export async function todaysEvents() {
  const accts = all<any>("SELECT email FROM google_accounts WHERE enabled=1");
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const events: any[] = [];
  for (const a of accts) {
    const token = await accessTokenFor(a.email);
    if (!token) continue;
    try {
      const url =
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
        new URLSearchParams({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "20",
        });
      const j = await gapi(token, url);
      for (const ev of j.items ?? []) {
        events.push({
          account: a.email,
          summary: ev.summary ?? "(busy)",
          start: ev.start?.dateTime ?? ev.start?.date ?? null,
          end: ev.end?.dateTime ?? ev.end?.date ?? null,
          allDay: !ev.start?.dateTime,
          location: ev.location ?? null,
          htmlLink: ev.htmlLink ?? null,
        });
      }
    } catch {
      /* skip account on error */
    }
  }
  events.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  return { connected: accts.length, events };
}

// ---- management ----
export function listAccounts() {
  return all<any>(
    "SELECT email, name, picture, enabled, last_sync, last_error, added_at FROM google_accounts ORDER BY added_at"
  );
}
export function setAccountEnabled(email: string, enabled: boolean) {
  run("UPDATE google_accounts SET enabled=? WHERE email=?", enabled ? 1 : 0, email.toLowerCase());
}
export function removeAccount(email: string) {
  run("DELETE FROM google_accounts WHERE email=?", email.toLowerCase());
  run("DELETE FROM email_state WHERE email=?", email.toLowerCase());
  tokenCache().delete(email.toLowerCase());
}
