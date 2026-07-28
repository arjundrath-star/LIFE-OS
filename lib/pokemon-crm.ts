// Pokemon CRM server helpers. Server-only (reads/writes SQLite via @/db).
// Core invariant: leads start inactive; logging ANY touchpoint flips active=1
// permanently (nothing ever sets it back). Phone/email rows are never deleted —
// dead numbers keep their status and stay visible, crossed out, in the UI.
import { all, get, getDb } from "@/db";

export const STAGES = [
  "new",
  "call_queue",
  "visit_queue",
  "contacted",
  "interested",
  "follow_up",
  "no",
  "placed",
  "hold",
] as const;

export const PHONE_STATUSES = [
  "untested",
  "good",
  "no_answer",
  "left_vm",
  "reached_owner",
  "reached_manager",
  "wrong_person",
  "bad",
  "dnc",
] as const;

// "usable" = still worth dialing (rendered green); dead numbers stay visible but struck out.
export const USABLE_PHONE_STATUSES = ["untested", "good"] as const;

export const EMAIL_STATUSES = [
  "untested",
  "emailed",
  "replied",
  "bounced",
  "wrong_person",
  "do_not_email",
] as const;

export const TOUCHPOINT_TYPES = ["call", "vm", "visit", "note", "email", "followup"] as const;

// Outcome buttons on a phone row: each sets the number's status AND logs a touchpoint.
export const PHONE_OUTCOMES: Record<
  string,
  { type: (typeof TOUCHPOINT_TYPES)[number]; outcome: string; isCall: boolean }
> = {
  no_answer: { type: "call", outcome: "Call — no answer", isCall: true },
  left_vm: { type: "vm", outcome: "Left voicemail", isCall: true },
  reached_owner: { type: "call", outcome: "Reached owner", isCall: true },
  reached_manager: { type: "call", outcome: "Reached manager", isCall: true },
  wrong_person: { type: "call", outcome: "Wrong person", isCall: true },
  bad: { type: "note", outcome: "Marked bad number", isCall: false },
  dnc: { type: "note", outcome: "Marked do not call", isCall: false },
};

function cleanText(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function cleanActor(v: unknown): string {
  return cleanText(v, 40) || "Operator";
}

// ---- reads ----

export function pokemonCrmSummary() {
  const row = get<any>(
    `SELECT
       (SELECT COUNT(*) FROM pokemon_leads) AS leads,
       (SELECT COUNT(*) FROM pokemon_leads WHERE active = 1) AS active_leads,
       (SELECT COUNT(*) FROM pokemon_contacts) AS contacts,
       (SELECT COUNT(*) FROM pokemon_phone_numbers) AS phones,
       (SELECT COUNT(*) FROM pokemon_phone_numbers WHERE status IN ('untested','good')) AS untested_phones,
       (SELECT COUNT(*) FROM pokemon_emails) AS emails,
       (SELECT COUNT(*) FROM pokemon_touchpoints) AS touchpoints,
       (SELECT COUNT(*) FROM pokemon_leads WHERE stage = 'follow_up') AS follow_ups`
  );
  return row!;
}

export function listLeads() {
  return all<any>(
    `SELECT l.id, l.venue_name, l.category, l.stage, l.active, l.source, l.address, l.city, l.state,
            l.website, l.venue_phone, l.rating, l.reviews, l.vending_score,
            l.pokemon_fit_score, l.owner_access_score, l.route_cluster,
            l.best_visit_window, l.priority, l.next_action, l.next_action_due, l.notes,
            l.created_at, l.updated_at,
            (SELECT COUNT(*) FROM pokemon_contacts c WHERE c.lead_id = l.id) AS contact_count,
            (SELECT COUNT(*) FROM pokemon_phone_numbers p WHERE p.lead_id = l.id
               AND p.status IN ('untested','good')) AS untested_count,
            (SELECT COUNT(*) FROM pokemon_touchpoints t WHERE t.lead_id = l.id) AS touchpoint_count,
            (SELECT MAX(t.occurred_at) FROM pokemon_touchpoints t WHERE t.lead_id = l.id) AS last_touch_at
     FROM pokemon_leads l
     ORDER BY (l.pokemon_fit_score IS NULL), l.pokemon_fit_score DESC,
              (l.vending_score IS NULL), l.vending_score DESC, l.venue_name`
  );
}

export function leadDetail(leadId: number) {
  const lead = get<any>(`SELECT * FROM pokemon_leads WHERE id = ?`, leadId);
  if (!lead) return null;
  const contacts = all<any>(
    `SELECT * FROM pokemon_contacts WHERE lead_id = ? ORDER BY id`,
    leadId
  );
  const phones = all<any>(
    `SELECT * FROM pokemon_phone_numbers WHERE lead_id = ? ORDER BY contact_id, priority_order, id`,
    leadId
  );
  const emails = all<any>(
    `SELECT * FROM pokemon_emails WHERE lead_id = ? ORDER BY contact_id, id`,
    leadId
  );
  const touchpoints = all<any>(
    `SELECT t.*, p.phone AS phone_number, c.name AS contact_name
     FROM pokemon_touchpoints t
     LEFT JOIN pokemon_phone_numbers p ON p.id = t.phone_id
     LEFT JOIN pokemon_contacts c ON c.id = t.contact_id
     WHERE t.lead_id = ?
     ORDER BY t.occurred_at DESC, t.id DESC`,
    leadId
  );
  return {
    lead,
    contacts: contacts.map((c) => ({
      ...c,
      phones: phones.filter((p) => p.contact_id === c.id),
      emails: emails.filter((e) => e.contact_id === c.id),
    })),
    // phones/emails PeopleFinder couldn't tie to one person — shown as a venue-level card
    leadPhones: phones.filter((p) => p.contact_id === null),
    leadEmails: emails.filter((e) => e.contact_id === null),
    touchpoints,
  };
}

export function pokemonCrmSnapshot() {
  return { summary: pokemonCrmSummary(), leads: listLeads() };
}

// ---- writes (all funnel through logTouchpoint for the active=1 invariant) ----

const now = () => new Date().toISOString();

function markLeadActive(leadId: number) {
  getDb()
    .prepare(`UPDATE pokemon_leads SET active = 1, updated_at = ? WHERE id = ?`)
    .run(now(), leadId);
}

export function logTouchpoint(input: {
  leadId: number;
  contactId?: number | null;
  phoneId?: number | null;
  emailId?: number | null;
  type: string;
  outcome: string;
  actor: string;
  notes?: string | null;
  nextActionAt?: string | null;
}): number {
  if (!TOUCHPOINT_TYPES.includes(input.type as any)) {
    throw new Error(`bad touchpoint type: ${input.type}`);
  }
  const db = getDb();
  // Nested calls (e.g. from logPhoneCall's tx) become savepoints automatically.
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO pokemon_touchpoints
           (lead_id, contact_id, phone_id, email_id, type, outcome, actor, raw_notes, next_action_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.leadId,
        input.contactId ?? null,
        input.phoneId ?? null,
        input.emailId ?? null,
        input.type,
        input.outcome,
        input.actor,
        cleanText(input.notes),
        cleanText(input.nextActionAt, 200)
      );
    markLeadActive(input.leadId);
    return Number(res.lastInsertRowid);
  });
  return tx.immediate();
}

export function updateLeadStage(leadId: number, stage: string) {
  if (!STAGES.includes(stage as any)) throw new Error(`bad stage: ${stage}`);
  getDb()
    .prepare(`UPDATE pokemon_leads SET stage = ?, updated_at = ? WHERE id = ?`)
    .run(stage, now(), leadId);
}

export function updateLeadNotes(leadId: number, notes: unknown) {
  getDb()
    .prepare(`UPDATE pokemon_leads SET notes = ?, updated_at = ? WHERE id = ?`)
    .run(cleanText(notes), now(), leadId);
}

export function updateLeadNextAction(leadId: number, nextAction: unknown, nextActionDue: unknown) {
  getDb()
    .prepare(
      `UPDATE pokemon_leads SET next_action = ?, next_action_due = ?, updated_at = ? WHERE id = ?`
    )
    .run(cleanText(nextAction, 300), cleanText(nextActionDue, 100), now(), leadId);
}

/** Outcome button on a phone row: set status, bump call stats, log the touchpoint. */
export function logPhoneCall(input: {
  leadId: number;
  phoneId: number;
  outcome: string;
  actor: string;
  notes?: string | null;
}) {
  const spec = PHONE_OUTCOMES[input.outcome];
  if (!spec) throw new Error(`bad phone outcome: ${input.outcome}`);
  const db = getDb();
  const phone = get<any>(
    `SELECT * FROM pokemon_phone_numbers WHERE id = ? AND lead_id = ?`,
    input.phoneId,
    input.leadId
  );
  if (!phone) throw new Error("phone not found on this lead");
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE pokemon_phone_numbers SET
         status = ?, last_result = ?, updated_at = ?,
         call_count = call_count + ?, last_called_at = COALESCE(?, last_called_at)
       WHERE id = ?`
    ).run(
      input.outcome,
      spec.outcome,
      now(),
      spec.isCall ? 1 : 0,
      spec.isCall ? now() : null,
      input.phoneId
    );
    logTouchpoint({
      leadId: input.leadId,
      contactId: phone.contact_id,
      phoneId: input.phoneId,
      type: spec.type,
      outcome: spec.outcome,
      actor: input.actor,
      notes: input.notes ?? `${phone.phone} · ${spec.outcome.toLowerCase()}`,
    });
  });
  tx.immediate();
}

/** Quick ✓/✕ mark: just flips the number's status. No touchpoint, no activation. */
export function updatePhoneStatus(phoneId: number, status: string, notes?: unknown) {
  if (!PHONE_STATUSES.includes(status as any)) throw new Error(`bad phone status: ${status}`);
  const res = getDb()
    .prepare(
      `UPDATE pokemon_phone_numbers SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`
    )
    .run(status, cleanText(notes), now(), phoneId);
  if (res.changes === 0) throw new Error("phone not found");
}

/** Email status select. 'emailed'/'replied' are real touchpoints and activate the lead. */
export function updateEmailStatus(input: {
  leadId: number;
  emailId: number;
  status: string;
  actor: string;
}) {
  if (!EMAIL_STATUSES.includes(input.status as any)) {
    throw new Error(`bad email status: ${input.status}`);
  }
  const db = getDb();
  const email = get<any>(
    `SELECT * FROM pokemon_emails WHERE id = ? AND lead_id = ?`,
    input.emailId,
    input.leadId
  );
  if (!email) throw new Error("email not found on this lead");
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE pokemon_emails SET status = ?, updated_at = ?,
         last_emailed_at = CASE WHEN ? = 'emailed' THEN ? ELSE last_emailed_at END
       WHERE id = ?`
    ).run(input.status, now(), input.status, now(), input.emailId);
    if (input.status === "emailed" || input.status === "replied") {
      logTouchpoint({
        leadId: input.leadId,
        contactId: email.contact_id,
        emailId: input.emailId,
        type: "email",
        outcome: input.status === "replied" ? "Email reply received" : "Email logged",
        actor: input.actor,
        notes: email.email,
      });
    }
  });
  tx.immediate();
}

export function addContact(leadId: number, name: unknown, title: unknown): number {
  const cleanName = cleanText(name, 120);
  if (!cleanName) throw new Error("contact name required");
  const res = getDb()
    .prepare(
      `INSERT INTO pokemon_contacts (lead_id, name, title, source_note, confidence)
       VALUES (?, ?, ?, 'manual entry', 'needs_review')`
    )
    .run(leadId, cleanName, cleanText(title, 120));
  return Number(res.lastInsertRowid);
}

export function addPhone(leadId: number, contactId: number | null, phone: unknown): void {
  const raw = cleanText(phone, 40);
  if (!raw) throw new Error("phone required");
  const digits = raw.replace(/\D+/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const formatted = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
  // UNIQUE(lead_id, contact_id, phone) doesn't fire when contact_id IS NULL
  // (SQLite treats NULLs as distinct) — dedupe venue-level numbers explicitly.
  if (contactId == null) {
    const dup = get<any>(
      `SELECT id FROM pokemon_phone_numbers WHERE lead_id = ? AND contact_id IS NULL AND phone = ?`,
      leadId,
      formatted
    );
    if (dup) throw new Error("phone already exists on this lead/contact");
  }
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO pokemon_phone_numbers (lead_id, contact_id, phone, priority_order)
       VALUES (?, ?, ?, 500)`
    )
    .run(leadId, contactId ?? null, formatted);
  if (res.changes === 0) throw new Error("phone already exists on this lead/contact");
}
