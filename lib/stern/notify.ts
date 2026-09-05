import { getDb } from "@/db";
import { STERN_SETTINGS_DEFAULTS, type ReminderChannel } from "@/lib/stern-types";
import { notificationSettings } from "./notification-settings";
import { notificationRunner, runnerOptions, sendEmail, type NotificationRunner } from "./email-send";
import { changeReminder, queueReminder, reminderMeta, reminderRow } from "./reminder-store";
import type { AuditMeta } from "./audit";
import { SternError } from "./errors";
export type SendOptions = { dryRun?: boolean; runner?: NotificationRunner; now?: Date; audit?: AuditMeta };
export type NotificationInput = { channel: ReminderChannel; subject: string; body: string; urgent: boolean; reminderId?: number; expectedFireAt?: string };
export function notificationDryRun(requested?: boolean) {
  if (requested === true) return true;
  // An API payload cannot override the operator's environment safety switch.
  if (process.env.STERN_NOTIFY_DRY_RUN !== undefined) return process.env.STERN_NOTIFY_DRY_RUN !== "0";
  return process.env.NODE_ENV !== "production";
}
function failure(channel: string, error: unknown) {
  // Child-process errors can include full argv (personal content). Record a bounded diagnostic only.
  const code = (error as { code?: string | number; killed?: boolean })?.code;
  return `${channel}: ${(error as { killed?: boolean })?.killed ? "timeout" : code ?? "delivery failed"}`;
}
export async function send(input: NotificationInput, options: SendOptions = {}) {
  if (!["imessage", "email", "both", "dashboard"].includes(input.channel)) throw new SternError(400, "Invalid channel");
  if (!input.subject || /[\r\n\0]/.test(input.subject) || input.subject.length > 500 || !input.body || input.body.includes("\0") || input.body.length > 100_000) throw new SternError(400, "Invalid notification content");
  const now = options.now ?? new Date(), audit = options.audit ?? reminderMeta();
  const reminderId = input.reminderId ?? queueReminder({ rule: "test", entity: "notification", entityId: 0, fireAt: now.toISOString(), channel: input.channel,
    message: { key: audit.batchId, subject: input.subject, body: input.body, urgent: input.urgent, scheduledAt: now.toISOString() } }, audit).reminder.id;
  const claimed = getDb().transaction(() => {
    const current = reminderRow(reminderId);
    if (!["pending", "snoozed"].includes(current.delivery_status) || (input.expectedFireAt !== undefined && current.fire_at !== input.expectedFireAt)) return false;
    // A crash/timeout is ambiguous: leave failed for review, never automatically resend it.
    changeReminder(reminderId, { delivery_status: "failed", error: "delivery-in-progress" }, audit);
    return true;
  }).immediate();
  if (!claimed) return reminderRow(reminderId);
  if (notificationDryRun(options.dryRun)) return changeReminder(reminderId, { delivery_status: "skipped", error: "dry-run", sent_at: "" }, audit);
  const runner = options.runner ?? notificationRunner, settings = notificationSettings();
  const results: string[] = [], errors: string[] = [];
  if (input.channel === "imessage" || input.channel === "both") {
    try {
      const alias = settings["stern.hermes_alias"], target = settings["stern.imessage_target"];
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(alias) || !target || /[\r\n\0]/.test(target)) throw Object.assign(new Error(), { code: "not-configured" });
      const args = ["send", "-t", target, input.body];
      try { await runner(alias, args, runnerOptions()); }
      catch (error) {
        // Only missing wrappers can fall back safely; a timeout may already have delivered.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || alias === STERN_SETTINGS_DEFAULTS.hermesAliasFallback) throw error;
        await runner(STERN_SETTINGS_DEFAULTS.hermesAliasFallback, args, runnerOptions());
      }
      results.push("imessage sent");
    } catch (error) { errors.push(failure("imessage", error)); }
  }
  if (input.channel === "email" || input.channel === "both") {
    try { await sendEmail(settings["stern.memo_email"], input.subject, input.body, runner); results.push("email sent"); }
    catch (error) { errors.push(failure("email", error)); }
  }
  return changeReminder(reminderId, { delivery_status: errors.length ? "failed" : "sent", sent_at: results.length || input.channel === "dashboard" ? now.toISOString() : "", error: errors.length ? [...results, ...errors].join("; ") : "" }, audit);
}
