import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { recordAgentEvent } from "@/lib/agents";
import type { CoffeeChat, RecruitingClub } from "@/lib/stern-types";
import { newBatchId } from "./audit";
import { upsertCalendar } from "./apply";
import { observeCoffeeChat } from "./coffee";
import { addTouchpoint, observePersonStatus, peopleWrite } from "./people";
import { toggleChecklist } from "./recruiting";
import { automationJob, automationSource, accountsToScan, NYU_ACCOUNT, type AutomationSource } from "./automation-source";
import { runRulesPass } from "./rules-pass";
export function runSternCalendarSync(options: { source?: AutomationSource; now?: Date; dryRun?: boolean } = {}) {
  return automationJob(async () => {
    const counts = { accounts: 0, events: 0, failures: 0, errors: [] as string[] };
    if (process.env.STERN_LLM_MODE === "off" && !options.source) return counts;
    const db = getDb(), source = options.source || automationSource(), now = options.now || new Date();
    // Seven days of history lets missed scans complete chats; seven days ahead schedules the coming week.
    const from = new Date(now.getTime() - 7 * 86400000).toISOString(), to = new Date(now.getTime() + 7 * 86400000).toISOString();
    const batchId = newBatchId("calendar"), run = `stern-calendar-${crypto.randomUUID()}`;
    const emit = (kind: string, status: string) => recordAgentEvent({ agent: "stern-automation", run, kind, status, summary: `Stern calendar sync ${kind}`, detail: JSON.stringify(counts), triggerType: "scheduler", triggerSource: "Stern calendar sync" });
    emit("started", "running");
    try {
      for (const account of accountsToScan().filter(email => NYU_ACCOUNT.test(email))) {
        counts.accounts++;
        try {
          const events = await source.calendar(account, from, to);
          for (const event of events) {
            if (event.status === "cancelled") continue;
            if (event.attendees?.some(a => a.email.toLowerCase() === account && a.responseStatus === "declined")) continue;
            const start = event.start?.dateTime || event.start?.date || "", end = event.end?.dateTime || event.end?.date || "";
            if (!event.id || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) continue;
            const attendees = (event.attendees || []).filter(a => a.responseStatus !== "declined").map(a => a.email.toLowerCase());
            const title = event.summary || "", lower = title.toLowerCase();
            const audit = { batchId, source: "auto_calendar", evidenceType: "calendar", evidenceExcerpt: title };
            peopleWrite(() => {
              const chats = db.prepare(`SELECT ch.* FROM coffee_chats ch JOIN people p ON p.id=ch.person_id JOIN stern_clubs c ON c.id=ch.club_id JOIN stern_processes s ON s.id=c.process_id WHERE p.archived=0 AND c.status<>'archived' AND s.status='active' AND ch.state NOT IN ('thank_you_sent','declined') ORDER BY ch.id DESC`).all() as CoffeeChat[];
              // Retain historical event identity after a thank-you; do not relink it to a newer chat.
              const linked = db.prepare("SELECT ch.* FROM stern_calendar_events e JOIN coffee_chats ch ON ch.id=e.coffee_chat_id JOIN people p ON p.id=ch.person_id JOIN stern_clubs c ON c.id=ch.club_id JOIN stern_processes s ON s.id=c.process_id WHERE e.account=? AND e.event_id=? AND p.archived=0 AND c.status<>'archived' AND s.status='active'").get(account, event.id) as CoffeeChat | undefined;
              const chat = linked || chats.find(ch => {
                const p = db.prepare("SELECT email,email_alt FROM people WHERE id=?").get(ch.person_id) as { email: string; email_alt: string };
                return attendees.includes(p.email.toLowerCase()) || !!p.email_alt && attendees.includes(p.email_alt.toLowerCase());
              });
              const clubs = db.prepare("SELECT c.* FROM stern_clubs c JOIN stern_processes p ON p.id=c.process_id WHERE c.status<>'archived' AND p.status='active'").all() as RecruitingClub[];
              const club = clubs.find(c => lower.includes(c.name.toLowerCase()) || !!c.short_name && new RegExp(`\\b${c.short_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title));
              const course = (db.prepare("SELECT id,code,title FROM courses WHERE archived=0").all() as { id: number; code: string; title: string }[]).find(c => lower.includes(c.code.toLowerCase()) || !!c.title && lower.includes(c.title.toLowerCase()));
              const kind = chat ? "coffee_chat" : club && /interview/i.test(title) ? "interview" : club && /general meeting|info session/i.test(title) ? "club_meeting" : course ? "class" : "other";
              const program = kind === "interview" && club ? db.prepare("SELECT id FROM stern_programs WHERE club_id=? AND status='interview_invited' ORDER BY id DESC LIMIT 1").get(club.id) as { id: number } | undefined : undefined;
              upsertCalendar({ account, event_id: event.id, title, start_at: start, end_at: end, location: event.location || "", attendees: JSON.stringify(attendees), kind, person_id: chat?.person_id || 0, coffee_chat_id: chat?.id || 0, program_id: program?.id || 0, synced_at: nowIso() }, audit);
              if (chat && !["thank_you_sent", "declined"].includes(chat.state) && start.includes("T")) {
                const done = Date.parse(end) < now.getTime();
                observeCoffeeChat(chat.id, { state: done ? "done" : "scheduled", scheduled_at: start, location: event.location || "", calendar_event_id: event.id, ...(done ? { occurred_at: end } : {}) }, audit);
                addTouchpoint(chat.person_id, done ? "coffee_chat" : "calendar", { source: "calendar", occurred_at: done ? end : start, gmail_account: account, gmail_message_id: `calendar:${event.id}:${done ? "done" : "scheduled"}`, summary: title }, audit);
                if (done) observePersonStatus(chat.person_id, "chatted", audit);
              }
              if (kind === "club_meeting" && club && Date.parse(end) < now.getTime()) {
                const self = event.attendees?.find(a => a.email.toLowerCase() === account);
                if (self?.responseStatus === "accepted") {
                  const item = db.prepare("SELECT id FROM stern_checklist_items WHERE club_id=? AND key='general_meeting' AND program_id=0").get(club.id) as { id: number } | undefined;
                  if (item) toggleChecklist(item.id, true, audit);
                }
              }
            });
            counts.events++;
          }
        } catch (error) { counts.failures++; counts.errors.push(error instanceof Error ? error.message.slice(0, 200) : "Calendar account failed"); }
      }
      const rules = await runRulesPass({ now, audit: { batchId, source: "auto_calendar", evidenceType: "calendar" } });
      counts.errors.push(...rules.errors);
      emit("calendar_sync", "running");
      emit(counts.failures || counts.errors.length ? "failed" : "completed", counts.failures || counts.errors.length ? "failed" : "completed");
      return counts;
    } catch (error) { emit("failed", "failed"); throw error; }
  });
}
