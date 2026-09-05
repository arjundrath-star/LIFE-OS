import { STERN_TIMEZONE } from "@/lib/stern-types";

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function tzParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour === 24 ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}

/** Offset (ms) of the zone at `date`: local wall clock minus UTC. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = tzParts(date, timeZone);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

function localMidnightUtc(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  instant = guess - zoneOffsetMs(new Date(instant), timeZone); // one DST re-correction
  return instant;
}

export type DayBounds = { startIso: string; endIso: string; dateKey: string };

/**
 * [start, end) of the America/New_York calendar day containing `now`, shifted by `dayOffset`
 * days. dateKey is that local date as YYYY-MM-DD. Reusable by WP1 deadline math and WP4 buckets.
 */
export function nyDayBounds(now: Date | string | number = new Date(), dayOffset = 0, timeZone = STERN_TIMEZONE): DayBounds {
  const date = now instanceof Date ? now : new Date(now);
  const p = tzParts(date, timeZone);
  const start = localMidnightUtc(p.y, p.m, p.d + dayOffset, timeZone);
  const end = localMidnightUtc(p.y, p.m, p.d + dayOffset + 1, timeZone);
  const local = tzParts(new Date(start), timeZone);
  const dateKey = `${local.y}-${String(local.m).padStart(2, "0")}-${String(local.d).padStart(2, "0")}`;
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(), dateKey };
}

/** Local NY date key for any instant (YYYY-MM-DD). */
export function nyDateKey(now: Date | string | number = new Date()): string {
  return nyDayBounds(now).dateKey;
}


/** Date-only values already represent a local calendar day. */
export function localDateKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : nyDateKey(value);
}

/** Calendar-date deadlines mean the end of that NY day; instants retain their offset. */
export function deadlineInstant(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(nyDayBounds(`${value}T12:00:00Z`).endIso) - 1;
  }
  return Date.parse(value);
}
export function deadlineDays(value: string, now: Date = new Date()): number {
  const dateKey = localDateKey(value);
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${nyDateKey(now)}T00:00:00Z`)) / 86400000);
}
export function validDate(value: string): boolean {
  if (!value) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (value.length < 11 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !validDate(value.slice(0, 10))) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * SQL predicate for "column falls inside [start day, end day]" where the column may hold either a
 * date-only key (YYYY-MM-DD, meaning that whole New York day) or a full ISO instant with any offset.
 * Bind params in this order: startKey, endKey, startIso, endIso (endIso exclusive).
 */
export function dayWindowSql(col: string): string {
  return `(${col} <> '' AND ((length(${col}) = 10 AND ${col} >= ? AND ${col} <= ?) OR (length(${col}) > 10 AND julianday(${col}) >= julianday(?) AND julianday(${col}) < julianday(?))))`;
}
export function dayWindowParams(start: DayBounds, end: DayBounds): [string, string, string, string] {
  return [start.dateKey, end.dateKey, start.startIso, end.endIso];
}
/** SQL predicate for "column is before the given day" with the same date-only / instant split. Bind: dateKey, startIso. */
export function beforeDaySql(col: string): string {
  return `(${col} <> '' AND ((length(${col}) = 10 AND ${col} < ?) OR (length(${col}) > 10 AND julianday(${col}) < julianday(?))))`;
}

/** Resolve a New York wall time on a calendar date, correcting the offset across DST. */
export function nyWallTime(dateKey: string, time = "08:00"): Date {
  const wall = Date.parse(`${dateKey}T${time}:00Z`);
  let instant = wall - zoneOffsetMs(new Date(wall), STERN_TIMEZONE);
  instant = wall - zoneOffsetMs(new Date(instant), STERN_TIMEZONE);
  return new Date(instant);
}
export function nyClock(now: Date): string {
  const parts = tzParts(now, STERN_TIMEZONE);
  return `${String(parts.h).padStart(2, "0")}:${String(parts.mi).padStart(2, "0")}`;
}
