// Server-only, read-only AgentMemory adapter for the Rathworkspace BFF.
// This module deliberately exposes no generic proxy: every upstream path and payload is fixed here.
import path from "node:path";
import { requireSecret, secret } from "@/lib/secrets";

if (typeof window !== "undefined") {
  throw new Error("lib/agentmemory.ts is server-only and must never reach the client bundle");
}

const BASE_URL = "http://127.0.0.1:3111";
const REQUEST_TIMEOUT_MS = 5_000;
const SNAPSHOT_MEMORY_LIMIT = 20;
export const SEARCH_QUERY_MAX = 160;
export const SEARCH_RESULT_MAX = 10;

const SECRET_ASSIGNMENT = /\b(?:agentmemory_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[:=]\s*([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN = /\b(?:sk|pk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PRIVATE_KEY = /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g;
const SENSITIVE_QUERY = /([?&](?:token|key|secret|password|signature|code)=)[^&#\s]+/gi;

export type ValidationResult =
  | { ok: true; value: { query: string; limit: number } }
  | { ok: false; error: string };

export function validateSearchInput(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "query" && key !== "limit")) {
    return { ok: false, error: "only query and limit are allowed" };
  }
  if (typeof body.query !== "string") {
    return { ok: false, error: "query must be a string" };
  }
  if (/[\u0000-\u001f\u007f]/.test(body.query)) {
    return { ok: false, error: "query contains unsupported control characters" };
  }
  const query = body.query.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > SEARCH_QUERY_MAX) {
    return { ok: false, error: `query must be between 2 and ${SEARCH_QUERY_MAX} characters` };
  }

  const limit = body.limit === undefined ? 6 : body.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > SEARCH_RESULT_MAX) {
    return { ok: false, error: `limit must be an integer between 1 and ${SEARCH_RESULT_MAX}` };
  }
  return { ok: true, value: { query, limit: limit as number } };
}

export function redactText(value: unknown, maxLength = 1_200): string {
  if (typeof value !== "string") return "";
  const redacted = value
    .replace(PRIVATE_KEY, "[redacted private key]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[redacted token]")
    .replace(TOKEN, "[redacted credential]")
    .replace(SECRET_ASSIGNMENT, (match, captured: string) => match.replace(captured, "[redacted]"))
    .replace(SENSITIVE_QUERY, "$1[redacted]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeString(value: unknown, maxLength = 240): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return redactText(value.trim(), maxLength);
}

function safeId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) return null;
  return value;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function safeProject(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const name = path.basename(value.trim());
  return safeString(name, 100);
}

function safeTags(value: unknown, limit = 12): string[] {
  return asArray(value)
    .map((item) => safeString(item, 80))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

export function sanitizeMemory(value: unknown) {
  const memory = asRecord(value);
  return {
    id: safeId(memory.id),
    title: safeString(memory.title, 240) || "Untitled memory",
    content: safeString(memory.content, 1_200),
    type: safeString(memory.type, 40),
    project: safeProject(memory.project),
    concepts: safeTags(memory.concepts),
    strength: safeNumber(memory.strength),
    createdAt: safeDate(memory.createdAt),
    updatedAt: safeDate(memory.updatedAt),
  };
}

function sanitizeSession(value: unknown) {
  const session = asRecord(value);
  return {
    id: safeId(session.id) || safeId(session.sessionId),
    status: safeString(session.status, 40),
    project: safeProject(session.project),
    summary: safeString(session.summary, 600),
    observationCount: safeNumber(session.observationCount),
    startedAt: safeDate(session.startedAt),
    endedAt: safeDate(session.endedAt),
    updatedAt: safeDate(session.updatedAt),
  };
}

function sanitizeSearchResult(value: unknown) {
  const result = asRecord(value);
  return {
    id: safeId(result.id) || safeId(result.obsId),
    sessionId: safeId(result.sessionId),
    title: safeString(result.title, 240) || "Memory result",
    content:
      safeString(result.content, 1_000) ||
      safeString(result.summary, 1_000) ||
      safeString(result.narrative, 1_000),
    type: safeString(result.type, 40),
    score: safeNumber(result.score),
    timestamp: safeDate(result.timestamp) || safeDate(result.createdAt),
  };
}

function deriveProfile(memories: ReturnType<typeof sanitizeMemory>[]) {
  const conceptCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  for (const memory of memories) {
    for (const concept of memory.concepts) {
      conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
    }
    if (memory.project) projectCounts.set(memory.project, (projectCounts.get(memory.project) || 0) + 1);
  }
  const rank = (counts: Map<string, number>, limit: number) =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([label, count]) => ({ label, count }));
  return { concepts: rank(conceptCounts, 12), projects: rank(projectCounts, 8) };
}

async function upstreamJson(
  endpoint: "health" | "sessions" | "memories" | "smart-search",
  options?: { body?: { query: string; limit: number } }
): Promise<unknown> {
  const bearer = requireSecret("AGENTMEMORY_SECRET");
  let pathname: string;
  let method = "GET";
  let body: string | undefined;
  switch (endpoint) {
    case "health":
      pathname = "/agentmemory/health";
      break;
    case "sessions":
      pathname = "/agentmemory/sessions";
      break;
    case "memories":
      pathname = `/agentmemory/memories?latest=true&offset=0&limit=${SNAPSHOT_MEMORY_LIMIT}`;
      break;
    case "smart-search":
      pathname = "/agentmemory/smart-search";
      method = "POST";
      body = JSON.stringify(options!.body);
      break;
  }
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json", "x-agentmemory-source": "rathworkspace-readonly" } : {}),
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AgentMemory ${endpoint} returned HTTP ${response.status}`);
  return response.json();
}

export async function fetchAgentMemorySnapshot() {
  // Native /profile can populate a cache and audit row, so this strict read-only BFF derives
  // its profile summary from GET /memories instead of invoking that endpoint.
  const [healthRaw, sessionsRaw, memoriesRaw] = await Promise.all([
    upstreamJson("health"),
    upstreamJson("sessions"),
    upstreamJson("memories"),
  ]);
  const health = asRecord(healthRaw);
  const detail = asRecord(health.health);
  const breaker = asRecord(health.circuitBreaker);
  const kv = asRecord(detail.kvConnectivity);
  const sessions = asArray(asRecord(sessionsRaw).sessions)
    .map(sanitizeSession)
    .sort((a, b) => Date.parse(b.updatedAt || b.startedAt || "") - Date.parse(a.updatedAt || a.startedAt || ""))
    .slice(0, 12);
  const memoryEnvelope = asRecord(memoriesRaw);
  const memories = asArray(memoryEnvelope.memories)
    .map(sanitizeMemory)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
  return {
    service: {
      status: safeString(health.status, 40) || "unknown",
      version: safeString(health.version, 40),
      uptimeSeconds: safeNumber(detail.uptimeSeconds),
      connectionState: safeString(detail.connectionState, 40),
      kvStatus: safeString(kv.status, 40),
      circuitState: safeString(breaker.state, 40),
    },
    counts: {
      memories: safeNumber(memoryEnvelope.total) ?? memories.length,
      sessions: asArray(asRecord(sessionsRaw).sessions).length,
    },
    profile: deriveProfile(memories),
    memories,
    sessions,
    checkedAt: new Date().toISOString(),
  };
}

export async function searchAgentMemory(query: string, limit: number) {
  const raw = asRecord(await upstreamJson("smart-search", { body: { query, limit } }));
  return {
    mode: safeString(raw.mode, 40),
    results: asArray(raw.results).map(sanitizeSearchResult).slice(0, limit),
  };
}

export function createFixedWindowRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()) => {
    const existing = buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + windowMs;
      buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: maxRequests - 1, resetAt };
    }
    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }
    existing.count += 1;
    return { allowed: true, remaining: maxRequests - existing.count, resetAt: existing.resetAt };
  };
}

const configuredRateLimit = Number(secret("AGENTMEMORY_SEARCH_RATE_LIMIT") || 20);
export const agentMemorySearchRateLimit = createFixedWindowRateLimiter(
  Number.isInteger(configuredRateLimit) && configuredRateLimit >= 1 && configuredRateLimit <= 100
    ? configuredRateLimit
    : 20,
  60_000
);
