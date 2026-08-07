// Dynamic multi-Google reader. Each account is connected via its own OAuth consent
// (same Google client as the gate, different flow + scopes), its refresh token stored
// ENCRYPTED in SQLite. Read-only: Gmail unread radar + today's calendar. Server-only.
import { requireSecret } from "@/lib/secrets";
import { encrypt, decrypt } from "@/lib/crypto";
import { all, get, run, nowIso, kvGet } from "@/db";

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
export function connectUrl(state: string, options: { loginHint?: string; hostedDomain?: string } = {}): string {
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
  if (options.loginHint) p.set("login_hint", options.loginHint);
  if (options.hostedDomain) p.set("hd", options.hostedDomain);
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

// "Jane Doe <jane@x.com>" -> "Jane Doe"; "bob@x.com" -> "bob@x.com"
function senderName(from: string | null): string {
  if (!from) return "";
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  const name = m?.[1]?.trim();
  return name && name.length ? name : from.replace(/[<>]/g, "").trim();
}

type RecentMsg = {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  ts: string | null;
  unread: boolean;
  important: boolean;
};

// Pull the latest few inbox messages with metadata so the UI can show a real
// scannable feed (sender · subject · time · unread). Read-only.
async function recentInbox(token: string, limit = 6): Promise<RecentMsg[]> {
  const list = await gapi(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=` +
      encodeURIComponent("in:inbox")
  );
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id).filter(Boolean);
  const out: RecentMsg[] = [];
  for (const id of ids) {
    try {
      const msg = await gapi(
        token,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`
      );
      const headers: any[] = msg.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? null;
      const labels: string[] = msg.labelIds ?? [];
      out.push({
        id,
        subject,
        from: from ?? "",
        fromName: senderName(from),
        ts: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        unread: labels.includes("UNREAD"),
        important: labels.includes("IMPORTANT"),
      });
    } catch {
      /* skip one bad message */
    }
  }
  return out;
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
    // Recent inbox feed (independent of unread) — drives the scannable cross-inbox list.
    let recentJson: string | null = null;
    try {
      const recent = await recentInbox(token, 6);
      recentJson = JSON.stringify(recent);
    } catch {
      /* keep last-known recent on a transient error */
      recentJson = get<any>("SELECT recent_json FROM email_state WHERE email=?", email)?.recent_json ?? null;
    }
    run(
      `INSERT INTO email_state (email, unread_count, important_count, latest_subject, latest_from, latest_ts, last_checked, recent_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         unread_count=excluded.unread_count, important_count=excluded.important_count,
         latest_subject=excluded.latest_subject, latest_from=excluded.latest_from,
         latest_ts=excluded.latest_ts, last_checked=excluded.last_checked,
         recent_json=excluded.recent_json`,
      email,
      unread,
      importantCount,
      latestSubject,
      latestFrom,
      latestTs,
      nowIso(),
      recentJson
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
            e.latest_subject, e.latest_from, e.latest_ts, e.last_checked, e.recent_json
     FROM google_accounts g LEFT JOIN email_state e ON e.email=g.email
     WHERE g.enabled=1 ORDER BY unread_count DESC`
  );
  // Build one merged, time-sorted feed across all inboxes (unread + important first).
  const recent: any[] = [];
  for (const a of accounts) {
    let parsed: any[] = [];
    try {
      parsed = a.recent_json ? JSON.parse(a.recent_json) : [];
    } catch {
      parsed = [];
    }
    a.recent = parsed;
    delete a.recent_json;
    for (const m of parsed) recent.push({ ...m, account: a.email });
  }
  recent.sort((x, y) => {
    // unread floats up, then most recent
    if (!!y.unread !== !!x.unread) return y.unread ? 1 : -1;
    return (y.ts || "").localeCompare(x.ts || "");
  });
  return {
    connected: accounts.length,
    totalUnread: accounts.reduce((s, a) => s + (a.unread_count || 0), 0),
    totalImportant: accounts.reduce((s, a) => s + (a.important_count || 0), 0),
    accounts,
    recent: recent.slice(0, 14),
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

// ---- Vending / venue outreach (one designated business inbox) ----
// Venue outreach for the vending business runs from a single business inbox.
// The Vending tab's "reached out / responded" numbers come straight from that
// mailbox, read-only, scoped by a configurable subject query so the counts
// never conflate with unrelated mail.
const DEFAULT_OUTREACH_QUERY = "subject:(charging OR vending)";
// The address outreach runs from. OUTREACH_INBOX names it; the placeholder
// default means "nothing configured" until the env var or kv override is set.
const DEFAULT_OUTREACH_INBOX = (process.env.OUTREACH_INBOX || "operator@example.com")
  .trim()
  .toLowerCase();

/** Which inbox + scope query the vending outreach counts come from. kv overrides win. */
export function outreachConfig(): { inbox: string | null; query: string } {
  const query = (kvGet<string>("vending.outreach_query") || DEFAULT_OUTREACH_QUERY).trim();
  let inbox = (kvGet<string>("vending.outreach_inbox") || "").trim().toLowerCase() || null;
  if (!inbox) {
    // Default to a connected account on the outreach domain, preferring the
    // configured address itself when it is connected.
    const domain = DEFAULT_OUTREACH_INBOX.split("@")[1] || "example.com";
    const row = get<any>(
      `SELECT email FROM google_accounts
       WHERE enabled=1 AND email LIKE ?
       ORDER BY (email=?) DESC, added_at LIMIT 1`,
      `%@${domain}`,
      DEFAULT_OUTREACH_INBOX
    );
    inbox = row?.email ?? null;
  }
  return { inbox, query };
}

// "Name <a@b.com>" / "<a@b.com>" / "a@b.com" -> "a@b.com"
function emailAddr(v: string | null | undefined): string {
  if (!v) return "";
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
}

async function listMatching(token: string, q: string, cap = 400): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const j = await gapi(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`
    );
    for (const m of j.messages ?? []) if (m.id) out.push(m.id);
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < cap);
  return out.slice(0, cap);
}

export type GmailMetadata = { id:string; threadId:string; subject:string; from:string; internalDate:string|null };

/** Paginated Gmail search for specialist read-only jobs. Counts actual ids; never trusts resultSizeEstimate. */
export async function gmailSearchMetadata(email: string, query: string, cap = 120): Promise<GmailMetadata[]> {
  const account = email.trim().toLowerCase();
  const token = await accessTokenFor(account);
  if (!token) throw new Error(`Gmail account ${account} is not authorized`);
  const ids = await listMatching(token, query, cap);
  return mapLimit(ids, 8, async (id) => {
    const msg = await gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
    const headers: any[] = msg.payload?.headers ?? [];
    const header = (name:string) => headers.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
    return { id, threadId:msg.threadId || id, subject:header("subject"), from:header("from"), internalDate:msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null };
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) break;
        res[idx] = await fn(items[idx]);
      }
    })
  );
  return res;
}

/**
 * Recompute the vending/venue outreach snapshot from the configured business inbox.
 * Distinct recipient venues we emailed (subject-scoped) = "reached out"; venues that
 * sent anything back = "responded". Resilient: a Gmail error keeps the last snapshot.
 */
export async function pollVendingOutreach(): Promise<void> {
  const { inbox, query } = outreachConfig();
  if (!inbox) return; // nothing connected — vendingOutreachSnapshot() reports not-connected
  const me = inbox.toLowerCase();
  const recordError = (msg: string) =>
    run(
      `INSERT INTO vending_outreach (inbox, query, last_checked, last_error)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(inbox) DO UPDATE SET query=excluded.query, last_checked=excluded.last_checked, last_error=excluded.last_error`,
      inbox,
      query,
      nowIso(),
      msg.slice(0, 200)
    );

  const token = await accessTokenFor(me);
  if (!token) {
    recordError("inbox not authorized");
    return;
  }
  try {
    // One scoped pass over the mailbox: sent items reveal who we reached; everything
    // else matching the same subject is an inbound reply (Re: keeps the keyword).
    const ids = await listMatching(token, query, 400);
    const metas = await mapLimit(ids, 8, async (id) => {
      try {
        return await gapi(
          token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
            `?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`
        );
      } catch {
        return null;
      }
    });

    const sentRecip = new Map<string, { ts: number; subject: string }>();
    const replyFrom = new Set<string>();
    for (const msg of metas) {
      if (!msg) continue;
      const headers: any[] = msg.payload?.headers ?? [];
      const hv = (n: string) => headers.find((h) => h.name?.toLowerCase() === n)?.value ?? "";
      const labels: string[] = msg.labelIds ?? [];
      const ts = Number(msg.internalDate ?? 0);
      if (labels.includes("SENT")) {
        const to = emailAddr(hv("to"));
        if (to && to !== me) {
          const prev = sentRecip.get(to);
          if (!prev || ts > prev.ts) sentRecip.set(to, { ts, subject: hv("subject") });
        }
      } else {
        const fr = emailAddr(hv("from"));
        if (fr && fr !== me) replyFrom.add(fr);
      }
    }

    const weekAgo = Date.now() - 7 * 86400000;
    let reached7d = 0;
    let respondedTotal = 0;
    const recent: Array<{ to: string; subject: string; ts: string; replied: boolean }> = [];
    for (const [addr, info] of sentRecip) {
      if (info.ts >= weekAgo) reached7d++;
      const replied = replyFrom.has(addr);
      if (replied) respondedTotal++;
      recent.push({
        to: addr,
        subject: info.subject || "(no subject)",
        ts: info.ts ? new Date(info.ts).toISOString() : "",
        replied,
      });
    }
    // Replied venues float to the top (so they survive the slice + show first), then newest.
    recent.sort((a, b) => {
      if (a.replied !== b.replied) return a.replied ? -1 : 1;
      return (b.ts || "").localeCompare(a.ts || "");
    });

    run(
      `INSERT INTO vending_outreach
         (inbox, query, reached_total, reached_7d, responded_total, recent_json, last_checked, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(inbox) DO UPDATE SET
         query=excluded.query, reached_total=excluded.reached_total, reached_7d=excluded.reached_7d,
         responded_total=excluded.responded_total, recent_json=excluded.recent_json,
         last_checked=excluded.last_checked, last_error=NULL`,
      inbox,
      query,
      sentRecip.size,
      reached7d,
      respondedTotal,
      JSON.stringify(recent.slice(0, 12)),
      nowIso()
    );
  } catch (e: any) {
    recordError(String(e?.message || e));
  }
}

export type VendingOutreach = {
  connected: boolean;
  inbox: string | null;
  query: string;
  reachedTotal: number;
  reached7d: number;
  respondedTotal: number;
  responseRate: number; // %
  recent: Array<{ to: string; subject: string; ts: string; replied: boolean }>;
  lastChecked: string | null;
  lastError: string | null;
};

/** Read-only view of the cached vending outreach numbers for the API/scheduler. */
export function vendingOutreachSnapshot(): VendingOutreach {
  const { inbox, query } = outreachConfig();
  const base: VendingOutreach = {
    connected: false,
    inbox,
    query,
    reachedTotal: 0,
    reached7d: 0,
    respondedTotal: 0,
    responseRate: 0,
    recent: [],
    lastChecked: null,
    lastError: null,
  };
  if (!inbox) return base;
  const connected = !!get<any>("SELECT 1 FROM google_accounts WHERE email=? AND enabled=1", inbox);
  const row = get<any>("SELECT * FROM vending_outreach WHERE inbox=?", inbox);
  let recent: VendingOutreach["recent"] = [];
  try {
    recent = row?.recent_json ? JSON.parse(row.recent_json) : [];
  } catch {
    recent = [];
  }
  const reachedTotal = row?.reached_total ?? 0;
  const respondedTotal = row?.responded_total ?? 0;
  return {
    ...base,
    connected,
    query: row?.query || query,
    reachedTotal,
    reached7d: row?.reached_7d ?? 0,
    respondedTotal,
    responseRate: reachedTotal ? Math.round((respondedTotal / reachedTotal) * 100) : 0,
    recent,
    lastChecked: row?.last_checked ?? null,
    lastError: row?.last_error ?? null,
  };
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
