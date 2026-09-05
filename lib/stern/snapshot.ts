// Stern live snapshot: the payload behind GET /api/stern and the "stern" WebSocket channel.
// Built with SQL only. WP0 fills the counts and automation block; later packages fill the
// per-area pieces (they stay empty arrays until then, never fake data). Server-only.
import { tasksSnapshot } from "./tasks";
import { classesSnapshot } from "./classes";
import { networkSnapshot } from "./people";
import { getDb, nowIso } from "@/db";
import { getHub } from "@/server/live";
import { type SternSnapshot } from "@/lib/stern-types";

import { nyDayBounds, dayWindowSql, dayWindowParams, beforeDaySql } from "@/lib/stern/time";
export { nyDayBounds, nyDateKey, dayWindowSql, dayWindowParams, beforeDaySql } from "@/lib/stern/time";
import { recruitingSnapshot } from "@/lib/stern/recruiting";

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
  // Date-only values (YYYY-MM-DD) mean that whole New York day; instants with any offset compare
  // through julianday(). Both forms exist because fixtures carry -04:00 and app writes use Z.
  const between = dayWindowSql;

  const counts: SternSnapshot["counts"] = {
    people: count("SELECT COUNT(*) n FROM people WHERE archived = 0"),
    clubsInterested: count("SELECT COUNT(*) n FROM stern_clubs WHERE interested = 1 AND status <> 'archived'"),
    coffeeChatsOwed: count("SELECT COUNT(*) n FROM coffee_chats WHERE state = 'to_request' OR (state = 'reply_received' AND reply_needs_me = 1)"),
    replyOwed: count("SELECT COUNT(*) n FROM coffee_chats WHERE reply_needs_me = 1 AND state NOT IN ('done','thank_you_sent','declined','no_reply')"),
    deadlines14d: count(
      `SELECT COUNT(*) n FROM stern_programs WHERE status IN ('open','drafting','not_open') AND ${between("app_deadline_at")}`,
      ...dayWindowParams(today, in14)
    ),
    tasksDueToday: count(`SELECT COUNT(*) n FROM stern_tasks WHERE status = 'open' AND ${between("due_at")}`, ...dayWindowParams(today, today)),
    tasksOverdue: count(`SELECT COUNT(*) n FROM stern_tasks WHERE status = 'open' AND ${beforeDaySql("due_at")}`, today.dateKey, today.startIso),
    followUpsOwed: count("SELECT COUNT(*) n FROM people WHERE archived = 0 AND status = 'follow_up_owed'"),
    suggestionsPending: count("SELECT COUNT(*) n FROM stern_suggestions WHERE state = 'pending'"),
    assignmentsDueSoon: count(
      `SELECT COUNT(*) n FROM assignments WHERE status IN ('upcoming','in_progress') AND ${between("due_at")}`,
      ...dayWindowParams(today, in7)
    ),
  };

  const automation: SternSnapshot["automation"] = {
    lastScanAt: scalar<string>("SELECT MAX(last_checked) v FROM stern_scan_state WHERE last_checked <> ''") || "",
    lastCalendarSyncAt: scalar<string>("SELECT MAX(synced_at) v FROM stern_calendar_events WHERE synced_at <> ''") || "",
    accountsScanned: count("SELECT COUNT(*) n FROM stern_scan_state"),
    lastError: scalar<string>("SELECT last_error v FROM stern_scan_state WHERE last_error <> '' ORDER BY last_checked DESC LIMIT 1") || "",
    llmMode: process.env.STERN_LLM_MODE || "live",
  };

  const recruiting = recruitingSnapshot(now);
  counts.coffeeChatsOwed = recruiting.counts.coffeeChatsOwed;
  counts.deadlines14d = recruiting.counts.deadlines14d;

  const autoAppliedToday = db
    .prepare(
      `SELECT id, entity_type, entity_id, action, field, before_value, after_value, source, confidence, batch_id, undone_at, created_at
         FROM stern_audit_log
        WHERE source IN ('auto_email','auto_calendar','imessage') AND ${between("created_at")}
        ORDER BY id DESC LIMIT 20`
    )
    .all(...dayWindowParams(today, today)) as unknown[];
  autoAppliedToday.reverse();

  return {
    updatedAt: nowIso(),
    counts,
    automation,
    recruiting,
    network: networkSnapshot(),
    tasks: tasksSnapshot(now),
    classes: classesSnapshot(now),
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
