export const HEVY_ERROR_CODES = [
  "HEVY_HTTP_ERROR",
  "HEVY_SCHEMA_ERROR",
  "HEVY_AUTH_ERROR",
  "HEVY_SYNC_TIMEOUT",
  "HEVY_SYNC_DEADLINE",
  "HEVY_PAGINATION_ERROR",
  "HEVY_SESSION_CHANGED",
  "HEVY_SYNC_FAILED",
] as const;

export type HevyErrorCode = (typeof HEVY_ERROR_CODES)[number];

const CODES = new Set<string>(HEVY_ERROR_CODES);

export class HevySyncError extends Error {
  constructor(readonly code: HevyErrorCode) {
    super(code);
    this.name = "HevySyncError";
  }
}

export function sanitizeHevyError(value: unknown): HevyErrorCode | null {
  const candidate = value instanceof HevySyncError
    ? value.code
    : value instanceof Error
      ? value.message
      : value;
  return typeof candidate === "string" && CODES.has(candidate)
    ? (candidate as HevyErrorCode)
    : candidate == null
      ? null
      : "HEVY_SYNC_FAILED";
}

export function hevyConnectionDetail(error: HevyErrorCode | null): string | null {
  switch (error) {
    case "HEVY_AUTH_ERROR":
      return "Hevy authorization failed; update the API key in Connections";
    case "HEVY_SCHEMA_ERROR":
      return "Hevy returned data in an unsupported format";
    case "HEVY_SYNC_TIMEOUT":
    case "HEVY_SYNC_DEADLINE":
      return "Hevy sync timed out; retry from Connections";
    case "HEVY_PAGINATION_ERROR":
      return "Hevy sync exceeded a safety limit";
    case "HEVY_SESSION_CHANGED":
      return "Hevy connection changed during sync; staged results were discarded";
    case "HEVY_HTTP_ERROR":
      return "Hevy API request failed; retry from Connections";
    case "HEVY_SYNC_FAILED":
      return "Hevy sync failed; retry from Connections";
    default:
      return null;
  }
}
