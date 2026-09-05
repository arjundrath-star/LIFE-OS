import { getDb } from "@/db";
import type { SternReminder, ReminderMessage, CoffeeChat, RecruitingProgram } from "@/lib/stern-types";
import { notificationSettings } from "./notification-settings";
import { deadlineInstant, nyDayBounds, nyDateKey, nyClock, nyWallTime, validDate } from "./time";
import { changeReminder, queueReminder, reminderMessage, reminderMeta, reminderRow } from "./reminder-store";
import { send, type SendOptions } from "./notify";
import { SternError } from "./errors";
const HOUR = 3_600_000;
const OPEN = new Set(["not_open", "open", "drafting"]);
const INTERVIEW = new Set(["submitted", "interview_invited"]);
export type DueChat = CoffeeChat & { person_name: string };
export function reminderChats(): DueChat[] {
  return getDb().prepare("SELECT ch.*,p.display_name person_name FROM coffee_chats ch JOIN people p ON p.id=ch.person_id WHERE p.archived=0").all() as DueChat[];
}
export function reminderPrograms(): (RecruitingProgram & { club_name: string })[] {
  return getDb().prepare(`SELECT p.*,c.name club_name FROM stern_programs p JOIN stern_clubs c ON c.id=p.club_id
    JOIN stern_processes s ON s.id=c.process_id WHERE s.status='active' AND c.status NOT IN ('archived','declined','rejected')`).all() as (RecruitingProgram & { club_name: string })[];
}
export function replyOwed(chat: CoffeeChat) { return !!chat.reply_needs_me && !["done", "thank_you_sent", "declined", "no_reply"].includes(chat.state); }
export function thankYouOwed(chat: CoffeeChat, now: Date) { return chat.state === "done" && !chat.thank_you_sent_at && Date.parse(chat.occurred_at) + 20 * HOUR <= now.getTime(); }

export function evaluateRules(now = new Date()) {
  const today = nyDayBounds(now), audit = reminderMeta();
  let inserted = 0;
  const add = (rule: string, entity: string, entityId: number, fire: Date, body: string, urgent = false, fingerprint = "", validUntil = "") => {
    if (!Number.isFinite(fire.getTime()) || fire > now || (validUntil && Date.parse(validUntil) <= now.getTime())) return;
    const fireAt = fire.toISOString();
    const message: ReminderMessage = { key: `${rule}:${entity}:${entityId}:${fireAt}`, subject: rule === "interview_eve" ? "Interview tomorrow" : "Stern reminder", body, urgent, scheduledAt: fireAt, fingerprint, validUntil };
    if (queueReminder({ rule, entity, entityId, fireAt, message }, audit).inserted) inserted++;
  };
  getDb().transaction(() => {
    for (const program of reminderPrograms()) {
      const dates = [
        ...(OPEN.has(program.status) ? [{ value: program.app_deadline_at, entity: "program_deadline", label: "Application deadline" }] : []),
        ...(INTERVIEW.has(program.status) ? [{ value: program.interview_at, entity: "program_interview", label: "Interview" }] : []),
      ];
      for (const { value, entity, label } of dates) {
        if (!value || !validDate(value) || deadlineInstant(value) < now.getTime()) continue;
        const date = value.length === 10 ? value : nyDateKey(value);
        for (const [offset, rule] of [[7, "deadline_t7"], [3, "deadline_t3"], [1, "deadline_t1"], [0, "deadline_day"]] as const) {
          const dueDay = nyDayBounds(`${date}T12:00:00Z`, -offset).dateKey;
          // Catch up within the applicable local day, never dump a week's old nudges at startup.
          if (dueDay !== today.dateKey) continue;
          add(rule, entity, program.id, nyWallTime(dueDay), `${label}: ${program.club_name} — ${program.name}, ${value}.`, false, value, new Date(Math.min(Date.parse(today.endIso), deadlineInstant(value) + 1)).toISOString());
        }
        if (entity === "program_interview") {
          const eve = nyDayBounds(`${date}T12:00:00Z`, -1).dateKey;
          if (eve === today.dateKey) add("interview_eve", entity, program.id, nyWallTime(eve, "18:00"),
            `Interview tomorrow: ${program.club_name} — ${program.name}, ${value}. Dress code: ${program.dress_code || "not provided"}. Location: ${program.interview_location || "not provided"}.`, false, value, new Date(deadlineInstant(value) + 1).toISOString());
        }
      }
    }
    for (const chat of reminderChats()) {
      const name = chat.person_name || "Contact";
      if (replyOwed(chat)) {
        const first = Date.parse(chat.reply_at) + HOUR / 2;
        if (now.getTime() >= first) {
          const slot = Math.floor((now.getTime() - first) / (4 * HOUR));
          add("reply_owed", "coffee_chat", chat.id, new Date(first + slot * 4 * HOUR), `Reply owed to ${name}. Open the coffee chat and answer their proposed times.`, true, chat.reply_at);
        }
      }
      if (thankYouOwed(chat, now)) {
        const urgent = now.getTime() >= Date.parse(chat.occurred_at) + 22 * HOUR;
        add("thank_you_due", "coffee_chat", chat.id, new Date(Date.parse(chat.occurred_at) + (urgent ? 22 : 20) * HOUR), `Send the thank-you draft to ${name} after your coffee chat.`, urgent, chat.occurred_at);
      }
      if (["requested", "no_reply"].includes(chat.state) && !chat.reply_at && !chat.last_follow_up_at) {
        add("no_reply_3d", "coffee_chat", chat.id, new Date(Date.parse(chat.requested_at) + 72 * HOUR), `No reply from ${name} after three days. Review and send the follow-up draft.`, false, chat.requested_at);
      }
    }
    const tasks = getDb().prepare("SELECT id,title,due_at FROM stern_tasks WHERE status='open' AND due_at<>''").all() as { id: number; title: string; due_at: string }[];
    for (const task of tasks) {
      if (!validDate(task.due_at)) continue;
      const date = task.due_at.length === 10 ? task.due_at : nyDateKey(task.due_at);
      if (date === today.dateKey) add("task_due", "task", task.id, nyWallTime(date), `Task due today: ${task.title}.`, false, task.due_at, today.endIso);
    }
    const pending = (getDb().prepare("SELECT COUNT(*) n FROM stern_suggestions WHERE state='pending'").get() as { n: number }).n;
    if (pending) add("suggestions_pending", "suggestions", 0, nyWallTime(today.dateKey), `${pending} Stern suggestion${pending === 1 ? "" : "s"} waiting for review.`, false, "", today.endIso);
  }).immediate();
  return { inserted, batchId: audit.batchId };
}

export function quietUntil(now: Date): Date | null {
  const settings = notificationSettings(), start = settings["stern.quiet_hours_start"], end = settings["stern.quiet_hours_end"];
  const clock = nyClock(now);
  const quiet = start === end ? false : start > end ? clock >= start || clock < end : clock >= start && clock < end;
  if (!quiet) return null;
  const day = nyDayBounds(now, start > end && clock >= start ? 1 : 0).dateKey;
  return nyWallTime(day, end);
}
function relevant(reminder: SternReminder, message: ReminderMessage, now: Date) {
  if (message.validUntil && Date.parse(message.validUntil) <= now.getTime()) return false;
  if (reminder.entity_type.startsWith("program_")) {
    const p = reminderPrograms().find(p => p.id === reminder.entity_id);
    return !!p && (reminder.entity_type === "program_deadline" ? OPEN.has(p.status) && p.app_deadline_at === message.fingerprint : INTERVIEW.has(p.status) && p.interview_at === message.fingerprint);
  }
  if (reminder.entity_type === "coffee_chat") {
    const ch = reminderChats().find(ch => ch.id === reminder.entity_id);
    if (!ch) return false;
    if (reminder.rule_key === "reply_owed") return replyOwed(ch) && ch.reply_at === message.fingerprint;
    if (reminder.rule_key === "thank_you_due") return thankYouOwed(ch, now) && ch.occurred_at === message.fingerprint && (message.urgent || now.getTime() < Date.parse(ch.occurred_at) + 22 * HOUR);
    return ["requested", "no_reply"].includes(ch.state) && !ch.reply_at && !ch.last_follow_up_at && ch.requested_at === message.fingerprint;
  }
  if (reminder.entity_type === "task") return !!getDb().prepare("SELECT 1 FROM stern_tasks WHERE id=? AND status='open' AND due_at=?").get(reminder.entity_id, message.fingerprint);
  if (reminder.entity_type === "suggestions") return !!getDb().prepare("SELECT 1 FROM stern_suggestions WHERE state='pending' LIMIT 1").get();
  return true;
}
export async function dispatchDue(now = new Date(), options: SendOptions = {}) {
  const rows = getDb().prepare("SELECT * FROM stern_reminders WHERE delivery_status IN ('pending','snoozed') AND julianday(fire_at)<=julianday(?) ORDER BY fire_at,id LIMIT 100").all(now.toISOString()) as SternReminder[];
  const result = { sent: 0, failed: 0, skipped: 0, snoozed: 0 };
  const audit = options.audit ?? reminderMeta();
  for (const item of rows) {
    const message = reminderMessage(item);
    // Recheck status in the same transaction as every pre-send state change.
    const ready = getDb().transaction(() => {
      if (!["pending", "snoozed"].includes(reminderRow(item.id).delivery_status)) return false;
      if (!relevant(item, message, now)) { changeReminder(item.id, { delivery_status: "skipped", error: "no-longer-applicable" }, audit); result.skipped++; return false; }
      const until = !message.urgent && quietUntil(now);
      if (until) { changeReminder(item.id, { delivery_status: "snoozed", fire_at: until.toISOString(), error: "quiet-hours" }, audit); result.snoozed++; return false; }
      return true;
    }).immediate();
    if (!ready) continue;
    try {
      const delivery = await send({ channel: item.channel, subject: message.subject, body: message.body, urgent: message.urgent, reminderId: item.id, expectedFireAt: item.fire_at }, { ...options, now, audit });
      if (delivery.delivery_status in result) result[delivery.delivery_status as keyof typeof result]++;
    } catch (error) {
      // Invalid legacy content must not stop the rest of the queue.
      changeReminder(item.id, { delivery_status: "failed", error: error instanceof SternError ? error.message : "Notification dispatch failed" }, audit);
      result.failed++;
    }
  }
  return result;
}
export function snoozeReminder(id: number, until: unknown, now = new Date()) {
  if (typeof until !== "string" || !validDate(until) || until.length <= 10 || Date.parse(until) <= now.getTime()) throw new SternError(400, "until must be a future ISO timestamp with timezone");
  return getDb().transaction(() => {
    const reminder = reminderRow(id);
    if (!["pending", "snoozed"].includes(reminder.delivery_status)) throw new SternError(409, "Only pending reminders can be snoozed");
    return changeReminder(id, { fire_at: new Date(until).toISOString(), delivery_status: "snoozed", error: "manual-snooze" }, reminderMeta("manual"));
  }).immediate();
}
