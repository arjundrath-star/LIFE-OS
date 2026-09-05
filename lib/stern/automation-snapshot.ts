import { reminderTail } from "./reminder-store";
import { notificationSettings } from "./notification-settings";
import { getDb } from "@/db";
import { auditTail } from "./audit";
import { sternConnectionSummary } from "./connections";
export function automationDetails() {
  const db = getDb();
  return {
    reminders: reminderTail(),
    notificationSettings: notificationSettings(),
    scanState: db.prepare("SELECT * FROM stern_scan_state ORDER BY account").all(),
    recentMessages: db.prepare("SELECT id,gmail_account,gmail_message_id,subject,direction,category,confidence,applied,error,internal_date FROM stern_email_messages ORDER BY id DESC LIMIT 50").all().reverse(),
    suggestions: db.prepare("SELECT * FROM stern_suggestions WHERE state='pending' ORDER BY id DESC LIMIT 100").all().reverse(),
    drafts: db.prepare("SELECT * FROM stern_drafts WHERE state NOT IN ('discarded','sent_detected') ORDER BY id DESC LIMIT 100").all().reverse(),
    audit: auditTail(100),
  };
}
export async function automationSnapshot() { return { ...automationDetails(), connections: await sternConnectionSummary() }; }
