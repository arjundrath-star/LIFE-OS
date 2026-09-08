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

/** Parse explicit instants or bounded natural wall times relative to the email's New York date. */
export function parseEventTime(text: string, referenceIso: string): { iso: string; confidence: number } | null {
  if (typeof text !== 'string' || !text.trim() || !Number.isFinite(Date.parse(referenceIso))) return null;
  const raw = text.trim();
  if (validDate(raw) && raw.includes('T')) return { iso: raw, confidence: 1 };
  const reference = nyDateKey(referenceIso);
  let day = '', hour = 0, minute = 0, second = 0, confidence = .9;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?$/);
  if (iso) { day = iso[1]; hour = +iso[2]; minute = +iso[3]; second = +(iso[4] || 0); confidence = .95; }
  else {
    const value = raw.toLowerCase().replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am').replace(/\b(\d{1,2})(?:\s+(?:or|and|to)\s+|\s*[-–,]\s*)(\d{1,2})\s*(am|pm)\b/g, '$1$3').replace(/\b(?:eastern(?: time)?|america\/new_york|edt|est|et)\b/g, '').trim();
    const clock = value.match(/(?:\bat\s+|\s|^)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/)
      || value.match(/(?:\bat\s+|\s|^)(\d{1,2}):(\d{2})(?!\d)/);
    if (!clock) return null;
    hour = +clock[1]; minute = +(clock[2] || 0);
    if (clock[3]) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (clock[3].startsWith('p') ? 12 : 0); }
    const numeric = value.match(/\b(?:(\d{4})-)?(\d{1,2})[/-](\d{1,2})(?:\/(\d{4}))?\b/);
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const named = value.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
    const month = named ? months.findIndex(m => m === named[1] || m.slice(0,3) === named[1] || (m === 'september' && named[1] === 'sept')) : -1;
    if (/\btomorrow\b/.test(value)) day = nyDayBounds(referenceIso, 1).dateKey;
    else if (/\btoday\b/.test(value)) day = reference;
    else if (numeric) day = `${numeric[1] || numeric[4] || reference.slice(0,4)}-${numeric[2].padStart(2,'0')}-${numeric[3].padStart(2,'0')}`;
    else if (named && month >= 0) day = `${named[3] || reference.slice(0,4)}-${String(month+1).padStart(2,'0')}-${named[2].padStart(2,'0')}`;
    else {
      const weekdays = ['sun','mon','tue','wed','thu','fri','sat'];
      const weekday = value.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/);
      if (!weekday) return null;
      let offset = (weekdays.indexOf(weekday[1]) - new Date(`${reference}T12:00Z`).getUTCDay() + 7) % 7;
      if (offset === 0 && (/\bnext\b/.test(value) || nyWallTime(reference, `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`).getTime() < Date.parse(referenceIso))) offset = 7;
      day = nyDayBounds(referenceIso, offset).dateKey; confidence = .8;
    }
  }
  if (!validDate(day) || hour > 23 || minute > 59 || second > 59) return null;
  const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const instant = new Date(nyWallTime(day, time).getTime() + second * 1000);
  // Reject nonexistent DST wall times instead of silently moving the appointment.
  if (nyDateKey(instant) !== day || nyClock(instant) !== time) return null;
  return { iso: instant.toISOString(), confidence };
}
