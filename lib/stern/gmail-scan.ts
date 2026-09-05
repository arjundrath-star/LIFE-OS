import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { recordAgentEvent } from "@/lib/agents";
import type { SternEmailMessage } from "@/lib/stern-types";
import type { GmailFullMessage } from "@/lib/sources/google";
import { classifyEmail, llmMode } from "./llm";
import { addresses, applyClassification, messageMeta } from "./apply";
import { patch, row } from "./recruiting-write";
import { accountsToScan, automationJob, automationSource, type AutomationSource } from "./automation-source";
import { runRulesPass } from "./rules-pass";
export { accountsToScan } from "./automation-source";
export function contentHash(msg: Pick<GmailFullMessage, "from" | "subject" | "text">): string {
  // Strip only a leading forwarding envelope, preserving the underlying message text.
  const body = msg.text.replace(/\r\n/g, "\n").replace(/^\s*-+\s*Forwarded message\s*-+\n(?:[^\n]+\n)*?\n+/i, "");
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(`${addresses(msg.from)[0] || normalized(msg.from)}|${normalized(msg.subject.replace(/^(?:fwd?:\s*)+/i, ""))}|${normalized(body).slice(0, 2000)}`).digest("hex");
}
export function runSternEmailScan(options: { dryRun?: boolean; source?: AutomationSource; now?: Date } = {}) {
  return automationJob(async () => {
    const counts = { accounts: 0, failures: 0, messages: 0, duplicates: 0, applied: 0, suggested: 0, ignored: 0, errors: 0, calendarIntents: [] as unknown[] };
    if (llmMode() === "off" && !options.source) return counts;
    const db = getDb(), source = options.source || automationSource(), accounts = accountsToScan();
    const own = (db.prepare("SELECT email FROM google_accounts").all() as { email: string }[]).map(r => r.email.toLowerCase());
    const runId = `stern-email-${crypto.randomUUID()}`;
    const emit = (kind: string, status: string, summary: string) => recordAgentEvent({ agent: "stern-automation", run: runId, kind, status, summary, detail: JSON.stringify(counts), triggerType: "scheduler", triggerSource: "Stern email scanner" });
    emit("started", "running", "Stern email scan started");
    try {
      for (const account of accounts) {
        counts.accounts++;
        let watermark = (db.prepare("SELECT last_internal_date FROM stern_scan_state WHERE account=?").get(account) as { last_internal_date: number } | undefined)?.last_internal_date || 0;
        try {
          const ids = await source.list(account, watermark, { labels: ["INBOX", "SENT"] });
          const full: GmailFullMessage[] = [];
          for (const id of ids) {
            const prior = db.prepare("SELECT applied FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(account, id) as { applied: string } | undefined;
            if (prior && prior.applied !== "pending" && prior.applied !== "error") continue;
            full.push(await source.full(account, id));
          }
          full.sort((a, b) => a.internalDate - b.internalDate || a.id.localeCompare(b.id));
          // Ingest the whole page first, so a later outbound reply suppresses stale reply-needed flags.
          db.transaction(() => {
            for (const msg of full) {
              if (!Number.isFinite(msg.internalDate) || msg.internalDate <= 0) throw new Error("Invalid Gmail internal date");
              const direction = addresses(msg.from).some(email => own.includes(email)) ? "outbound" : "inbound";
              db.prepare(`INSERT OR IGNORE INTO stern_email_messages (gmail_account,gmail_message_id,gmail_thread_id,content_hash,direction,from_addr,to_addrs,subject,internal_date,snippet) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(account, msg.id, msg.threadId, contentHash(msg), direction, msg.from, [msg.to, msg.cc].filter(Boolean).join(", "), msg.subject, msg.internalDate, msg.text.slice(0, 30000));
            }
          }).immediate();
          for (const msg of full) {
            const message = db.prepare("SELECT * FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(account, msg.id) as SternEmailMessage;
            const duplicate = db.prepare("SELECT id FROM stern_email_messages WHERE content_hash=? AND id<>? AND abs(internal_date-?)<=? AND (id<? OR applied NOT IN ('pending','error')) LIMIT 1").get(message.content_hash, message.id, message.internal_date, 3 * 86400000, message.id);
            const result = duplicate ? null : await classifyEmail({ ...msg, account });
            const cls = result?.classification || { category: "irrelevant" as const, confidence: 0, direction: message.direction, people: [], requires_reply_from_me: false, summary: "Duplicate message", evidence_excerpt: "" };
            cls.direction = message.direction; // Model-provided direction never controls effects.
            const audit = messageMeta(message, cls);
            db.transaction(() => patch("email_message", message.id, { classification: JSON.stringify(cls), category: cls.category, confidence: cls.confidence, error: result?.error || "" }, audit)).immediate();
            counts.messages++;
            if (duplicate) { db.transaction(() => patch("email_message", message.id, { applied: "duplicate", processed_at: nowIso() }, audit)).immediate(); counts.duplicates++; }
            else {
              const applied = await applyClassification(row<SternEmailMessage>("email_message", message.id), cls, { ...options, source, audit });
              if (result?.error) counts.errors++;
              if (applied.applied === "auto_applied") counts.applied++;
              else if (applied.applied === "suggested") counts.suggested++;
              else counts.ignored++;
              counts.calendarIntents.push(...applied.calendarIntents);
            }
            watermark = Math.max(watermark, msg.internalDate);
          }
          db.transaction(() => db.prepare(`INSERT INTO stern_scan_state(account,last_internal_date,last_checked,last_error,messages_seen) VALUES (?,?,?,'',(SELECT COUNT(*) FROM stern_email_messages WHERE gmail_account=?)) ON CONFLICT(account) DO UPDATE SET last_internal_date=excluded.last_internal_date,last_checked=excluded.last_checked,last_error='',messages_seen=excluded.messages_seen`).run(account, watermark, nowIso(), account)).immediate();
        } catch (error) {
          counts.failures++;
          db.transaction(() => db.prepare(`INSERT INTO stern_scan_state(account,last_checked,last_error) VALUES (?,?,?) ON CONFLICT(account) DO UPDATE SET last_checked=excluded.last_checked,last_error=excluded.last_error`).run(account, nowIso(), error instanceof Error ? error.message.slice(0, 200) : "Account scan failed")).immediate();
        }
      }
      const rules = await runRulesPass({ now: options.now });
      counts.errors += rules.errors.length;
      emit("gmail_scan", "running", "Stern email scan counts");
      emit(counts.failures || counts.errors ? "failed" : "completed", counts.failures || counts.errors ? "failed" : "completed", "Stern email scan finished");
      return counts;
    } catch (error) { emit("failed", "failed", "Stern email scan failed"); throw error; }
  });
}
