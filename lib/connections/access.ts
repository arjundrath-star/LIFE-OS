export const HEALTH_CONNECTION_SERVICES = new Set(["whoop", "hevy"] as const);

export type ConnectionAccess = { email: string; health: boolean };

type ConnectionStateLike = { service: string };
type ConnectionDefinitionLike = { id: string };

export function isHealthConnectionService(service: unknown): service is "whoop" | "hevy" {
  return typeof service === "string" && HEALTH_CONNECTION_SERVICES.has(service as "whoop" | "hevy");
}

/** Pure/testable access classification. The caller supplies the already constrained Health allowlist. */
export function connectionAccessForEmail(email: string, healthAllowed: readonly string[]): ConnectionAccess {
  const normalized = email.trim().toLowerCase();
  const allowed = new Set(healthAllowed.map((value) => value.trim().toLowerCase()).filter(Boolean));
  return { email: normalized, health: normalized.length > 0 && allowed.has(normalized) };
}

export function mayMutateConnection(access: ConnectionAccess, service: unknown): boolean {
  return !isHealthConnectionService(service) || access.health;
}

export function filterConnectionStates<T extends ConnectionStateLike>(states: readonly T[], access: ConnectionAccess): T[] {
  return access.health ? [...states] : states.filter((state) => !isHealthConnectionService(state.service));
}

export function visibleConnectionDefinitions<T extends ConnectionDefinitionLike>(definitions: readonly T[], access: ConnectionAccess): T[] {
  return access.health ? [...definitions] : definitions.filter((definition) => !isHealthConnectionService(definition.id));
}

/** Shared by middleware so all WHOOP OAuth/mutation endpoints receive the Health gate. */
export function isHealthApiPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/health/") ||
    pathname === "/api/health" || pathname.startsWith("/api/health/") ||
    pathname === "/api/whoop" || pathname.startsWith("/api/whoop/");
}

/** Per-recipient projection for the generic WebSocket connections channel. */
export function filterConnectionChannelPayload(payload: unknown, health: boolean): unknown {
  if (health) return payload;
  if (Array.isArray(payload)) return payload.filter((row) => !isHealthConnectionService(row?.service));
  if (payload && typeof payload === "object" && Array.isArray((payload as any).connections)) {
    return { ...(payload as any), connections: (payload as any).connections.filter((row: any) => !isHealthConnectionService(row?.service)) };
  }
  // Unknown future connection payload shapes fail closed for ordinary users.
  return [];
}

/** Historic ticker rows may predate PII hardening, so omit Health-related entries for ordinary users. */
export function filterTickerChannelPayload(payload: unknown, health: boolean): unknown {
  if (health || !Array.isArray(payload)) return health ? payload : [];
  return payload.filter((event) => {
    const source = typeof event?.source === "string" ? event.source.toLowerCase() : "";
    const message = typeof event?.message === "string" ? event.message.toLowerCase() : "";
    if (isHealthConnectionService(source)) return false;
    return !(source === "connections" && /\b(whoop|hevy)\b/.test(message));
  });
}
