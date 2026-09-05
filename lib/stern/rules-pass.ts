import { getDb } from "@/db";
import { newBatchId, type AuditMeta } from "./audit";
import { ensureCoffeeChatsForPerson, observeCoffeeChat } from "./coffee";
import { ensureDraft } from "./drafts";
import { isConnectionEnabled } from "@/lib/connections/enabled";
import { llmMode } from "./llm";
import type { CoffeeChat } from "@/lib/stern-types";
export async function runRulesPass(options: { now?: Date; audit?: AuditMeta } = {}) {
  // The SQL-only rules always run (they need no LLM and no Gmail); only draft generation is gated.
  const draftsEnabled = !(llmMode() === "off" || llmMode() === "live" && !isConnectionEnabled("stern-llm-codex"));
  const audit = options.audit || { batchId: newBatchId("rules"), source: "agent" }, db = getDb(), now = (options.now || new Date()).getTime();
  const result = { drafts: 0, errors: [] as string[] };
  // Headers can prove a reply was sent even when its short body has no classifiable intent.
  const answered = db.prepare(`SELECT ch.id FROM coffee_chats ch JOIN people p ON p.id=ch.person_id
    JOIN stern_clubs c ON c.id=ch.club_id JOIN stern_processes s ON s.id=c.process_id
    WHERE ch.reply_needs_me=1 AND ch.gmail_thread_id<>'' AND ch.reply_at<>''
      AND p.archived=0 AND c.status<>'archived' AND s.status='active'
      AND EXISTS (SELECT 1 FROM stern_email_messages m WHERE m.gmail_thread_id=ch.gmail_thread_id
        AND m.direction='outbound' AND m.internal_date > (julianday(ch.reply_at)-2440587.5)*86400000)`).all() as { id: number }[];
  for (const chat of answered) observeCoffeeChat(chat.id, { reply_needs_me: 0 }, audit);
  for (const p of db.prepare("SELECT id FROM people WHERE archived=0 AND status='need_to_reach_out'").all() as { id: number }[]) ensureCoffeeChatsForPerson(p.id, audit);
  const chats = db.prepare(`SELECT ch.* FROM coffee_chats ch JOIN people p ON p.id=ch.person_id JOIN stern_clubs c ON c.id=ch.club_id JOIN stern_processes s ON s.id=c.process_id WHERE p.archived=0 AND c.status<>'archived' AND s.status='active'`).all() as CoffeeChat[];
  for (const chat of chats) {
    const age = chat.requested_at ? (now - Date.parse(chat.requested_at)) / 86400000 : 0;
    const kind = chat.state === "to_request" ? "request" : chat.state === "done" ? "thank_you" : chat.reply_needs_me ? "reply_scheduling" : (chat.state === "requested" || chat.state === "no_reply") && !chat.reply_at && age > 3 ? "follow_up" : null;
    if (kind && draftsEnabled) {
      try { if (await ensureDraft(chat.id, kind, audit)) result.drafts++; }
      catch (error) { result.errors.push(error instanceof Error ? error.message : "Draft generation failed"); }
    }
    if (chat.state === "requested" && !chat.reply_at && age > 5) observeCoffeeChat(chat.id, { state: "no_reply" }, audit);
  }
  return result;
}
