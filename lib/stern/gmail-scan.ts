import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { recordAgentEvent } from "@/lib/agents";
import type { SternEmailMessage } from "@/lib/stern-types";
import type { GmailFullMessage } from "@/lib/sources/google";
import { classifyEmail, llmMode } from "./llm";
import { addresses, applyClassification, messageMeta } from "./apply";
import { row } from "./recruiting-write";
import { accountsToScan, automationJob, automationSource, type AutomationSource } from "./automation-source";
import { runRulesPass } from "./rules-pass";
export { accountsToScan } from "./automation-source";
export function contentHash(msg: Pick<GmailFullMessage, "from" | "subject" | "text">): string {
  // Strip only a leading forwarding envelope, preserving the underlying message text.
  const text = msg.text.replace(/\r\n/g, "\n");
  const envelope = text.match(/^\s*-+\s*Forwarded message\s*-+\n(?:[^\n]+\n)*?\n+/i)?.[0] || "";
  const from = envelope.match(/^From:\s*(.+)$/im)?.[1] || msg.from;
  const body = text.slice(envelope.length);
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(`${addresses(from)[0] || normalized(from)}|${normalized(msg.subject.replace(/^(?:fwd?:\s*)+/i, ""))}|${normalized(body).slice(0, 2000)}`).digest("hex");
}
export function runSternEmailScan(options: { dryRun?: boolean; source?: AutomationSource; now?: Date } = {}) {
  return automationJob(async () => {
    const counts = { accounts: 0, failures: 0, messages: 0, duplicates: 0, applied: 0, suggested: 0, ignored: 0, errors: 0, calendarIntents: [] as unknown[] };
    if (llmMode() === "off" && !options.source) return counts;
    const db = getDb(), source = options.source || automationSource(), accounts = accountsToScan();
    if (!accounts.length) return counts;
    const own = (db.prepare("SELECT email FROM google_accounts").all() as { email: string }[]).map(r => r.email.toLowerCase());
    const runId = `stern-email-${crypto.randomUUID()}`;
    const emit = (kind: string, status: string, summary: string) => recordAgentEvent({ agent: "stern-automation", run: runId, kind, status, summary, detail: JSON.stringify(counts), triggerType: "scheduler", triggerSource: "Stern email scanner" });
    emit("started", "running", "Stern email scan started");
    try {
      for (const account of accounts) {
        counts.accounts++;
        let watermark = (db.prepare("SELECT last_internal_date FROM stern_scan_state WHERE account=?").get(account) as { last_internal_date: number } | undefined)?.last_internal_date || 0;
        try {
          // Retry independently of the Gmail watermark. After three failures, cool down
          // for six hours without ever discarding unclassified messages.
          const retryRows = db.prepare("SELECT gmail_message_id FROM stern_email_messages WHERE gmail_account=? AND applied IN ('pending','error')").all(account) as { gmail_message_id: string }[];
          const ids = [...new Set([...await source.list(account, watermark, { labels: ["INBOX", "SENT"] }), ...retryRows.map(r => r.gmail_message_id)])];
          const full: GmailFullMessage[] = [];
          for (const id of ids) {
            const prior = db.prepare("SELECT * FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(account, id) as SternEmailMessage | undefined;
            if (prior && !retryable(prior)) continue;
            try {
              const msg = await source.full(account, id);
              if (!Number.isFinite(msg.internalDate) || msg.internalDate <= 0) throw new Error("Invalid Gmail internal date");
              full.push(msg);
            } catch (error) {
              db.transaction(() => {
                db.prepare("INSERT OR IGNORE INTO stern_email_messages(gmail_account,gmail_message_id) VALUES (?,?)").run(account, id);
                const m = db.prepare("SELECT * FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(account, id) as SternEmailMessage;
                if (retryable(m)) recordFailure(m, error instanceof Error ? error.message : "Message fetch failed");
              }).immediate();
              counts.errors++;
            }
          }
          full.sort((a, b) => a.internalDate - b.internalDate || a.id.localeCompare(b.id));
          // Ingest the whole page first, so a later outbound reply suppresses stale reply-needed flags.
          db.transaction(() => {
            for (const msg of full) {
              const direction = addresses(msg.from).some(email => own.includes(email)) ? "outbound" : "inbound";
              db.prepare(`INSERT INTO stern_email_messages (gmail_account,gmail_message_id,gmail_thread_id,content_hash,direction,from_addr,to_addrs,subject,internal_date,snippet) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(gmail_account,gmail_message_id) DO UPDATE SET gmail_thread_id=excluded.gmail_thread_id,content_hash=excluded.content_hash,direction=excluded.direction,from_addr=excluded.from_addr,to_addrs=excluded.to_addrs,subject=excluded.subject,internal_date=excluded.internal_date,snippet=excluded.snippet`).run(account, msg.id, msg.threadId, contentHash(msg), direction, msg.from, [msg.to, msg.cc].filter(Boolean).join(", "), msg.subject, msg.internalDate, msg.text.slice(0, 30000));
            }
          }).immediate();
          for (const msg of full) {
            // Claim in an IMMEDIATE transaction across CLI/server processes. A crashed
            // claim expires after ten minutes (the classifier is bounded to four).
            const message = db.transaction(() => {
              const current = db.prepare("SELECT * FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?").get(account, msg.id) as SternEmailMessage;
              if (!retryable(current)) return null;
              db.prepare("UPDATE stern_email_messages SET applied='pending',processed_at=? WHERE id=?").run(nowIso(), current.id);
              return current;
            }).immediate();
            if (!message) continue;
            const duplicate = db.prepare("SELECT id FROM stern_email_messages WHERE content_hash=? AND applied<>'duplicate' AND id<>? AND abs(internal_date-?)<=? AND (id<? OR applied NOT IN ('pending','error')) LIMIT 1").get(message.content_hash, message.id, message.internal_date, 3 * 86400000, message.id);
            const result = duplicate ? null : await classifyEmail({ ...msg, account });
            const cls = result?.classification || { category: "irrelevant" as const, confidence: 0, direction: message.direction, people: [], requires_reply_from_me: false, summary: "Duplicate message", evidence_excerpt: "" };
            cls.direction = message.direction; // Model-provided direction never controls effects.
            const audit = messageMeta(message, cls);
            db.transaction(() => db.prepare("UPDATE stern_email_messages SET classification=?,category=?,confidence=? WHERE id=?").run(JSON.stringify(cls), cls.category, cls.confidence, message.id)).immediate();
            counts.messages++;
            if (result?.error) { db.transaction(() => recordFailure(message, result.error)).immediate(); counts.errors++; }
            else if (duplicate) { db.transaction(() => db.prepare("UPDATE stern_email_messages SET applied='duplicate',error='',processed_at=? WHERE id=?").run(nowIso(), message.id)).immediate(); counts.duplicates++; }
            else {
              const applied = await applyClassification(row<SternEmailMessage>("email_message", message.id), cls, { ...options, source, audit });
              if (applied.applied === "auto_applied") counts.applied++;
              else if (applied.applied === "suggested") counts.suggested++;
              else counts.ignored++;
              counts.calendarIntents.push(...applied.calendarIntents);
            }
            watermark = Math.max(watermark, msg.internalDate);
          }
          db.transaction(() => db.prepare(`INSERT INTO stern_scan_state(account,last_internal_date,last_checked,last_error,messages_seen) VALUES (?,?,?,?,(SELECT COUNT(*) FROM stern_email_messages WHERE gmail_account=?)) ON CONFLICT(account) DO UPDATE SET last_internal_date=excluded.last_internal_date,last_checked=excluded.last_checked,last_error=excluded.last_error,messages_seen=excluded.messages_seen`).run(account, watermark, nowIso(), errorSummary(account), account)).immediate();
        } catch (error) {
          counts.failures++;
          db.transaction(() => db.prepare(`INSERT INTO stern_scan_state(account,last_checked,last_error) VALUES (?,?,?) ON CONFLICT(account) DO UPDATE SET last_checked=excluded.last_checked,last_error=excluded.last_error`).run(account, nowIso(), error instanceof Error ? error.message.slice(0, 200) : "Account scan failed")).immediate();
        }
      }
      const rules = await runRulesPass({ now: options.now });
      counts.errors += rules.errors.length;
      emit("gmail_scan", "running", "Stern email scan counts");
      emit(counts.failures ? "failed" : "completed", counts.failures ? "failed" : "completed", "Stern email scan finished");
      return counts;
    } catch (error) { emit("failed", "failed", "Stern email scan failed"); throw error; }
  });
}

function attempts(message: SternEmailMessage): number { return Number(message.error.match(/^\[attempt (\d+)\]/)?.[1] || 0); }
function retryable(message: SternEmailMessage): boolean {
  const age = Date.now() - Date.parse(message.processed_at);
  if (message.applied === "pending") return !message.processed_at || age >= 10 * 60000;
  return message.applied === "error" && (attempts(message) < 3 || age >= 6 * 3600000);
}
function recordFailure(message: SternEmailMessage, error: string) {
  getDb().prepare("UPDATE stern_email_messages SET applied='error',error=?,processed_at=? WHERE id=?")
    .run(`[attempt ${attempts(message) + 1}] ${error.slice(0, 200)}`, nowIso(), message.id);
}
function errorSummary(account: string): string {
  const { n } = getDb().prepare("SELECT COUNT(*) n FROM stern_email_messages WHERE gmail_account=? AND applied='error'").get(account) as { n: number };
  return n ? `${n} message(s) awaiting retry; inspect message errors (six-hour cooldown after three failures)` : "";
}
