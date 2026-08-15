import crypto from "node:crypto";
import type { TriState } from "@/lib/health/types";

export class HealthValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function requiredText(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim()) throw new HealthValidationError(`${name} is required`);
  return value.trim().slice(0, max);
}

export function optionalText(value: unknown, max = 4000): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new HealthValidationError("text value must be a string");
  return value.trim().slice(0, max);
}

export function isoDateTime(value: unknown, name: string): string {
  const text = requiredText(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new HealthValidationError(`${name} must be an ISO date/time with an explicit timezone`);
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new HealthValidationError(`${name} must be an ISO date/time`);
  return new Date(ms).toISOString();
}

export function dayKey(value: unknown, name = "day"): string {
  const text = requiredText(value, name, 10);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== text) {
    throw new HealthValidationError(`${name} must be YYYY-MM-DD`);
  }
  return text;
}

export function dayInTimeZone(value: string, timeZone = process.env.HEALTH_TIMEZONE || "America/New_York"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HealthValidationError("date/time is invalid");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(date);
  const part = (type:string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function nullableNumber(value: unknown, name: string, options: { min?: number; max?: number; integer?: boolean } = {}): number | null {
  if (value === undefined || value === null || value === "unknown" || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new HealthValidationError(`${name} must be numeric or unknown`);
  if (options.integer && !Number.isInteger(n)) throw new HealthValidationError(`${name} must be an integer`);
  if (options.min !== undefined && n < options.min) throw new HealthValidationError(`${name} must be >= ${options.min}`);
  if (options.max !== undefined && n > options.max) throw new HealthValidationError(`${name} must be <= ${options.max}`);
  return n;
}

export function triState(value: unknown, name: string): TriState {
  if (value === undefined || value === null || value === "unknown" || value === "") return null;
  if (value === true || value === "true" || value === "yes" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "no" || value === "0" || value === 0) return false;
  throw new HealthValidationError(`${name} must be true, false, or unknown`);
}

export function boolInt(value: TriState): number | null { return value == null ? null : value ? 1 : 0; }
export function boundedId(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  return nullableNumber(value, name, { min: 1, integer: true });
}

export function assertRange(low: number | null, high: number | null, selected: number | null, label: string): void {
  if (low != null && high != null && low > high) throw new HealthValidationError(`${label} low cannot exceed high`);
  if (selected != null && ((low != null && selected < low) || (high != null && selected > high))) {
    throw new HealthValidationError(`${label} selected must fall inside the estimate range`);
  }
}

export function stableKey(prefix: string, value: unknown): string {
  const canonical=(input:unknown):unknown=>Array.isArray(input)?input.map(canonical):input&&typeof input==="object"?Object.fromEntries(Object.entries(input as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):input;
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 32)}`;
}
