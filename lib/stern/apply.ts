import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { STERN_THRESHOLDS, type EmailClassification, type SternEmailMessage, type Person, type CoffeeChat, type RecruitingClub, type RecruitingProgram } from "@/lib/stern-types";
import { newBatchId, type AuditMeta } from "./audit";
import { insert, patch, row, type Row } from "./recruiting-write";
import { createPerson, addAffiliation, addTouchpoint, observePersonStatus, peopleWrite } from "./people";
import { createCoffeeChat, observeCoffeeChat } from "./coffee";
import { setInterested, upsertProgram, observeProgramStatus, reconcileThankYous } from "./recruiting";
import { automationSource, dryRunDefault, sternAccount, type AutomationSource } from "./automation-source";
import { ScopeMissing } from "@/lib/sources/google";
import { SternError } from "./errors";
import { nyDayBounds } from "./time";

export function addresses(value: string): string[] { return [...new Set((value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(s => s.toLowerCase()))]; }
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export function messageMeta(message: SternEmailMessage, cls: EmailClassification, source = "auto_email"): AuditMeta {
  return { batchId: newBatchId("email"), source, confidence: cls.confidence, evidenceType: "gmail", gmailAccount: message.gmail_account, gmailMessageId: message.gmail_message_id, evidenceExcerpt: cls.evidence_excerpt };
}
export type Effect = { kind: "coffee" | "program" | "newsletter" | "meeting" | "academic" | "tasks" | "review"; classification: EmailClassification } | { kind: "program_window"; programId: number; fields: Row } | { kind: "calendar_create"; intent: CalendarIntent };
export function effectsFor(cls: EmailClassification): Effect[] {
  const c = cls.category;
  if (c === "irrelevant") return [];
  const kind = /^(coffee_chat_|scheduling_|thank_you_sent|follow_up_sent|calendar_invite)/.test(c) ? "coffee"
    : /^club_(application|interview|result)/.test(c) ? "program"
    : c === "icc_newsletter" ? "newsletter" : c === "club_general_meeting" ? "meeting"
    : /^(brightspace_|course_announcement|exam_reminder)/.test(c) ? "academic" : c === "other_nyu" ? "tasks" : "review";
  return [{ kind, classification: cls }];
}
export function suggest(key: string, effects: Effect[], message: SternEmailMessage, audit: AuditMeta, type = "classification") {
  const existing = getDb().prepare("SELECT id FROM stern_suggestions WHERE dedupe_key=?").get(key) as { id: number } | undefined;
  if (existing) return existing.id;
  return insert("suggestion", { dedupe_key: key, suggestion_type: type, proposed_data: JSON.stringify(effects), gmail_account: message.gmail_account, gmail_message_id: message.gmail_message_id, evidence_subject: message.subject, evidence_excerpt: audit.evidenceExcerpt || "", confidence: audit.confidence || 0 }, audit);
}
function clubFor(name?: string | null): RecruitingClub | undefined {
  if (!name) return undefined;
  return getDb().prepare(`SELECT c.* FROM stern_clubs c JOIN stern_processes p ON p.id=c.process_id WHERE p.status='active' AND c.status<>'archived' AND (lower(c.name)=? OR lower(c.short_name)=?) ORDER BY c.id DESC LIMIT 1`).get(normalize(name), normalize(name)) as RecruitingClub | undefined;
}
function matchingProgram(club: RecruitingClub, cls: EmailClassification, audit: AuditMeta) {
  const track = cls.program_track || "exploratory";
  const matches = getDb().prepare("SELECT * FROM stern_programs WHERE club_id=? AND track=?").all(club.id, track) as RecruitingProgram[];
  if (matches.length > 1) throw new SternError(409, "Multiple programs match this club and track; review required");
  if (matches.length) return matches[0];
  const id = upsertProgram({ club_id: club.id, track, name: track === "exploratory" ? "Exploratory program" : "Teams program" }, audit);
  return row<RecruitingProgram>("program", id);
}
// WP4 owns the full classes/tasks domains. These minimal audited upserts obey their dedupe keys.
export function upsertAutomationTask(fields: Row & { dedupe_key: string; title: string }, audit: AuditMeta): number {
  const existing = getDb().prepare("SELECT id FROM stern_tasks WHERE dedupe_key=?").get(fields.dedupe_key) as { id: number } | undefined;
  if (existing) { patch("task", existing.id, fields, audit); return existing.id; }
  return insert("task", { source: "auto", ...fields }, audit);
}
function assignment(cls: EmailClassification, message: SternEmailMessage, courseId: number, audit: AuditMeta) {
  const input = cls.assignment!;
  if (!input.title) throw new SternError(400, "Assignment title missing");
  const key = `${normalize(cls.course_code!)}:${normalize(input.title)}`;
  const prior = getDb().prepare("SELECT id FROM assignments WHERE dedupe_key=?").get(key) as { id: number } | undefined;
  const fields: Row = { course_id: courseId, title: input.title, kind: input.kind || "other", source: "auto_email", dedupe_key: key, gmail_message_id: message.gmail_message_id };
  if (input.due_at) fields.due_at = input.due_at;
  if (input.points_possible != null) fields.points_possible = input.points_possible;
  if (cls.category === "brightspace_grade") {
    // The frozen classifier schema has no points_earned property. Only explicit numeric evidence qualifies.
    const grade = message.snippet.match(/(?:grade|score|points earned)\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i);
    if (!grade) throw new SternError(409, "Grade has no explicit earned/possible evidence");
    fields.points_earned = Number(grade[1]); fields.points_possible = Number(grade[2]); fields.status = "graded";
  }
  if (prior) { patch("assignment", prior.id, fields, audit); return prior.id; }
  return insert("assignment", fields, audit);
}
export type CalendarIntent = { chatId: number; personId: number; email: string; title: string; start: string; location: string; hash: string };
function coffeeEffect(message: SternEmailMessage, cls: EmailClassification, audit: AuditMeta): CalendarIntent[] {
  const db = getDb(), at = new Date(message.internal_date).toISOString(), club = clubFor(cls.club);
  const own = (db.prepare("SELECT email FROM google_accounts").all() as { email: string }[]).map(r => r.email.toLowerCase());
  const counterparts = (message.direction === "outbound" ? addresses(message.to_addrs) : addresses(message.from_addr)).filter(email => !own.includes(email));
  if (!counterparts.length) throw new SternError(409, "No counterpart in message headers");
  const intents: CalendarIntent[] = [];
  for (const email of counterparts) {
    const extracted = cls.people.find(p => p.email.toLowerCase() === email);
    let person = db.prepare("SELECT * FROM people WHERE lower(email)=? OR lower(email_alt)=?").get(email, email) as Person | undefined;
    if (!person) person = createPerson({ display_name: extracted?.name || email, email, org: club?.name || extracted?.club_or_org || "", how_met: "email", relationship_type: club ? "club_connect" : "general_connect", source: "auto_email" }, audit).person;
    if (person.archived) throw new SternError(409, "Person is archived");
    if (club) addAffiliation(person.id, { club_id: club.id, role: extracted?.role || "", is_eboard: !!extracted?.is_eboard, relevant_for_recruiting: true }, audit);
    let chat = db.prepare("SELECT * FROM coffee_chats WHERE person_id=? AND (?=0 OR club_id=?) ORDER BY (gmail_thread_id=?) DESC,id DESC LIMIT 1").get(person.id, club?.id || 0, club?.id || 0, message.gmail_thread_id) as CoffeeChat | undefined;
    if (!chat) {
      if (!club) throw new SternError(409, "No club or existing coffee chat matches");
      chat = row<CoffeeChat>("coffee_chat", createCoffeeChat(person.id, club.id, 0, audit));
    }
    const c = cls.category;
    const kind = c === "follow_up_sent" ? "follow_up_sent" : c === "thank_you_sent" ? "thank_you_sent" : c === "calendar_invite" ? "calendar" : message.direction === "outbound" ? "email_sent" : "email_received";
    addTouchpoint(person.id, kind, { source: "gmail", gmail_account: message.gmail_account, gmail_message_id: message.gmail_message_id, occurred_at: at, summary: cls.summary, detail: JSON.stringify({ coffee_chat_id: chat.id }) }, audit);
    const laterReply = db.prepare("SELECT 1 FROM stern_email_messages WHERE gmail_account=? AND gmail_thread_id=? AND direction='outbound' AND internal_date>? LIMIT 1").get(message.gmail_account, message.gmail_thread_id, message.internal_date);
    const needsReply = message.direction === "inbound" && !laterReply && (cls.requires_reply_from_me || !!cls.proposed_times?.length) ? 1 : 0;
    const update: Parameters<typeof observeCoffeeChat>[1] = { gmail_thread_id: message.gmail_thread_id };
    if (cls.proposed_times?.length) update.prep_notes = `${chat.prep_notes}${chat.prep_notes ? "\n" : ""}Proposed: ${cls.proposed_times.join(", ")}`;
    if (c === "coffee_chat_request_sent") { update.state = "requested"; update.requested_at = at; observePersonStatus(person.id, "reached_out", audit); }
    if (c === "coffee_chat_reply_positive") { update.state = "reply_received"; update.reply_at = at; update.reply_needs_me = needsReply; observePersonStatus(person.id, "replied", audit); }
    if (c === "scheduling_proposal") { update.reply_needs_me = needsReply; if (message.direction === "inbound") { update.state = "reply_received"; update.reply_at = at; } }
    if (c === "coffee_chat_reply_negative") { update.state = "declined"; update.reply_at = at; }
    if (c === "follow_up_sent") { update.last_follow_up_at = at; if (chat.state === "to_request" || chat.state === "no_reply") { update.state = "requested"; update.requested_at = chat.requested_at || at; } }
    if (c === "thank_you_sent") { update.state = "thank_you_sent"; update.thank_you_sent_at = at; observePersonStatus(person.id, "chatted", audit); }
    if (["scheduling_confirmed", "calendar_invite", "coffee_chat_reply_positive"].includes(c) && cls.confirmed_time) {
      update.state = "scheduled"; update.scheduled_at = cls.confirmed_time; update.location = cls.location || "";
      const hash = crypto.createHash("sha256").update(`${chat.id}:${new Date(cls.confirmed_time).toISOString()}`).digest("hex");
      if (c === "calendar_invite") {
        const id = `invite:${message.content_hash}`;
        upsertCalendar({ account: message.gmail_account, event_id: id, title: message.subject, start_at: cls.confirmed_time, end_at: new Date(Date.parse(cls.confirmed_time) + 30 * 60000).toISOString(), location: cls.location || "", attendees: JSON.stringify([email]), kind: "coffee_chat", person_id: person.id, coffee_chat_id: chat.id, synced_at: nowIso() }, audit);
        update.calendar_event_id = chat.calendar_event_id || id;
      } else if (!chat.calendar_event_id || chat.calendar_event_id.startsWith("dry-run:") || Date.parse(chat.scheduled_at) !== Date.parse(cls.confirmed_time)) intents.push({ chatId: chat.id, personId: person.id, email, title: `Coffee chat with ${person.display_name}`, start: cls.confirmed_time, location: cls.location || "", hash });
    }
    observeCoffeeChat(chat.id, update, audit);
    if (c === "thank_you_sent") reconcileThankYous(chat.club_id, audit);
    const draftKind = c === "coffee_chat_request_sent" ? "request" : c === "thank_you_sent" ? "thank_you" : c === "follow_up_sent" ? "follow_up" : c === "scheduling_confirmed" && message.direction === "outbound" ? "reply_scheduling" : "";
    if (draftKind) for (const draft of db.prepare("SELECT id FROM stern_drafts WHERE coffee_chat_id=? AND kind=? AND state NOT IN ('sent_detected','discarded')").all(chat.id, draftKind) as { id: number }[]) patch("draft", draft.id, { state: "sent_detected" }, audit);
  }
  return intents;
}
export function upsertCalendar(fields: Row & { account: string; event_id: string }, audit: AuditMeta) {
  const existing = getDb().prepare("SELECT id FROM stern_calendar_events WHERE account=? AND event_id=?").get(fields.account, fields.event_id) as { id: number } | undefined;
  if (existing) { patch("calendar_event", existing.id, fields, audit); return existing.id; }
  return insert("calendar_event", fields, audit);
}
function executeEffects(effects: Effect[], message: SternEmailMessage, audit: AuditMeta): CalendarIntent[] {
  const db = getDb(), intents: CalendarIntent[] = [];
  for (const effect of effects) {
    if (effect.kind === "calendar_create") {
      const chat = row<CoffeeChat>("coffee_chat", effect.intent.chatId);
      if (chat.state !== "scheduled" || Date.parse(chat.scheduled_at) !== Date.parse(effect.intent.start)) throw new SternError(409, "Calendar intent is stale; review the chat schedule");
      if (!chat.calendar_event_id || chat.calendar_event_id.startsWith("dry-run:")) intents.push(effect.intent);
      continue;
    }
    if (effect.kind === "program_window") { upsertProgram({ id: effect.programId, ...effect.fields }, audit); continue; }
    const cls = effect.classification, club = clubFor(cls.club), deadlines = cls.deadline_mentions || [];
    if (effect.kind === "coffee") { intents.push(...coffeeEffect(message, cls, audit)); continue; }
    if (effect.kind === "program") {
      if (!club) throw new SternError(409, "Unknown club");
      if (!club.interested) setInterested(club.id, true, audit);
      const program = matchingProgram(club, cls, audit);
      const status = cls.category === "club_application_confirmation" ? "submitted" : cls.category === "club_interview_invite" ? "interview_invited" : cls.category === "club_result_accepted" ? "accepted" : "rejected";
      if (status === "interview_invited") {
        const dress = message.snippet.match(/(?:dress(?: code)?|attire)\s*:\s*([^\n.]+)/i)?.[1]?.trim() || message.snippet.match(/\b(business casual|business formal|smart casual)\b/i)?.[1] || "";
        upsertProgram({ id: program.id, interview_at: cls.confirmed_time || "", interview_location: cls.location || "", dress_code: dress }, audit);
        if (cls.confirmed_time) upsertAutomationTask({ title: `Prep for ${club.name} interview`, due_at: nyDayBounds(cls.confirmed_time, -1).dateKey, club_id: club.id, program_id: program.id, dedupe_key: `interview-prep:${program.id}:${cls.confirmed_time}` }, audit);
        if (cls.requires_reply_from_me) upsertAutomationTask({ title: `Reply to ${club.name} interview invite`, due_at: deadlines[0]?.date || cls.confirmed_time || "", club_id: club.id, program_id: program.id, dedupe_key: `interview-reply:${program.id}:${message.gmail_message_id}` }, audit);
      }
      observeProgramStatus(program.id, status, audit);
    } else if (effect.kind === "newsletter") {
      for (const deadline of deadlines) {
        upsertAutomationTask({ title: deadline.label, due_at: deadline.date, domain: "campus", dedupe_key: `icc:${normalize(deadline.label)}:${deadline.date}` }, audit);
        const track = /exploratory/i.test(deadline.label) ? "exploratory" : /teams/i.test(deadline.label) ? "teams" : "";
        const field = /applications open/i.test(deadline.label) ? "app_opens_at" : /applications clos|deadline/i.test(deadline.label) ? "app_deadline_at" : /decisions/i.test(deadline.label) ? "decision_at" : "";
        if (track && field) for (const p of db.prepare("SELECT p.* FROM stern_programs p JOIN stern_clubs c ON c.id=p.club_id JOIN stern_processes s ON s.id=c.process_id WHERE p.track=? AND s.status='active' AND c.status<>'archived'").all(track) as RecruitingProgram[]) {
          if (p[field as keyof RecruitingProgram] !== deadline.date) suggest(`window:${p.id}:${field}:${deadline.date}`, [{ kind: "program_window", programId: p.id, fields: { [field]: deadline.date } }], message, audit, "program_window");
        }
      }
    } else if (effect.kind === "meeting") {
      if (!club) throw new SternError(409, "Unknown club");
      const date = cls.confirmed_time?.slice(0, 10) || deadlines[0]?.date;
      if (!date) throw new SternError(409, "Meeting date missing");
      upsertAutomationTask({ title: `Attend ${club.name} general meeting`, club_id: club.id, due_at: date, domain: "campus", dedupe_key: `meeting:${club.id}:${date}` }, audit);
    } else if (effect.kind === "academic") {
      const courses = db.prepare("SELECT id FROM courses WHERE lower(code)=? AND archived=0").all(normalize(cls.course_code || "")) as { id: number }[];
      if (courses.length !== 1) throw new SternError(409, "Unknown or ambiguous course");
      if (cls.assignment) assignment(cls, message, courses[0].id, audit);
      else for (const d of deadlines) upsertAutomationTask({ title: d.label, due_at: d.date, course_id: courses[0].id, domain: "academic", dedupe_key: `course:${courses[0].id}:${normalize(d.label)}:${d.date}` }, audit);
    } else if (effect.kind === "tasks") {
      for (const d of deadlines) upsertAutomationTask({ title: d.label, due_at: d.date, domain: "campus", dedupe_key: `nyu:${normalize(d.label)}:${d.date}` }, audit);
    }
  }
  return intents;
}
async function calendarIntent(intent: CalendarIntent, message: SternEmailMessage, audit: AuditMeta, source: AutomationSource, dryRun: boolean, retry: boolean) {
  const account = sternAccount();
  try {
    if (!account) throw new ScopeMissing("calendar.events (connect a Stern account)");
    const end = new Date(Date.parse(intent.start) + 30 * 60000).toISOString();
    const result = await source.createEvent(account, { id: intent.hash, summary: intent.title, startIso: intent.start, endIso: end, location: intent.location, attendees: [intent.email], description: "Scheduled from a confirmed coffee chat email." }, { dryRun });
    getDb().transaction(() => {
      upsertCalendar({ account, event_id: result.id, title: intent.title, start_at: intent.start, end_at: end, location: intent.location, attendees: JSON.stringify([intent.email]), kind: "coffee_chat", person_id: intent.personId, coffee_chat_id: intent.chatId, created_by_us: 1, synced_at: nowIso() }, audit);
      observeCoffeeChat(intent.chatId, { calendar_event_id: result.id }, audit);
    }).immediate();
  } catch (error) {
    if (retry) throw error; // Keep the reviewed suggestion pending until its write succeeds.
    getDb().transaction(() => {
      const key = `calendar-write:${account}:${nowIso().slice(0, 10)}`;
      const effect: Effect = { kind: "calendar_create", intent };
      const existing = getDb().prepare("SELECT id,proposed_data,state FROM stern_suggestions WHERE dedupe_key=?").get(key) as { id: number; proposed_data: string; state: string } | undefined;
      if (!existing) suggest(key, [effect], message, audit, error instanceof ScopeMissing ? "connect calendar write" : "calendar write failed; retry after reconnect");
      else if (existing.state === "pending") {
        const effects = JSON.parse(existing.proposed_data) as Effect[];
        if (!effects.some(e => e.kind === "calendar_create" && e.intent.hash === intent.hash)) patch("suggestion", existing.id, { proposed_data: JSON.stringify([...effects, effect]) }, audit);
      }
    }).immediate();
  }
}
export async function applyClassification(message: SternEmailMessage, cls: EmailClassification, options: { dryRun?: boolean; source?: AutomationSource; audit?: AuditMeta; accept?: boolean; effects?: Effect[] } = {}) {
  const audit = options.audit || messageMeta(message, cls), effects = options.effects || effectsFor(cls);
  let intents: CalendarIntent[] = [], applied = "ignored";
  const outboundOnly = ["coffee_chat_request_sent", "follow_up_sent", "thank_you_sent"].includes(cls.category);
  const forceSuggest = !options.accept && (cls.category === "other_nyu" || cls.category === "club_other" || (outboundOnly && message.direction !== "outbound"));
  if (effects.length && cls.confidence >= STERN_THRESHOLDS.suggest) {
    if (!options.accept && (cls.confidence < STERN_THRESHOLDS.auto || forceSuggest)) {
      getDb().transaction(() => suggest(`message:${message.id}`, effects, message, audit)).immediate(); applied = "suggested";
    } else {
      try { intents = peopleWrite(() => executeEffects(effects, message, audit)); applied = "auto_applied"; }
      catch (error) {
        if (options.accept) throw error;
        getDb().transaction(() => suggest(`message:${message.id}`, effects, message, audit, error instanceof Error ? error.message : "Review required")).immediate(); applied = "suggested";
      }
    }
  }
  const retryCalendarOnly = !!options.accept && effects.every(effect => effect.kind === "calendar_create");
  for (const intent of intents) await calendarIntent(intent, message, audit, options.source || automationSource(), dryRunDefault(options.dryRun), retryCalendarOnly);
  getDb().transaction(() => patch("email_message", message.id, { applied, processed_at: nowIso() }, audit)).immediate();
  return { applied, batchId: audit.batchId, calendarIntents: intents };
}
export async function acceptSuggestion(id: number, options: { dryRun?: boolean; source?: AutomationSource } = {}) {
  const suggestion = row<Row>("suggestion", id);
  if (suggestion.state !== "pending") throw new SternError(409, "Suggestion already reviewed");
  const effects = JSON.parse(String(suggestion.proposed_data)) as Effect[];
  if (!effects.length) throw new SternError(409, "Reconnect Google from Connections, then retry the calendar sync");
  const message = getDb().prepare("SELECT * FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(suggestion.gmail_account, suggestion.gmail_message_id) as SternEmailMessage | undefined;
  if (!message) throw new SternError(404, "Suggestion evidence missing");
  const cls = JSON.parse(message.classification) as EmailClassification;
  const audit = messageMeta(message, cls, "suggestion_accept");
  const result = await applyClassification(message, cls, { ...options, audit, accept: true, effects });
  getDb().transaction(() => patch("suggestion", id, { state: "accepted", reviewed_at: nowIso() }, audit)).immediate();
  return result;
}
export function dismissSuggestion(id: number) {
  return getDb().transaction(() => { const s = row<Row>("suggestion", id); if (s.state !== "pending") throw new SternError(409, "Suggestion already reviewed"); patch("suggestion", id, { state: "dismissed", reviewed_at: nowIso() }, { source: "manual", batchId: newBatchId("dismiss") }); }).immediate();
}
