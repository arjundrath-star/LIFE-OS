// Import the Pokemon lead-agent pipeline CSV into the Rathworkspace CRM.
//
// Safety invariants:
// - stable Lead ID is the primary identity; normalized venue + nonblank address is
//   deterministic shadow evidence only; no fuzzy merge is ever attempted;
// - identity disagreements are reported and block mutation;
// - existing CRM-owned lead fields are preserved;
// - a true no-op does not touch pokemon_leads.updated_at or emit a ticker event;
// - successful imports write a transactional fingerprint receipt that can be
//   independently verified before a worker skips this sink.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, pushEvent } from "@/db";
import { ownerAccessScore, pokemonFitScore } from "@/lib/pokemon-fit";

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FINGERPRINT_VERSION = "pokemon-pipeline-v1";
const FINGERPRINT_IGNORED_FIELDS = new Set([
  "Active Lead",
  "Status",
  "Date added",
  "Last enriched at",
  "Moved to Active",
  "Active Lead Batch",
  "Active Lead Added At",
  "Active Outreach Status",
]);

type Row = Record<string, string>;
type DbLead = { id: number; external_key: string | null; venue_name: string; address: string | null; raw_json: string | null };
type Diagnostic = {
  code: string;
  severity: "blocking" | "warning";
  rows?: number[];
  lead_id?: string;
  location_key?: string;
  crm_lead_ids?: number[];
  detail: string;
};
type ParsedArgs = {
  file: string | null;
  dryRun: boolean;
  verifyFingerprint: string | null;
  expectFingerprint: string | null;
  runId: string | null;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let dryRun = false;
  let verifyFingerprint: string | null = null;
  let expectFingerprint: string | null = null;
  let runId: string | null = null;
  let file: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--verify-fingerprint") verifyFingerprint = args[++i] || null;
    else if (arg === "--expect-fingerprint") expectFingerprint = args[++i] || null;
    else if (arg === "--run-id") runId = args[++i] || null;
    else if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    else if (!file) file = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (verifyFingerprint && file) throw new Error("--verify-fingerprint does not accept a CSV path");
  if (!verifyFingerprint && !file) {
    throw new Error("usage: import-pokemon-pipeline-crm [--dry-run] [--expect-fingerprint SHA256] [--run-id ID] FILE | --verify-fingerprint SHA256");
  }
  return { file, dryRun, verifyFingerprint, expectFingerprint, runId };
}

// RFC 4180-ish CSV parser; handles quoted commas/newlines and BOM.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function rowsFromCsv(abs: string): Row[] {
  const parsed = parseCsv(fs.readFileSync(abs, "utf8"));
  if (parsed.length < 2) return [];
  const header = parsed[0].map((h) => h.trim());
  return parsed.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] || "").trim()])) as Row
  );
}

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAddress(value: string): string {
  let text = normalizeText(value);
  const replacements: Array<[RegExp, string]> = [
    [/\bavenue\b/g, "ave"], [/\bstreet\b/g, "st"], [/\broad\b/g, "rd"],
    [/\bdrive\b/g, "dr"], [/\bboulevard\b/g, "blvd"], [/\bplace\b/g, "pl"],
    [/\blane\b/g, "ln"], [/\bhighway\b/g, "hwy"], [/\bmassachusetts\b/g, "ma"],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

function locationKey(venue: string, address: string): string | null {
  const v = normalizeText(venue);
  const a = normalizeAddress(address);
  return v && a ? `${v}|${a}` : null;
}

function stableObject(row: Row): Record<string, string> {
  return Object.fromEntries(
    Object.keys(row)
      .filter((key) => !FINGERPRINT_IGNORED_FIELDS.has(key))
      .sort()
      .map((key) => [key, String(row[key] || "").trim().replace(/\s+/g, " ")])
  );
}

function canonicalRow(row: Row): string {
  return JSON.stringify(stableObject(row));
}

function sourceFingerprint(rows: Row[]): string {
  const canonical = rows.map(canonicalRow).sort();
  return crypto.createHash("sha256").update(`${FINGERPRINT_VERSION}\n${canonical.join("\n")}`).digest("hex");
}

function normPhone(s: string): string {
  const match = (s || "").match(PHONE_RE)?.[0] || s || "";
  const digits = match.replace(/\D+/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return match.trim();
}

function cleanEmail(s: string): string | null {
  return (s || "").match(EMAIL_RE)?.[0]?.toLowerCase() || null;
}

function pipelineBaseScore(row: Row): number {
  const fit = (row["Fit score"] || "").toLowerCase();
  const tier = (row["Tier"] || "").toLowerCase();
  let score = fit === "high" ? 82 : fit === "good" ? 70 : fit === "fair" ? 55 : fit === "low" ? 35 : 50;
  if (tier.includes("pilot")) score += 8;
  if (tier.includes("fast cash")) score += 5;
  if (tier.includes("anchor")) score += 3;
  if (tier.includes("hold")) score -= 8;
  if ((row["Walk-in priority"] || "").toLowerCase() === "high") score += 4;
  if ((row["Walk-in priority"] || "").toLowerCase() === "low") score -= 4;
  return Math.max(0, Math.min(100, score));
}

function priorityFromRow(row: Row): string {
  const p = (row["Walk-in priority"] || row["Fit score"] || "medium").toLowerCase();
  return p.includes("high") ? "high" : p.includes("low") ? "low" : "medium";
}

function bestWindow(row: Row): string | null {
  const category = `${row["Category"] || ""} ${row["Subcategory"] || ""}`.toLowerCase();
  if (/convenience|gas|market|arcade|entertainment|dessert|pizza/.test(category)) return "weekend or 7-10 PM";
  return row["Walk-in ease"] || null;
}

function noteFromRow(row: Row): string | null {
  const parts = [row["Pokemon buyer-fit rationale"], row["Foot-traffic / impulse rationale"], row["Corporate/franchise friction"], row["Space / placement note"], row["Notes"]].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function mapPush<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const items = map.get(key) || [];
  items.push(value);
  map.set(key, items);
}

function identityPlan(rows: Row[], dbLeads: DbLead[]) {
  const diagnostics: Diagnostic[] = [];
  const sourceByLeadId = new Map<string, number[]>();
  const sourceByLocation = new Map<string, number[]>();
  const dbByLeadId = new Map<string, DbLead[]>();
  const dbByLocation = new Map<string, DbLead[]>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const leadId = row["Lead ID"] || "";
    const loc = locationKey(row["Venue"] || "", row["Address"] || "");
    if (!row["Venue"]) diagnostics.push({ code: "missing_venue", severity: "blocking", rows: [line], detail: `row ${line}: missing Venue` });
    if (!leadId) diagnostics.push({ code: "missing_lead_id", severity: "blocking", rows: [line], detail: `row ${line}: missing stable Lead ID` });
    else mapPush(sourceByLeadId, leadId, line);
    if (loc) mapPush(sourceByLocation, loc, line);
    else diagnostics.push({ code: "blank_address", severity: "warning", rows: [line], lead_id: leadId || undefined, detail: `row ${line}: blank address; identity is Lead ID only` });
  });
  for (const lead of dbLeads) {
    if (lead.external_key) mapPush(dbByLeadId, lead.external_key, lead);
    const loc = locationKey(lead.venue_name, lead.address || "");
    if (loc) mapPush(dbByLocation, loc, lead);
  }
  for (const [leadId, lines] of sourceByLeadId) {
    if (lines.length > 1) diagnostics.push({ code: "duplicate_lead_id", severity: "blocking", rows: lines, lead_id: leadId, detail: `Lead ID ${leadId} appears on multiple source rows` });
  }
  for (const [loc, lines] of sourceByLocation) {
    if (lines.length > 1) diagnostics.push({ code: "normalized_location_collision", severity: "blocking", rows: lines, location_key: loc, detail: "multiple source rows normalize to the same venue/address" });
  }
  for (const [leadId, leads] of dbByLeadId) {
    if (leads.length > 1) diagnostics.push({ code: "crm_duplicate_lead_id", severity: "blocking", lead_id: leadId, crm_lead_ids: leads.map((lead) => lead.id), detail: `CRM has multiple rows with Lead ID ${leadId}` });
  }
  for (const [loc, leads] of dbByLocation) {
    if (leads.length > 1) diagnostics.push({ code: "crm_normalized_location_collision", severity: "blocking", location_key: loc, crm_lead_ids: leads.map((lead) => lead.id), detail: "CRM has multiple rows at the same normalized venue/address" });
  }

  const matches: Array<DbLead | null> = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const leadId = row["Lead ID"] || "";
    const loc = locationKey(row["Venue"] || "", row["Address"] || "");
    const idMatches = leadId ? (dbByLeadId.get(leadId) || []) : [];
    if (idMatches.length === 1) {
      const match = idMatches[0];
      const oldLoc = locationKey(match.venue_name, match.address || "");
      if (loc && oldLoc && loc !== oldLoc) diagnostics.push({ code: "lead_id_location_mismatch", severity: "blocking", rows: [line], lead_id: leadId, location_key: loc, crm_lead_ids: [match.id], detail: "Lead ID matches CRM but normalized venue/address disagrees; manual review required" });
      matches.push(match);
      return;
    }
    if (idMatches.length > 1) { matches.push(null); return; }
    const locMatches = loc ? (dbByLocation.get(loc) || []) : [];
    if (locMatches.length === 1) {
      const match = locMatches[0];
      if (leadId && match.external_key && match.external_key !== leadId) diagnostics.push({ code: "location_lead_id_conflict", severity: "blocking", rows: [line], lead_id: leadId, location_key: loc || undefined, crm_lead_ids: [match.id], detail: `normalized location belongs to CRM Lead ID ${match.external_key}` });
      matches.push(match);
      return;
    }
    matches.push(null);
  });

  diagnostics.sort((a, b) => `${a.severity}|${a.code}|${a.rows?.[0] || 0}`.localeCompare(`${b.severity}|${b.code}|${b.rows?.[0] || 0}`));
  return {
    diagnostics,
    matches,
    blocking: diagnostics.filter((item) => item.severity === "blocking"),
    warnings: diagnostics.filter((item) => item.severity === "warning"),
  };
}

function sameCanonicalRaw(raw: string | null, row: Row): boolean {
  if (!raw) return false;
  try { return canonicalRow(JSON.parse(raw) as Row) === canonicalRow(row); }
  catch { return false; }
}

function verifyReceipt(fingerprint: string) {
  const receipt = getDb().prepare(`SELECT source_fingerprint, run_id, row_count, imported_at FROM pokemon_pipeline_sink_receipts WHERE source_fingerprint = ?`).get(fingerprint) as any;
  return { mode: "verify", source_fingerprint: fingerprint, verified: !!receipt, receipt: receipt || null };
}

function processRows(abs: string, dryRun: boolean, expectFingerprint: string | null, runId: string | null) {
  const rows = rowsFromCsv(abs);
  const fingerprint = sourceFingerprint(rows);
  if (expectFingerprint && expectFingerprint !== fingerprint) throw new Error(`source fingerprint changed after preflight: expected ${expectFingerprint}, got ${fingerprint}`);
  const db = getDb();
  const dbLeads = db.prepare(`SELECT id, external_key, venue_name, address, raw_json FROM pokemon_leads`).all() as DbLead[];
  const identity = identityPlan(rows, dbLeads);
  const base = {
    dry_run: dryRun,
    fingerprint_version: FINGERPRINT_VERSION,
    source_fingerprint: fingerprint,
    row_count: rows.length,
    identity: {
      blocking_count: identity.blocking.length,
      warning_count: identity.warnings.length,
      diagnostics: identity.diagnostics,
      match_strategy: "Lead ID primary; normalized venue plus nonblank address shadow match; no fuzzy merges",
    },
    skipped: identity.blocking.length,
    warnings: identity.warnings.map((item) => item.detail),
  };
  if (dryRun) return { ...base, would_create: identity.matches.filter((match) => !match).length, would_match: identity.matches.filter(Boolean).length };
  if (identity.blocking.length) throw new Error(`identity preflight blocked import: ${JSON.stringify(identity.blocking)}`);

  const counts = { leads_created: 0, leads_updated: 0, leads_unchanged: 0, contacts_created: 0, phones_created: 0, emails_created: 0, import_batch_created: 0 };
  let receipt: any = null;
  let mutated = false;
  const tx = db.transaction(() => {
    const existingReceipt = db.prepare(`SELECT source_fingerprint, run_id, row_count, imported_at FROM pokemon_pipeline_sink_receipts WHERE source_fingerprint = ?`).get(fingerprint) as any;
    if (existingReceipt) { receipt = existingReceipt; return; }
    const batch = db.prepare(`INSERT INTO pokemon_import_batches (source_filename, source_kind, row_count) VALUES (?, 'pokemon_pipeline_csv', ?)`).run(path.basename(abs), rows.length);
    const batchId = Number(batch.lastInsertRowid);
    counts.import_batch_created = 1;

    const insertLead = db.prepare(`INSERT INTO pokemon_leads
      (external_key, venue_name, category, address, city, state, website, venue_phone, vending_score,
       pokemon_fit_score, owner_access_score, route_cluster, best_visit_window, priority, next_action,
       source, source_batch_id, raw_json, notes)
      VALUES (@external_key, @venue_name, @category, @address, @city, @state, @website, @venue_phone,
       @vending_score, @pokemon_fit_score, @owner_access_score, @route_cluster, @best_visit_window,
       @priority, @next_action, 'pokemon_lead_agent', @batch_id, @raw_json, @notes)`);
    // Existing operational fields are CRM-owned. Only source provenance/backfill is refreshed.
    const updateProvenance = db.prepare(`UPDATE pokemon_leads SET
      external_key = COALESCE(external_key, @external_key), source_batch_id = @batch_id,
      raw_json = @raw_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id`);
    const findContact = db.prepare(`SELECT id FROM pokemon_contacts WHERE lead_id = ? AND name = ?`);
    const insertContact = db.prepare(`INSERT INTO pokemon_contacts (lead_id, name, title, source_note, confidence, raw_contact_cell) VALUES (?, ?, ?, ?, ?, ?)`);
    const findPhone = db.prepare(`SELECT id FROM pokemon_phone_numbers WHERE lead_id = ? AND COALESCE(contact_id, -1) = COALESCE(?, -1) AND phone = ?`);
    const insertPhone = db.prepare(`INSERT INTO pokemon_phone_numbers (lead_id, contact_id, phone, phone_type, priority_order) VALUES (?, ?, ?, ?, ?)`);
    const findEmail = db.prepare(`SELECT id FROM pokemon_emails WHERE lead_id = ? AND email = ?`);
    const insertEmail = db.prepare(`INSERT INTO pokemon_emails (lead_id, contact_id, email, source) VALUES (?, ?, ?, ?)`);

    rows.forEach((row, idx) => {
      const venue = row["Venue"];
      const address = row["Address"] || "";
      const baseScore = pipelineBaseScore(row);
      const ownerName = row["Owner name candidate"] || row["Decision-maker name"] || "";
      const ownerPhone = normPhone(row["Owner phone"] || "");
      const publicPhone = normPhone(row["Public contact phone"] || row["Phone"] || "");
      const ownerEmail = cleanEmail(row["Owner email"] || "");
      const publicEmail = cleanEmail(row["Public contact email"] || "");
      const fitInput = { venue_name: venue, category: row["Category"] || null, vending_score: baseScore, rating: null, reviews: null, has_owner_name: !!ownerName, has_owner_phone: !!ownerPhone, has_phone: !!(ownerPhone || publicPhone), has_email: !!(ownerEmail || publicEmail), has_address: !!address, has_website: !!row["Website"] };
      const values = {
        external_key: row["Lead ID"], venue_name: venue, category: row["Category"] || null,
        address, city: row["City"] || null, state: row["State"] || null,
        website: row["Website"] || null, venue_phone: normPhone(row["Phone"] || row["Public contact phone"] || "") || null,
        vending_score: baseScore, pokemon_fit_score: pokemonFitScore(fitInput), owner_access_score: ownerAccessScore(fitInput),
        route_cluster: row["Region"] || null, best_visit_window: bestWindow(row), priority: priorityFromRow(row),
        next_action: row["Suggested first move"] || null, batch_id: batchId, raw_json: JSON.stringify(row), notes: noteFromRow(row),
      };
      let leadId: number;
      const existing = identity.matches[idx];
      if (!existing) {
        const result = insertLead.run(values);
        leadId = Number(result.lastInsertRowid);
        counts.leads_created++; mutated = true;
      } else {
        leadId = existing.id;
        if ((!existing.external_key && values.external_key) || !sameCanonicalRaw(existing.raw_json, row)) {
          updateProvenance.run({ id: leadId, external_key: values.external_key, batch_id: batchId, raw_json: values.raw_json });
          counts.leads_updated++; mutated = true;
        } else counts.leads_unchanged++;
      }

      let contactId: number | null = null;
      if (ownerName) {
        const found = findContact.get(leadId, ownerName) as { id: number } | undefined;
        if (found) contactId = found.id;
        else {
          const result = insertContact.run(leadId, ownerName, row["Owner title/role"] || row["Decision-maker role"] || null, row["Owner source"] || row["Owner/franchise notes"] || null, row["Owner confidence"] || "needs_review", JSON.stringify({ owner_fields: true, lead_id: row["Lead ID"] }));
          contactId = Number(result.lastInsertRowid); counts.contacts_created++; mutated = true;
        }
      }
      const phones = [
        ...(ownerPhone ? [{ phone: ownerPhone, type: "owner_candidate", contact: contactId, priority: 1 }] : []),
        ...(publicPhone ? [{ phone: publicPhone, type: "venue", contact: null, priority: 50 }] : []),
      ];
      for (const item of phones) if (!findPhone.get(leadId, item.contact, item.phone)) { insertPhone.run(leadId, item.contact, item.phone, item.type, item.priority); counts.phones_created++; mutated = true; }
      const emails = [
        { email: ownerEmail, contact: contactId, source: "pokemon_pipeline_owner" },
        { email: publicEmail, contact: null, source: "pokemon_pipeline_public" },
      ];
      for (const item of emails) if (item.email && !findEmail.get(leadId, item.email)) { insertEmail.run(leadId, item.contact, item.email, item.source); counts.emails_created++; mutated = true; }
    });

    db.prepare(`UPDATE pokemon_import_batches SET leads_created=?, leads_updated=?, contacts_created=?, phones_created=?, emails_created=?, warnings_json=? WHERE id=?`).run(counts.leads_created, counts.leads_updated, counts.contacts_created, counts.phones_created, counts.emails_created, JSON.stringify(identity.warnings), batchId);
    db.prepare(`INSERT INTO pokemon_pipeline_sink_receipts (source_fingerprint, run_id, row_count) VALUES (?, ?, ?)`).run(fingerprint, runId, rows.length);
    receipt = db.prepare(`SELECT source_fingerprint, run_id, row_count, imported_at FROM pokemon_pipeline_sink_receipts WHERE source_fingerprint = ?`).get(fingerprint);
  });
  tx.immediate();

  if (mutated) pushEvent("pokemon-crm", `Pokemon pipeline import: ${counts.leads_created} created, ${counts.leads_updated} provenance-refreshed, ${counts.leads_unchanged} unchanged`, "success");
  return { ...base, ...counts, sink_verified: !!receipt, receipt, no_op: !mutated };
}

function main() {
  try {
    const args = parseArgs();
    if (args.verifyFingerprint) {
      console.log(JSON.stringify(verifyReceipt(args.verifyFingerprint), null, 2));
      return;
    }
    const abs = path.resolve(args.file!);
    if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
    console.log(JSON.stringify(processRows(abs, args.dryRun, args.expectFingerprint, args.runId), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
