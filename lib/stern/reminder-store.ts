import { getDb } from "@/db";
import type { SternReminder, ReminderMessage, ReminderChannel } from "@/lib/stern-types";
import { type AuditMeta, newBatchId } from "./audit";
import { insert, patch, row, type Row } from "./recruiting-write";

export function reminderMeta(source = "agent"): AuditMeta { return { source, batchId: newBatchId("reminders") }; }
export function reminderMessage(reminder: SternReminder): ReminderMessage {
  try {
    const parsed = JSON.parse(reminder.message) as ReminderMessage;
    if (typeof parsed.body === "string" && typeof parsed.key === "string") return parsed;
  } catch { /* legacy plain text */ }
  return { key: `${reminder.rule_key}:${reminder.entity_type}:${reminder.entity_id}:${reminder.fire_at}`, subject: "Reminder", body: reminder.message, urgent: reminder.rule_key === "reply_owed", scheduledAt: reminder.fire_at };
}
export function reminderRow(id: number) { return row<SternReminder>("reminder", id); }
export function changeReminder(id: number, fields: Row, audit = reminderMeta()) {
  return getDb().transaction(() => { patch("reminder", id, fields, audit); return reminderRow(id); }).immediate();
}
export function queueReminder(input: { rule: string; entity: string; entityId: number; fireAt: string; channel?: ReminderChannel; message: ReminderMessage }, audit = reminderMeta()) {
  return getDb().transaction(() => {
    // A snooze changes fire_at, while the immutable message key retains the UNIQUE identity.
    const prior = getDb().prepare(`SELECT * FROM stern_reminders WHERE
      (rule_key=? AND entity_type=? AND entity_id=? AND fire_at=?) OR
      (json_valid(message) AND json_extract(message,'$.key')=?) ORDER BY id LIMIT 1`)
      .get(input.rule, input.entity, input.entityId, input.fireAt, input.message.key) as SternReminder | undefined;
    if (prior) return { reminder: prior, inserted: false };
    const id = insert("reminder", { rule_key: input.rule, entity_type: input.entity, entity_id: input.entityId, fire_at: input.fireAt, channel: input.channel ?? "imessage", message: JSON.stringify(input.message) }, audit);
    return { reminder: reminderRow(id), inserted: true };
  }).immediate();
}
export function reminderTail(limit = 100): SternReminder[] {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  return (getDb().prepare("SELECT * FROM stern_reminders ORDER BY id DESC LIMIT ?").all(n) as SternReminder[]).reverse();
}
