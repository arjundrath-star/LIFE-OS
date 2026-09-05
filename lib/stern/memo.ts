import { getDb, kvGet } from "@/db";
import { vendingSnapshot } from "@/lib/vending";
import { pokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import { careerSnapshot } from "@/lib/career";
import type { SternMemo } from "@/lib/stern-types";
import { sternSnapshot } from "./snapshot";
import { nyDayBounds, nyDateKey, nyClock, nyWallTime, dayWindowSql, dayWindowParams } from "./time";
import { reminderChats, replyOwed, thankYouOwed, reminderPrograms } from "./reminders";
import { queueReminder, reminderMeta, reminderRow, changeReminder, reminderMessage } from "./reminder-store";
import { notificationDryRun, send, type SendOptions } from "./notify";
import { writeNotificationSetting } from "./notification-settings";
const line = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const section = (title: string, lines: string[], empty: string) => `${title}\n${lines.length ? lines.map(value => `- ${line(value)}`).join("\n") : empty}`;
const clock = (at: string) => at.length === 10 ? "All day" : nyClock(new Date(at));

/** Deterministic and entirely local: the same domain snapshots used by their APIs, never HTTP. */
export function buildMemo(date: Date = new Date()): SternMemo {
  const stern = sternSnapshot(date), vending = vendingSnapshot(), pokemon = pokemonOpsSnapshot(date.toISOString()), career = careerSnapshot();
  const today = nyDayBounds(date), yesterday = nyDayBounds(date, -1);
  const calendar = getDb().prepare(`SELECT * FROM stern_calendar_events WHERE ${dayWindowSql("start_at")} ORDER BY start_at,id`).all(...dayWindowParams(today, today)) as { title: string; start_at: string; location: string; coffee_chat_id: number; program_id: number; kind: string }[];
  const schedule: { at: string; text: string }[] = [];
  const seen = new Set<string>();
  const addSchedule = (at: string, title: string, location: string) => {
    const normalized = line(title);
    const key = `${at.length === 10 ? at : new Date(at).toISOString()}:${normalized.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key); schedule.push({ at, text: `${clock(at)} ${normalized}${location ? ` — ${line(location)}` : ""}` });
  };
  for (const event of calendar) addSchedule(event.start_at, event.title, event.location);
  for (const meeting of stern.classes.schedule.filter(m => m.date === today.dateKey)) {
    if (calendar.some(e => e.kind === "class" && e.start_at.length > 10 && Date.parse(e.start_at) === Date.parse(meeting.start_at) && (e.title.toLowerCase().includes(meeting.code.toLowerCase()) || e.title.toLowerCase() === meeting.title.toLowerCase()))) continue;
    addSchedule(meeting.start_at, `${meeting.code} ${meeting.title}`, meeting.room);
  }
  const chats = reminderChats();
  const todayChats = chats.filter(ch => ch.state === "scheduled" && ch.scheduled_at && nyDateKey(ch.scheduled_at) === today.dateKey);
  for (const chat of todayChats) if (!calendar.some(e => e.coffee_chat_id === chat.id)) addSchedule(chat.scheduled_at, `Coffee chat with ${chat.person_name}`, chat.location);
  const interviews = reminderPrograms().filter(p => ["submitted", "interview_invited"].includes(p.status) && p.interview_at && nyDateKey(p.interview_at) === today.dateKey);
  for (const p of interviews) if (!calendar.some(e => e.program_id === p.id && e.kind === "interview")) addSchedule(p.interview_at, `Interview: ${p.club_name} — ${p.name} (dress: ${p.dress_code || "not provided"})`, p.interview_location);
  schedule.sort((a, b) => a.at.localeCompare(b.at));
  const deadlines = stern.recruiting.deadlines.filter(d => d.days >= 0 && d.days <= 7);
  const replies = chats.filter(replyOwed), thanks = chats.filter(ch => thankYouOwed(ch, date));
  const autoApplied = (getDb().prepare(`SELECT COUNT(DISTINCT batch_id) n FROM stern_audit_log WHERE source IN ('auto_email','auto_calendar','imessage') AND action <> 'undo' AND undone_at='' AND ${dayWindowSql("created_at")}`).get(...dayWindowParams(yesterday, yesterday)) as { n: number }).n;
  const careerDue = career.endeavors.filter(e => e.deadline && ["researching", "drafting", "submitted", "interviewing", "offer"].includes(e.status) && e.deadline >= today.dateKey && e.deadline <= nyDayBounds(date, 7).dateKey);
  const email = [
    `Stern daily memo — ${today.dateKey} (America/New_York)`,
    section("Today's schedule", schedule.map(s => s.text), "No classes, coffee chats, interviews, or calendar events scheduled today."),
    section("Deadlines within 7 days", deadlines.map(d => `${d.deadlineAt}: ${d.club} — ${d.name}`), "No open program deadlines within 7 days."),
    section("Reply owed", replies.map(ch => `${ch.person_name}: answer their coffee chat reply.`), "No coffee chat replies owed."),
    section("Thank-yous due", thanks.map(ch => `${ch.person_name}: send the thank-you draft${date.getTime() >= Date.parse(ch.occurred_at) + 22 * 3_600_000 ? " (urgent)" : ""}.`), "No thank-yous due."),
    section("Tasks due today", stern.tasks.dueToday.map(t => t.title), "No open tasks due today."),
    `Automation\n${stern.counts.suggestionsPending} pending suggestions.\n${autoApplied} auto-applied batches yesterday.`,
    `Business\n${vending.liveMachines} live machines; ${vending.needsRefill} need refill.\n${vending.stages.verbal_yes} verbal yes deals; ${vending.stages.placing} placements in progress.\n${pokemon.open_recommendations.length} open Pokemon operations recommendations; ${pokemon.kpis.in_transit_units} units in transit.`,
    section("Career", careerDue.map(e => `${e.deadline}: ${e.title} (${e.status})`), "No active career deadlines within 7 days.") + `\n${career.stats.pendingSuggestions} career suggestions pending.`,
  ].join("\n\n");
  const urgent = [
    ...replies.map(ch => `Reply to ${ch.person_name}.`),
    ...thanks.map(ch => `Thank ${ch.person_name} after your coffee chat.`),
    ...interviews.map(p => `${clock(p.interview_at)} interview: ${p.club_name}.`),
    ...calendar.filter(e => e.kind === "interview" && !interviews.some(p => p.id === e.program_id)).map(e => `${clock(e.start_at)} ${e.title}.`),
    ...deadlines.filter(d => d.days <= 1).map(d => `${d.days === 0 ? "Today" : "Tomorrow"}: ${d.club} — ${d.name} deadline.`),
    ...stern.tasks.dueToday.map(t => `Due today: ${t.title}.`),
    ...(stern.counts.suggestionsPending ? [`Review ${stern.counts.suggestionsPending} Stern suggestions.`] : []),
  ].map(line);
  const concise = urgent.length > 7 ? [...urgent.slice(0, 6), `${urgent.length - 6} more items in email.`] : urgent;
  return { date: today.dateKey, subject: `Daily memo — ${today.dateKey}`, email, imessage: [...(concise.length ? concise : ["No urgent Stern items today."]), "Full memo in email."].join("\n") };
}

/** Per-channel durable claims protect both the scheduler and a simultaneous manual CLI. */
export async function sendMemo(date = new Date(), options: SendOptions = {}) {
  const dryRun = notificationDryRun(options.dryRun);
  if (!dryRun && kvGet<string>("stern.memo_last_date") === nyDateKey(date)) return { skipped: true, reason: "already-sent" };
  const memo = buildMemo(date), audit = options.audit ?? reminderMeta();
  const deliveries = [];
  for (const channel of ["email", "imessage"] as const) {
    const fireAt = nyWallTime(memo.date).toISOString();
    const body = memo[channel];
    const queued = queueReminder({ rule: "memo", entity: `memo_${channel}`, entityId: 0, fireAt, channel,
      message: { key: `memo:${channel}:${memo.date}`, subject: memo.subject, body, urgent: false, scheduledAt: fireAt } }, audit);
    // A preview must not consume the real memo for the day. Failed/ambiguous real sends need review.
    if (!dryRun && queued.reminder.delivery_status === "skipped" && queued.reminder.error === "dry-run") {
      getDb().transaction(() => {
        const current = reminderRow(queued.reminder.id);
        if (current.delivery_status === "skipped" && current.error === "dry-run") changeReminder(current.id, { delivery_status: "pending", error: "", message: JSON.stringify({ ...reminderMessage(current), subject: memo.subject, body }) }, audit);
      }).immediate();
    }
    const stored = reminderMessage(reminderRow(queued.reminder.id));
    deliveries.push(await send({ channel, subject: stored.subject, body: stored.body, urgent: false, reminderId: queued.reminder.id }, { ...options, now: date, audit }));
  }
  if (!dryRun && deliveries.every(d => d.delivery_status === "sent")) {
    getDb().transaction(() => writeNotificationSetting("stern.memo_last_date", memo.date, audit)).immediate();
  }
  return { memo, deliveries, skipped: false };
}
export async function tickMemo(now = new Date(), options: SendOptions = {}) {
  // Catch a missed minute within the 08:00 hour; no surprise afternoon catch-up memo.
  if (!nyClock(now).startsWith("08:")) return { skipped: true, reason: "outside-memo-hour" };
  return sendMemo(now, options);
}
