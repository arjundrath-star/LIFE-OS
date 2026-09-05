import type { SternScanState, SternDraft, SternSuggestion, SternAutomationResponse } from "@/lib/stern-types";
import { nowIso } from "@/db";
import { automationConnections } from "./automation-connections";
import { reminderTail } from "./reminder-store";
import { notificationSettings } from "./notification-settings";
import { getDb } from "@/db";
import { auditTail } from "./audit";

export function automationDetails() {
  const db = getDb();
  return {
    reminders: reminderTail(),
    notificationSettings: notificationSettings(),
    scanState: db.prepare("SELECT * FROM stern_scan_state ORDER BY account").all() as SternScanState[],
    recentMessages: db.prepare("SELECT id,gmail_account,gmail_message_id,subject,direction,category,confidence,applied,error,internal_date FROM stern_email_messages ORDER BY id DESC LIMIT 50").all().reverse(),
    suggestions: db.prepare("SELECT * FROM stern_suggestions WHERE state='pending' ORDER BY id DESC LIMIT 100").all().reverse() as SternSuggestion[],
    drafts: db.prepare("SELECT * FROM stern_drafts WHERE state NOT IN ('discarded','sent_detected') ORDER BY id DESC LIMIT 100").all().reverse() as SternDraft[],
    audit: auditTail(100),
  };
}
export async function automationSnapshot(email = ""): Promise<SternAutomationResponse> {
  const missing = /@stern\.nyu\.edu$/i.test(email) && !getDb().prepare("SELECT 1 FROM google_accounts WHERE lower(email)=?").get(email.toLowerCase());
  return { ...automationDetails(), connections: await automationConnections(), updatedAt: nowIso(), connectHref: missing ? `/api/google/connect?set=stern&target=stern&login_hint=${encodeURIComponent(email)}` : "" };
}
