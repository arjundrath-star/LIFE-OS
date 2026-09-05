import { getDb, kvGet, kvSet } from "@/db";
import { HERMES_ALIAS, HERMES_TARGET, STERN_THRESHOLDS, STERN_SETTINGS_DEFAULTS, STERN_NOTIFICATION_KEYS, type SternNotificationSettings } from "@/lib/stern-types";
import { logChange, newBatchId, type AuditMeta } from "./audit";
import { SternError } from "./errors";

export function notificationSettings(): SternNotificationSettings {
  const read = (key: string, fallback: string) => kvGet<string>(key) ?? fallback;
  return {
    "stern.threshold_auto": read("stern.threshold_auto", String(STERN_THRESHOLDS.auto)),
    "stern.threshold_suggest": read("stern.threshold_suggest", String(STERN_THRESHOLDS.suggest)),
    "stern.hermes_alias": read("stern.hermes_alias", STERN_SETTINGS_DEFAULTS.hermesAlias),
    "stern.imessage_target": read("stern.imessage_target", STERN_SETTINGS_DEFAULTS.imessageTarget),
    "stern.memo_email": read("stern.memo_email", STERN_SETTINGS_DEFAULTS.memoEmail),
    "stern.quiet_hours_start": read("stern.quiet_hours_start", STERN_SETTINGS_DEFAULTS.quietHoursStart),
    "stern.quiet_hours_end": read("stern.quiet_hours_end", STERN_SETTINGS_DEFAULTS.quietHoursEnd),
  };
}

/** Caller owns an IMMEDIATE transaction; raw kv JSON preserves absent versus empty on undo. */
export function writeNotificationSetting(key: string, value: string, audit: AuditMeta) {
  const before = getDb().prepare("SELECT v FROM kv WHERE k=?").get(key) as { v: string } | undefined;
  const after = JSON.stringify(value);
  if (before?.v === after) return;
  logChange({ ...audit, entityType: "notification_setting", entityId: 0, action: "update", field: key, before: before?.v ?? "", after });
  kvSet(key, value);
}

export function updateNotificationSettings(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SternError(400, "settings must be an object");
  const entries = Object.entries(input);
  for (const [key, value] of entries) {
    if (!(STERN_NOTIFICATION_KEYS as readonly string[]).includes(key) || key === "stern.memo_last_date") throw new SternError(400, `Setting is not editable: ${key}`);
    if (typeof value !== "string" || value.length > 320 || /[\r\n\0]/.test(value)) throw new SternError(400, `Invalid setting: ${key}`);
    if (key === "stern.hermes_alias" && !HERMES_ALIAS.test(value)) throw new SternError(400, "Hermes alias must be a command name");
    if (key === "stern.imessage_target" && value !== "" && !HERMES_TARGET.test(value)) throw new SternError(400, "Invalid Hermes target");
    if (key.startsWith("stern.threshold_")) thresholdNumber(value);
    if (key === "stern.memo_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new SternError(400, "Invalid memo email");
    if (key.includes("quiet_hours") && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new SternError(400, "Quiet hours must be HH:MM");
  }
  const audit = { source: "manual", batchId: newBatchId("notification-settings") };
  getDb().transaction(() => {
    // Validate the merged pair under the same writer lock as the update.
    const merged = { ...notificationSettings(), ...Object.fromEntries(entries) };
    validateThresholds(merged["stern.threshold_auto"], merged["stern.threshold_suggest"]);
    for (const [key, value] of entries) writeNotificationSetting(key, value as string, audit);
  }).immediate();
  return { settings: notificationSettings(), batchId: audit.batchId };
}

function thresholdNumber(value: unknown): number {
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) {
    throw new SternError(400, "Thresholds must be finite decimal numbers in [0,1]");
  }
  return Number(value);
}
function validateThresholds(autoValue: unknown, suggestValue: unknown) {
  const auto = thresholdNumber(autoValue), suggest = thresholdNumber(suggestValue);
  if (suggest > auto) throw new SternError(400, "Suggestion threshold must not exceed auto threshold");
  return { auto, suggest };
}
export function thresholds() {
  const settings = notificationSettings();
  return validateThresholds(settings["stern.threshold_auto"], settings["stern.threshold_suggest"]);
}
