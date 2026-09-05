// Stern live snapshot: the payload behind GET /api/stern and the "stern" WebSocket channel.
// Built with SQL only. WP0 fills the counts and automation block; later packages fill the
// per-area pieces (they stay empty arrays until then, never fake data). Server-only.
import { networkSnapshot } from "./people";
import { getDb, nowIso } from "@/db";
import { getHub } from "@/server/live";
import { STERN_TIMEZONE, type SternSnapshot } from "@/lib/stern-types";

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

function count(sql: string, ...params: unknown[]): number {
  const row = getDb().prepare(sql).get(...(params as any[])) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function scalar<T = string>(sql: string, ...params: unknown[]): T | null {
  const row = getDb().prepare(sql).get(...(params as any[])) as { v: T | null } | undefined;
  return row?.v ?? null;
}

export function sternSnapshot(now: Date = new Date()): SternSnapshot {
  const db = getDb();
  const today = nyDayBounds(now);
  const in14 = nyDayBounds(now, 14);
  const in7 = nyDayBounds(now, 7);
  // julianday() understands both 'Z' and '-04:00' ISO forms and date-only strings, so mixed
  // producers (fixtures with offsets, app writes in UTC) compare correctly.
  const between = (col: string) => `${col} <> '' AND julianday(${col}) >= julianday(?) AND julianday(${col}) < julianday(?)`;

  const counts: SternSnapshot["counts"] = {
    people: count("SELECT COUNT(*) n FROM people WHERE archived = 0"),
    clubsInterested: count("SELECT COUNT(*) n FROM stern_clubs WHERE interested = 1 AND status <> 'archived'"),
    coffeeChatsOwed: count("SELECT COUNT(*) n FROM coffee_chats WHERE state = 'to_request' OR (state = 'reply_received' AND reply_needs_me = 1)"),
    replyOwed: count("SELECT COUNT(*) n FROM coffee_chats WHERE reply_needs_me = 1 AND state NOT IN ('done','thank_you_sent','declined','no_reply')"),
    deadlines14d: count(
      `SELECT COUNT(*) n FROM stern_programs WHERE status IN ('open','drafting','not_open') AND ${between("app_deadline_at")}`,
      today.startIso,
      in14.endIso
    ),
    tasksDueToday: count(`SELECT COUNT(*) n FROM stern_tasks WHERE status = 'open' AND ${between("due_at")}`, today.startIso, today.endIso),
    tasksOverdue: count("SELECT COUNT(*) n FROM stern_tasks WHERE status = 'open' AND due_at <> '' AND julianday(due_at) < julianday(?)", today.startIso),
    followUpsOwed: count("SELECT COUNT(*) n FROM people WHERE archived = 0 AND status = 'follow_up_owed'"),
    suggestionsPending: count("SELECT COUNT(*) n FROM stern_suggestions WHERE state = 'pending'"),
    assignmentsDueSoon: count(
      `SELECT COUNT(*) n FROM assignments WHERE status IN ('upcoming','in_progress') AND ${between("due_at")}`,
      today.startIso,
      in7.endIso
    ),
  };

  const automation: SternSnapshot["automation"] = {
    lastScanAt: scalar<string>("SELECT MAX(last_checked) v FROM stern_scan_state WHERE last_checked <> ''") || "",
    lastCalendarSyncAt: scalar<string>("SELECT MAX(synced_at) v FROM stern_calendar_events WHERE synced_at <> ''") || "",
    accountsScanned: count("SELECT COUNT(*) n FROM stern_scan_state"),
    lastError: scalar<string>("SELECT last_error v FROM stern_scan_state WHERE last_error <> '' ORDER BY last_checked DESC LIMIT 1") || "",
    llmMode: process.env.STERN_LLM_MODE || "live",
  };

  const deadlines = db
    .prepare(
      `SELECT p.id, c.name AS club, c.id AS clubId, p.name, p.track, p.app_deadline_at AS deadlineAt, p.status
         FROM stern_programs p JOIN stern_clubs c ON c.id = p.club_id
        WHERE p.app_deadline_at <> '' AND p.status IN ('not_open','open','drafting') AND julianday(p.app_deadline_at) >= julianday(?)
        ORDER BY julianday(p.app_deadline_at) ASC, p.id ASC LIMIT 5`
    )
    .all(today.startIso) as unknown[];

  const autoAppliedToday = db
    .prepare(
      `SELECT id, entity_type, entity_id, action, field, before_value, after_value, source, confidence, batch_id, undone_at, created_at
         FROM stern_audit_log
        WHERE source IN ('auto_email','auto_calendar','imessage') AND ${between("created_at")}
        ORDER BY id DESC LIMIT 20`
    )
    .all(today.startIso, today.endIso) as unknown[];
  autoAppliedToday.reverse();

  return {
    updatedAt: nowIso(),
    counts,
    automation,
    recruiting: { process: null, clubs: [], deadlines },
    network: networkSnapshot(),
    tasks: { dueToday: [], overdue: [] },
    classes: { nextMeeting: null, dueSoon: [] },
    needsYou: [],
    autoAppliedToday,
    reminders: { lastMemoAt: scalar<string>("SELECT MAX(sent_at) v FROM stern_reminders WHERE rule_key = 'memo' AND sent_at <> ''") || "" },
  };
}

/** Rebuild the snapshot and push it on the "stern" channel. Routes call this after every mutation. */
export function broadcastStern(): SternSnapshot {
  const snapshot = sternSnapshot();
  getHub().broadcast("stern", snapshot);
  return snapshot;
}
