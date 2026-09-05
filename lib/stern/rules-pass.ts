import { getDb } from "@/db";
import { newBatchId, type AuditMeta } from "./audit";
import { ensureCoffeeChatsForPerson, observeCoffeeChat } from "./coffee";
import { ensureDraft } from "./drafts";
import { llmMode } from "./llm";
import type { CoffeeChat } from "@/lib/stern-types";
export async function runRulesPass(options: { now?: Date; audit?: AuditMeta } = {}) {
  if (llmMode() === "off") return { drafts: 0, errors: [] as string[] };
  const audit = options.audit || { batchId: newBatchId("rules"), source: "agent" }, db = getDb(), now = (options.now || new Date()).getTime();
  const result = { drafts: 0, errors: [] as string[] };
  for (const p of db.prepare("SELECT id FROM people WHERE archived=0 AND status='need_to_reach_out'").all() as { id: number }[]) ensureCoffeeChatsForPerson(p.id, audit);
  const chats = db.prepare(`SELECT ch.* FROM coffee_chats ch JOIN people p ON p.id=ch.person_id JOIN stern_clubs c ON c.id=ch.club_id JOIN stern_processes s ON s.id=c.process_id WHERE p.archived=0 AND c.status<>'archived' AND s.status='active'`).all() as CoffeeChat[];
  for (const chat of chats) {
    const age = chat.requested_at ? (now - Date.parse(chat.requested_at)) / 86400000 : 0;
    const kind = chat.state === "to_request" ? "request" : chat.state === "done" ? "thank_you" : chat.reply_needs_me ? "reply_scheduling" : (chat.state === "requested" || chat.state === "no_reply") && !chat.reply_at && age > 3 ? "follow_up" : null;
    if (kind) {
      try { await ensureDraft(chat.id, kind, audit); result.drafts++; }
      catch (error) { result.errors.push(error instanceof Error ? error.message : "Draft generation failed"); }
    }
    if (chat.state === "requested" && !chat.reply_at && age > 5) observeCoffeeChat(chat.id, { state: "no_reply" }, audit);
  }
  return result;
}
