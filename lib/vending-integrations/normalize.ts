import crypto from "node:crypto";
import { VendingIntegrationError } from "./types";

export function text(value: unknown, max = 300): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return clean ? clean.slice(0, max) : null;
}

export function first(record: Record<string, unknown>, labels: readonly string[]): unknown {
  for (const label of labels) {
    const value = record[label];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Parse decimal major units without binary floating-point rounding. */
export function moneyToCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new VendingIntegrationError("INVALID_MONEY", "Provider returned an invalid monetary value", 502);
  }
  let raw = String(value).trim();
  const parenthesized = /^\(.*\)$/.test(raw);
  raw = raw.replace(/^\((.*)\)$/, "$1").replace(/[$,\s]/g, "");
  const match = /^(\-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match || parenthesized || match[1] === "-") {
    throw new VendingIntegrationError("INVALID_MONEY", "Provider returned an invalid monetary value", 502);
  }
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || "").padEnd(2, "0"));
  const centsBig = whole * 100n + fraction;
  if (centsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VendingIntegrationError("INVALID_MONEY", "Provider returned an invalid monetary value", 502);
  }
  return Number(centsBig);
}

export function optionalMoneyToCents(value: unknown): number | null {
  return value === undefined || value === null || value === "" ? null : moneyToCents(value);
}

export function positiveInteger(value: unknown, fallback = 1): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new VendingIntegrationError("INVALID_QUANTITY", "Provider returned an invalid quantity", 502);
  }
  return n;
}

export function optionalNonnegativeInteger(value: unknown, code = "INVALID_STOCK_SIGNAL"): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new VendingIntegrationError(code, "Provider returned an invalid stock signal", 502);
  }
  return n;
}

export function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === 1 || String(value).trim().toLowerCase() === "true") return true;
  if (value === false || value === 0 || String(value).trim().toLowerCase() === "false") return false;
  throw new VendingIntegrationError("INVALID_VEND_OUT_BIT", "Provider returned an invalid vend-out signal", 502);
}

export function utcIso(value: unknown): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new VendingIntegrationError("INVALID_TIMESTAMP", "Provider returned an invalid timestamp", 502);
    return value.toISOString();
  }
  const raw = text(value, 100);
  if (!raw) throw new VendingIntegrationError("INVALID_TIMESTAMP", "Provider returned an invalid timestamp", 502);

  let candidate = raw;
  // Exported, unzoned report timestamps are interpreted as UTC rather than server local time.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(raw);
  if (us) {
    let hour = Number(us[4] || 0);
    const ampm = us[7]?.toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    candidate = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${us[5] || "00"}:${us[6] || "00"}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(raw)) {
    candidate = raw.length === 10 ? `${raw}T00:00:00Z` : `${raw.replace(" ", "T")}Z`;
  }

  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) throw new VendingIntegrationError("INVALID_TIMESTAMP", "Provider returned an invalid timestamp", 502);
  const iso = new Date(ms).toISOString();
  const isoDate = /^(\d{4}-\d{2}-\d{2})/.exec(candidate)?.[1];
  if (isoDate && iso.slice(0, 10) !== isoDate) {
    throw new VendingIntegrationError("INVALID_TIMESTAMP", "Provider returned an invalid timestamp", 502);
  }
  return iso;
}

export function optionalUtcIso(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : utcIso(value);
}

export function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function requireExternalId(value: unknown, kind: string): string {
  const id = text(value, 200);
  if (!id) throw new VendingIntegrationError("MISSING_EXTERNAL_ID", `Provider ${kind} is missing its external ID`, 502);
  return id;
}

export function safeCurrency(value: unknown): string {
  const supplied = text(value, 20);
  if (!supplied) return "USD";
  const currency = supplied.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new VendingIntegrationError("INVALID_CURRENCY", "Provider returned an invalid currency code", 502);
  }
  return currency;
}
