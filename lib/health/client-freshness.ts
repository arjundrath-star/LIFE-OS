export type HealthTransportStatus = "connecting" | "open" | "closed";
export type HealthSnapshotSource = "live" | "rest" | null;

export const HEALTH_LIVE_MAX_AGE_MS = 35 * 60 * 1000;
export const HEALTH_REST_MAX_AGE_MS = 2 * 60 * 1000;
export const HEALTH_CLAIM_FRESHNESS_MS = 36 * 60 * 60 * 1000;
export const WHOOP_CONNECTION_FRESHNESS_MS = 36 * 60 * 60 * 1000;
export const HEVY_CONNECTION_FRESHNESS_MS = 6 * 60 * 60 * 1000;

type SnapshotLike = {
  generatedAt?: string | null;
  substances?: unknown;
  recommendation?: any;
  recommendationHistory?: any;
  readiness?: any;
  connections?: any;
  whoop?: any;
  dataQuality?: any;
};

function snapshotAgeMs(snapshot: SnapshotLike | null | undefined, nowMs: number): number | null {
  const generatedMs = snapshot?.generatedAt ? Date.parse(snapshot.generatedAt) : NaN;
  if (!Number.isFinite(generatedMs)) return null;
  return Math.max(0, nowMs - generatedMs);
}

export function isRecentHealthSnapshot(
  snapshot: SnapshotLike | null | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  const age = snapshotAgeMs(snapshot, nowMs);
  return age != null && age <= maxAgeMs;
}

function enrichRecommendation(liveValue: any, privateValue: any) {
  if (!liveValue || !privateValue || liveValue.id !== privateValue.id) return liveValue;
  return { ...privateValue, ...liveValue };
}

function mergeCurrentPrivateDetails<T extends SnapshotLike>(base: T, rest: T): T {
  const recommendation = enrichRecommendation(base.recommendation, rest.recommendation);
  const recommendationHistory = enrichRecommendation(base.recommendationHistory, rest.recommendationHistory);
  const readinessRecommendation = enrichRecommendation(
    base.readiness?.recommendation,
    rest.readiness?.recommendation
  );
  return {
    ...base,
    ...(rest.substances === undefined ? {} : { substances: rest.substances }),
    recommendation,
    recommendationHistory,
    readiness: base.readiness
      ? { ...base.readiness, recommendation: readinessRecommendation }
      : base.readiness,
  };
}

function ageMs(value: unknown, nowMs: number): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

function adjustedConnection(connection: any, maxHealthyAgeMs: number, nowMs: number) {
  if (!connection || connection.status !== "healthy") return connection;
  const age = ageMs(connection.lastSuccessAt, nowMs);
  if (age != null && age <= maxHealthyAgeMs) return connection;
  return {
    ...connection,
    status: "stale",
    detail: "Previously connected, but fresh source data is unavailable",
  };
}

function adjustedRecovery(metric: any, healthy: boolean, nowMs: number) {
  if (!metric) return metric;
  const age = ageMs(metric.asOf, nowMs);
  const freshness = metric.value == null || age == null
    ? "missing"
    : !healthy
      ? "broken"
      : age <= HEALTH_CLAIM_FRESHNESS_MS
        ? "fresh"
        : "stale";
  return { ...metric, freshness, ageHours: age == null ? null : +(age / 3_600_000).toFixed(1) };
}

function recommendationWarning(value: any, snapshot: SnapshotLike, nowMs: number): string | null {
  if (!value) return "not current";
  if (value.current === false) return value.warning || "not current";
  if (["dismissed", "expired", "completed", "review_needed"].includes(value.status)) {
    return value.status === "review_needed" ? "requires review" : "not current";
  }
  if (value.expiresAt) {
    const expiresMs = Date.parse(value.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return "expired";
  }
  const inputsAge = ageMs(value.inputsAsOf, nowMs);
  if (inputsAge == null || inputsAge > HEALTH_CLAIM_FRESHNESS_MS) return "inputs are stale";
  const provenance = JSON.stringify(value.provenance ?? []).toLowerCase();
  for (const source of ["whoop", "hevy"] as const) {
    if (provenance.includes(source) && snapshot.connections?.[source]?.status !== "healthy") {
      return `${source === "whoop" ? "WHOOP" : "Hevy"} evidence is ${snapshot.connections?.[source]?.status ?? "unavailable"}`;
    }
  }
  return null;
}

export function adjustHealthClaimCurrency<T extends SnapshotLike>(snapshot: T, nowMs: number): T {
  const connections = snapshot.connections
    ? {
        ...snapshot.connections,
        whoop: adjustedConnection(snapshot.connections.whoop, WHOOP_CONNECTION_FRESHNESS_MS, nowMs),
        hevy: adjustedConnection(snapshot.connections.hevy, HEVY_CONNECTION_FRESHNESS_MS, nowMs),
      }
    : snapshot.connections;
  const currencySnapshot = { ...snapshot, connections };
  const whoopHealthy = connections?.whoop?.status === "healthy";
  const originalRecovery = snapshot.whoop?.recovery ?? snapshot.readiness?.recovery;
  const recovery = adjustedRecovery(originalRecovery, whoopHealthy, nowMs);
  const recoveryCurrent = whoopHealthy && recovery?.value != null && recovery?.freshness === "fresh";

  const activeRecommendation = snapshot.recommendation;
  const warning = activeRecommendation ? recommendationWarning(activeRecommendation, currencySnapshot, nowMs) : null;
  const recommendation = activeRecommendation && !warning
    ? { ...activeRecommendation, current: true, inputAgeHours: +(Math.max(0, nowMs - Date.parse(activeRecommendation.inputsAsOf)) / 3_600_000).toFixed(1) }
    : null;
  const historyBase = snapshot.recommendationHistory;
  const recommendationHistory = activeRecommendation
    ? warning
      ? { ...(historyBase?.id === activeRecommendation.id ? historyBase : activeRecommendation), current: false, warning }
      : historyBase?.id === activeRecommendation.id
        ? { ...historyBase, current: true, warning: null, inputAgeHours: recommendation.inputAgeHours }
        : historyBase
    : historyBase
      ? { ...historyBase, current: false, warning: historyBase.warning || "not current" }
      : null;
  const readinessAvailable = !!snapshot.readiness?.available && recoveryCurrent;
  const warnings = [...(snapshot.dataQuality?.warnings ?? [])];
  if (connections?.whoop?.status === "stale" && !warnings.some((item:unknown) => String(item).includes("WHOOP stale"))) warnings.push("WHOOP stale");
  if (connections?.hevy?.status === "stale" && !warnings.some((item:unknown) => String(item).includes("Hevy stale"))) warnings.push("Hevy stale");
  if (warning && !warnings.some((item:unknown) => String(item).includes("Latest recommendation is not current"))) warnings.push(`Latest recommendation is not current: ${warning}`);
  if (!recoveryCurrent && !warnings.some((item:unknown) => String(item).includes("readiness claims are withheld"))) warnings.push("No fresh readiness evidence; readiness claims are withheld");
  const qualityStatus = snapshot.dataQuality?.status === "good" && (connections?.whoop?.status === "stale" || connections?.hevy?.status === "stale")
    ? "limited"
    : snapshot.dataQuality?.status;

  return {
    ...snapshot,
    connections,
    ...(snapshot.dataQuality ? { dataQuality: { ...snapshot.dataQuality, status: qualityStatus, warnings } } : {}),
    ...(snapshot.whoop ? { whoop: { ...snapshot.whoop, recovery } } : {}),
    recommendation,
    recommendationHistory,
    readiness: snapshot.readiness
      ? {
          ...snapshot.readiness,
          available: readinessAvailable,
          reason: readinessAvailable
            ? snapshot.readiness.reason
            : "Readiness withheld because WHOOP is not healthy or recovery evidence is stale, missing, or broken",
          recovery,
          recommendation,
        }
      : snapshot.readiness,
  };
}

export function selectCurrentHealthSnapshot<T extends SnapshotLike>({
  live,
  rest,
  transport,
  restRequestSucceeded,
  restLoading,
  nowMs,
}: {
  live: T | null | undefined;
  rest: T | null | undefined;
  transport: HealthTransportStatus;
  restRequestSucceeded: boolean;
  restLoading: boolean;
  nowMs: number;
}): { snapshot: T | null; source: HealthSnapshotSource } {
  const liveCurrent =
    transport === "open" && isRecentHealthSnapshot(live, nowMs, HEALTH_LIVE_MAX_AGE_MS);
  const restCurrent =
    restRequestSucceeded &&
    !restLoading &&
    isRecentHealthSnapshot(rest, nowMs, HEALTH_REST_MAX_AGE_MS);

  if (liveCurrent && live && restCurrent && rest) {
    const restIsNewest = Date.parse(rest.generatedAt as string) >= Date.parse(live.generatedAt as string);
    const base = restIsNewest ? rest : mergeCurrentPrivateDetails(live, rest);
    return { snapshot: adjustHealthClaimCurrency(base, nowMs), source: restIsNewest ? "rest" : "live" };
  }
  if (liveCurrent && live) return { snapshot: adjustHealthClaimCurrency(live, nowMs), source: "live" };
  if (restCurrent && rest) return { snapshot: adjustHealthClaimCurrency(rest, nowMs), source: "rest" };
  return { snapshot: null, source: null };
}
