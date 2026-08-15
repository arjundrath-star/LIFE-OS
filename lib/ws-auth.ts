import { getToken } from "next-auth/jwt";
import { allowedEmails, healthAllowedEmails } from "@/lib/secrets";

export type WebSocketAuth = { email: string; expiresAtMs: number };
type TokenReader = typeof getToken;

export function appAllowlist(value?: string): string[] {
  if (value === undefined) return allowedEmails();
  return [...new Set(value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function healthAllowlist(value?: string, appAllowed?: string[]): string[] {
  if (value === undefined && appAllowed === undefined) return healthAllowedEmails();
  const general = new Set((appAllowed ?? appAllowlist()).map((email) => email.trim().toLowerCase()).filter(Boolean));
  return [...new Set((value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0 && general.has(email)))];
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return {};
    }
  }
  return cookies;
}

export async function authorizeWebSocketCookie(
  cookieHeader: string | undefined,
  options: { nowMs?: number; readToken?: TokenReader; allowed?: string[]; secureCookie?: boolean } = {}
): Promise<WebSocketAuth | null> {
  if (!cookieHeader) return null;
  const allowed = new Set((options.allowed ?? appAllowlist())
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
  if (allowed.size === 0) return null;
  try {
    const readToken = options.readToken ?? getToken;
    const token = await readToken({
      req: { headers: { cookie: cookieHeader }, cookies: parseCookieHeader(cookieHeader) } as any,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: options.secureCookie ?? (process.env.NEXTAUTH_URL || "").startsWith("https://"),
    });
    const email = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
    const expSeconds = typeof token?.exp === "number" ? token.exp : 0;
    const expiresAtMs = expSeconds * 1000;
    if (!email || !allowed.has(email) || expiresAtMs <= (options.nowMs ?? Date.now())) return null;
    return { email, expiresAtMs };
  } catch {
    return null;
  }
}

type GuardedSocket = {
  destroy: () => void;
  on: (event: "close" | "error", listener: () => void) => unknown;
};

type GuardedWebSocket = {
  close: (code?: number, reason?: string) => void;
  on: (event: "close" | "error", listener: () => void) => unknown;
};

type SocketGuardOptions = {
  authorize?: (cookieHeader: string | undefined) => Promise<WebSocketAuth | null>;
  now?: () => number;
  revalidateEveryMs?: number;
  maxTimerMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

type SessionGuardTarget = {
  reject: () => void;
  on: (event: "close" | "error", listener: () => void) => unknown;
};

function guardRevalidatingSession(
  target: SessionGuardTarget,
  cookieHeader: string | undefined,
  initialAuth: WebSocketAuth,
  options: SocketGuardOptions
) {
  const authorize = options.authorize ?? authorizeWebSocketCookie;
  const now = options.now ?? Date.now;
  const revalidateEveryMs = options.revalidateEveryMs ?? 60_000;
  const maxTimerMs = options.maxTimerMs ?? 2_000_000_000;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let revalidationTimer: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  let revalidating = false;

  const cleanup = () => {
    if (expiryTimer !== undefined) clearTimeoutFn(expiryTimer);
    if (revalidationTimer !== undefined) clearIntervalFn(revalidationTimer);
    expiryTimer = undefined;
    revalidationTimer = undefined;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  const reject = () => {
    if (finished) return;
    finish();
    try { target.reject(); } catch {}
  };
  const scheduleExpiry = () => {
    if (finished) return;
    const remaining = initialAuth.expiresAtMs - now();
    const delay = remaining <= 0 ? 0 : Math.min(remaining, maxTimerMs);
    expiryTimer = setTimeoutFn(() => {
      expiryTimer = undefined;
      if (initialAuth.expiresAtMs <= now()) reject();
      else scheduleExpiry();
    }, delay);
  };
  const revalidateNow = async () => {
    if (finished || revalidating) return;
    if (!cookieHeader || initialAuth.expiresAtMs <= now()) {
      reject();
      return;
    }
    revalidating = true;
    let auth: WebSocketAuth | null = null;
    try { auth = await authorize(cookieHeader); } catch {}
    revalidating = false;
    if (
      finished ||
      !auth ||
      auth.email !== initialAuth.email ||
      auth.expiresAtMs <= now() ||
      initialAuth.expiresAtMs <= now()
    ) reject();
  };

  target.on("close", finish);
  target.on("error", finish);
  scheduleExpiry();
  revalidationTimer = setIntervalFn(() => { void revalidateNow(); }, revalidateEveryMs);
  return { cleanup: finish, revalidateNow };
}

export function guardPrivilegedProxySocket(
  socket: GuardedSocket,
  cookieHeader: string | undefined,
  initialAuth: WebSocketAuth,
  options: SocketGuardOptions = {}
) {
  return guardRevalidatingSession({
    reject: () => socket.destroy(),
    on: (event, listener) => socket.on(event, listener),
  }, cookieHeader, initialAuth, options);
}

export function guardAppWebSocketSession(
  socket: GuardedWebSocket,
  cookieHeader: string | undefined,
  initialAuth: WebSocketAuth,
  options: SocketGuardOptions = {}
) {
  return guardRevalidatingSession({
    reject: () => socket.close(4001, "session expired"),
    on: (event, listener) => socket.on(event, listener),
  }, cookieHeader, initialAuth, options);
}
