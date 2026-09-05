import { getDb, nowIso, kvGet, kvSet } from "@/db";
import type { DraftKind, Person, CoffeeChat } from "@/lib/stern-types";
import { newBatchId, type AuditMeta } from "./audit";
import { row, patch, insert, type Row } from "./recruiting-write";
import { generateDraft } from "./llm";
import { automationSource, sternAccount, dryRunDefault, type AutomationSource } from "./automation-source";
import { SternError } from "./errors";
export async function ensureDraft(chatId: number, kind: DraftKind, audit: AuditMeta) {
  const prior = getDb().prepare("SELECT id FROM stern_drafts WHERE coffee_chat_id=? AND kind=? AND state<>'discarded' ORDER BY id DESC LIMIT 1").get(chatId, kind) as { id: number } | undefined;
  if (prior) return prior.id;
  const chat = row<CoffeeChat>("coffee_chat", chatId), person = row<Person>("person", chat.person_id);
  const failureKey = `stern.draft_fail:${chatId}:${kind}`;
  const failure = kvGet<{ at: number; error: string }>(failureKey);
  if (failure && Date.now() - failure.at < 6 * 3600000) return null;
  let draft: { subject: string; body: string };
  try { draft = await generateDraft(kind, { person, chat }); }
  catch (error) {
    getDb().transaction(() => kvSet(failureKey, { at: Date.now(), error: error instanceof Error ? error.message.slice(0, 200) : "Draft generation failed" })).immediate();
    throw error;
  }
  getDb().transaction(() => kvSet(failureKey, null)).immediate();
  return getDb().transaction(() => insert("draft", { person_id: person.id, coffee_chat_id: chatId, kind, to_email: person.email, ...draft }, audit)).immediate();
}
export async function regenerateDraft(id: number) {
  const d = row<Row>("draft", id);
  if (["sent_detected", "gmail_draft_created"].includes(String(d.state))) throw new SternError(409, "This draft has already left the tracker; create a new draft instead");
  const draft = await generateDraft(d.kind as DraftKind, { person: row<Person>("person", Number(d.person_id)), chat: row<CoffeeChat>("coffee_chat", Number(d.coffee_chat_id)) });
  getDb().transaction(() => patch("draft", id, { ...draft, state: "generated" }, { batchId: newBatchId("draft"), source: "manual" })).immediate();
  return id;
}
export function markDraftCopied(id: number) {
  getDb().transaction(() => {
    const d = row<Row>("draft", id);
    if (!['generated', 'copied'].includes(String(d.state))) throw new SternError(409, "Draft cannot be marked copied in this state");
    patch("draft", id, { state: "copied" }, { batchId: newBatchId("draft"), source: "manual" });
  }).immediate();
}
export async function createGmailDraft(id: number, options: { dryRun?: boolean; source?: AutomationSource } = {}) {
  const d = row<Row>("draft", id), account = sternAccount();
  if (d.state === "gmail_draft_created") return { id: d.gmail_draft_id };
  if (!['generated', 'copied'].includes(String(d.state))) throw new SternError(409, "Draft cannot be created in this state");
  if (!account) throw new SternError(409, "Connect a Stern Google account first");
  if (!d.to_email || !d.body) throw new SternError(400, "Draft needs a recipient and body");
  const dryRun = dryRunDefault(options.dryRun);
  const result = await (options.source || automationSource()).createDraft(account, { to: String(d.to_email), subject: String(d.subject), body: String(d.body) }, { dryRun });
  // Dry runs report intent without claiming a Gmail draft exists.
  if (!dryRun) getDb().transaction(() => patch("draft", id, { state: "gmail_draft_created", gmail_account: account, gmail_draft_id: result.id, updated_at: nowIso() }, { batchId: newBatchId("draft"), source: "manual" })).immediate();
  return { ...result, dryRun };
}
