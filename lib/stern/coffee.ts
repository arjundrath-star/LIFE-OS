import { getDb, nowIso } from "@/db";
import { CHAT_TRANSITIONS, COFFEE_CHAT_LABELS, type CoffeeChat, type CoffeeChatState, type RecruitingClub, type RecruitingProgram, type TouchpointKind } from "@/lib/stern-types";
import { SternError } from "./errors";
import { meta, row, insert, patch, textFields, id, type ChangeMeta, type Row } from "./recruiting-write";
import { validDate } from "./time";

function validateClub(clubId: number) {
  const club = row<RecruitingClub>("club", clubId);
  const process = row<{ status: string }>("process", club.process_id);
  if (club.status === "archived" || process.status === "archived") throw new SternError(400, "Archived recruiting is read-only");
}
export function createCoffeeChat(personId: number, clubId: number, programId = 0, options: ChangeMeta = {}): number {
  return getDb().transaction(() => {
    const person = row<{ archived: number }>("person", personId);
    if (person.archived) throw new SternError(400, "Person is archived");
    validateClub(clubId);
    if (programId !== 0 && row<RecruitingProgram>("program", id(programId, "programId")).club_id !== clubId) throw new SternError(400, "Program must belong to the chat's club");
    // no_reply is retryable, and done still owes a thank-you; both retain their identity.
    const existing = getDb().prepare("SELECT id FROM coffee_chats WHERE person_id = ? AND club_id = ? AND state NOT IN ('thank_you_sent','declined') ORDER BY id DESC LIMIT 1").get(personId, clubId) as { id: number } | undefined;
    if (existing) return existing.id;
    return insert("coffee_chat", { person_id: personId, club_id: clubId, program_id: programId }, meta(options));
  }).immediate();
}
export type ChatTransitionMeta = ChangeMeta & { at?: string; scheduled_at?: string; location?: string; reply_needs_me?: boolean; calendar_event_id?: string; gmail_thread_id?: string };
/** Browser controls cannot supply Gmail/calendar identity or automation provenance. */
export function manualChatTransitionMeta(input: Record<string, unknown>): ChatTransitionMeta {
  const allowed = ["at", "scheduled_at", "location", "reply_needs_me"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new SternError(400, "Unknown chat transition metadata");
  return input as ChatTransitionMeta;
}
export function transition(chatId: number, next: CoffeeChatState, options: ChatTransitionMeta = {}): number {
  return getDb().transaction(() => {
    const db = getDb();
    const chat = row<CoffeeChat>("coffee_chat", chatId);
    validateClub(chat.club_id);
    if (chat.state === next) return chatId;
    if (!CHAT_TRANSITIONS[chat.state].includes(next)) throw new SternError(400, `Invalid coffee chat transition: ${chat.state} → ${next}`);
    const at = options.at ?? nowIso();
    if (typeof at !== "string" || !validDate(at) || !at.includes("T")) throw new SternError(400, "Transition time must include timezone");
    const audit = meta(options);
    const fields: Row = { state: next };
    const timestamp: Partial<Record<CoffeeChatState, string>> = { requested: "requested_at", reply_received: "reply_at", scheduled: "scheduled_at", done: "occurred_at", thank_you_sent: "thank_you_sent_at" };
    if (timestamp[next]) fields[timestamp[next]!] = at;
    if (next === "scheduled") {
      if (typeof options.scheduled_at !== "string" || !options.scheduled_at.includes("T") || !validDate(options.scheduled_at)) throw new SternError(400, "Scheduled chat needs a date and time with timezone");
      fields.scheduled_at = options.scheduled_at;
    }
    if (options.reply_needs_me !== undefined && typeof options.reply_needs_me !== "boolean") throw new SternError(400, "reply_needs_me must be a boolean");
    fields.reply_needs_me = next === "reply_received" ? (options.reply_needs_me === false ? 0 : 1) : 0;
    for (const key of ["location", "calendar_event_id", "gmail_thread_id"] as const) {
      if (options[key] !== undefined) Object.assign(fields, textFields({ [key]: options[key] }, [key]));
    }
    const retry = chat.state === "no_reply" && next === "requested";
    const kind: TouchpointKind = retry ? "follow_up_sent" : ({ requested: "email_sent", reply_received: "email_received", scheduled: "calendar", done: "coffee_chat", thank_you_sent: "thank_you_sent", no_reply: "note", declined: "email_received" } as const)[next as Exclude<CoffeeChatState, "to_request">];
    const source = audit.source === "auto_email" ? "gmail" : audit.source === "auto_calendar" ? "calendar" : audit.source === "imessage" ? "imessage" : audit.source === "seed" ? "seed" : "manual";
    // The schema's non-null UNIQUE key also covers manual events. A namespaced local ID
    // avoids collapsing repeated manual touches, without pretending they came from Gmail.
    const messageId = audit.gmailMessageId || `local:${audit.batchId}:${chatId}:${next}`;
    const existingTouchpoint = db.prepare(`SELECT id FROM people_touchpoints
      WHERE person_id = ? AND gmail_account = ? AND gmail_message_id = ? AND kind = ?`)
      .get(chat.person_id, audit.gmailAccount || "", messageId, kind);
    // Reclassification of the same reply still changes chat state, but keeps the shared evidence.
    if (!existingTouchpoint) insert("touchpoint", { person_id: chat.person_id, kind, occurred_at: at, source,
      gmail_account: audit.gmailAccount || "", gmail_message_id: messageId,
      summary: `Coffee chat: ${COFFEE_CHAT_LABELS[next]}`, detail: JSON.stringify({ coffee_chat_id: chatId, club_id: chat.club_id, from: chat.state, to: next }) }, audit);
    if (retry) {
      fields.last_follow_up_at = at;
      fields.follow_up_count = (db.prepare("SELECT COUNT(*) n FROM people_touchpoints WHERE person_id = ? AND kind = 'follow_up_sent' AND json_valid(detail) AND json_extract(detail, '$.coffee_chat_id') = ?").get(chat.person_id, chatId) as { n: number }).n;
      fields.reply_at = "";
    }
    patch("coffee_chat", chatId, fields, audit);
    return chatId;
  }).immediate();
}
export function updateCoffeeChat(chatId: number, input: Record<string, unknown>, options: ChangeMeta = {}) {
  return getDb().transaction(() => {
    validateClub(row<CoffeeChat>("coffee_chat", chatId).club_id);
    patch("coffee_chat", chatId, textFields(input, ["prep_notes", "takeaways", "location"]), meta(options));
    return chatId;
  }).immediate();
}
export function ensureCoffeeChatsForPerson(personId: number, options: ChangeMeta = {}): number[] {
  return getDb().transaction(() => {
    row("person", personId);
    const audit = meta(options);
    const clubs = getDb().prepare(`SELECT DISTINCT a.club_id FROM people_affiliations a JOIN stern_clubs c ON c.id = a.club_id
      JOIN stern_processes p ON p.id = c.process_id WHERE a.person_id = ? AND a.relevant_for_recruiting = 1 AND c.status <> 'archived' AND p.status = 'active'`).all(personId) as { club_id: number }[];
    return clubs.map(({ club_id }) => {
      // Trigger reconciliation must not spawn another attempt after a completed/declined chat.
      const any = getDb().prepare("SELECT id FROM coffee_chats WHERE person_id = ? AND club_id = ? ORDER BY id DESC LIMIT 1").get(personId, club_id) as { id: number } | undefined;
      return any?.id ?? createCoffeeChat(personId, club_id, 0, audit);
    });
  }).immediate();
}

/** Reconcile an observed email/calendar fact without inventing intermediate touchpoints. */
export function observeCoffeeChat(chatId: number, input: {
  state?: CoffeeChatState; requested_at?: string; reply_at?: string; reply_needs_me?: number;
  scheduled_at?: string; location?: string; calendar_event_id?: string; occurred_at?: string;
  thank_you_sent_at?: string; last_follow_up_at?: string; gmail_thread_id?: string; prep_notes?: string;
}, options: ChangeMeta) {
  return getDb().transaction(() => {
    const chat = row<CoffeeChat>("coffee_chat", chatId);
    validateClub(chat.club_id);
    const audit = meta(options);
    if (!["auto_email", "auto_calendar", "suggestion_accept", "agent"].includes(String(audit.source))) throw new SternError(400, "Observed facts require automation evidence");
    const fields: Row = { ...input };
    const rank: Record<CoffeeChatState, number> = { to_request: 0, requested: 1, no_reply: 1, reply_received: 2, scheduled: 3, done: 4, thank_you_sent: 5, declined: 5 };
    if (input.state && rank[input.state] < rank[chat.state]) delete fields.state;
    for (const key of ["requested_at", "reply_at", "scheduled_at", "occurred_at", "thank_you_sent_at", "last_follow_up_at"] as const) {
      if (input[key] && (!validDate(input[key]!) || !input[key]!.includes("T"))) throw new SternError(400, `Invalid ${key}`);
    }
    if ((fields.state || chat.state) === "scheduled" && !(fields.scheduled_at || chat.scheduled_at)) throw new SternError(400, "Scheduled chat needs a time");
    if (input.reply_needs_me !== undefined && ![0, 1].includes(input.reply_needs_me)) throw new SternError(400, "Invalid reply flag");
    if (["scheduled", "done", "thank_you_sent", "declined"].includes(String(fields.state || chat.state))) fields.reply_needs_me = 0;
    if (input.last_follow_up_at) fields.follow_up_count = (getDb().prepare("SELECT COUNT(*) n FROM people_touchpoints WHERE person_id=? AND kind='follow_up_sent' AND json_valid(detail) AND json_extract(detail,'$.coffee_chat_id')=?").get(chat.person_id, chatId) as { n: number }).n;
    patch("coffee_chat", chatId, fields, audit);
    return chatId;
  }).immediate();
}
