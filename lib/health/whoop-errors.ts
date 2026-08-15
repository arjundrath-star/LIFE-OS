export const WHOOP_AUTH_ERROR_CODES = [
  "WHOOP_AUTH_FAILED",
  "WHOOP_AUTH_REFRESH_FAILED",
  "WHOOP_AUTH_PROFILE_CHECK_FAILED",
  "WHOOP_AUTH_SESSION_CHANGED",
] as const;

export const WHOOP_DATA_ERROR_CODES = [
  "WHOOP_DATA_PARTIAL_SYNC",
  "WHOOP_DATA_SYNC_FAILED",
  "WHOOP_DATA_SESSION_CHANGED",
] as const;

type WhoopAuthErrorCode = (typeof WHOOP_AUTH_ERROR_CODES)[number];
type WhoopDataErrorCode = (typeof WHOOP_DATA_ERROR_CODES)[number];

const AUTH_CODES = new Set<string>(WHOOP_AUTH_ERROR_CODES);
const DATA_CODES = new Set<string>(WHOOP_DATA_ERROR_CODES);

export function sanitizeWhoopAuthError(value: unknown): WhoopAuthErrorCode | null {
  return typeof value === "string" && AUTH_CODES.has(value)
    ? (value as WhoopAuthErrorCode)
    : value == null
      ? null
      : "WHOOP_AUTH_FAILED";
}

export function sanitizeWhoopDataError(value: unknown): WhoopDataErrorCode | null {
  return typeof value === "string" && DATA_CODES.has(value)
    ? (value as WhoopDataErrorCode)
    : value == null
      ? null
      : "WHOOP_DATA_SYNC_FAILED";
}

export function whoopConnectionDetail(authError: string | null, dataError: string | null): string | null {
  if (authError) return "WHOOP authorization needs attention; reconnect from Connections";
  if (dataError === "WHOOP_DATA_PARTIAL_SYNC") return "WHOOP data sync completed only partially; some current data is unavailable";
  if (dataError) return "WHOOP data sync failed; retry from Connections";
  return null;
}
