// Import the legacy Pokemon lead-agent MAIN pipeline CSV into the Pokemon CRM DB.
//
// This is the bridge from the old spreadsheet-shaped lead scout output to the
// Rathworkspace-native CRM. It is idempotent on (venue_name, address), preserves
// active/stage/touchpoint history, and does not send outreach.
//
//   npm run import-pokemon-pipeline-crm -- "/path/to/Pokemon_Vending_Lead_Pipeline.csv"
//   npm run import-pokemon-pipeline-crm -- --dry-run "/path/to/Pokemon_Vending_Lead_Pipeline.csv"
import fs from "node:fs";
import path from "node:path";
import { getDb, pushEvent } from "@/db";
import { ownerAccessScore, pokemonFitScore } from "@/lib/pokemon-fit";

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

type Row = Record<string, string>;

type ParsedArgs = { file: string; dryRun: boolean };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.filter((a) => a !== "--dry-run")[0];
  if (!file) {
    console.error("usage: npm run import-pokemon-pipeline-crm -- [--dry-run] /path/to/Pokemon_Vending_Lead_Pipeline.csv");
    process.exit(1);
  }
  return { file, dryRun };
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
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
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

function intOrNull(s: string): number | null {
  const n = parseInt(String(s || "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function pipelineBaseScore(row: Row): number {
  const fit = (row["Fit score"] || "").toLowerCase();
  const tier = (row["Tier"] || "").toLowerCase();
  let score = 50;
  if (fit === "high") score = 82;
  else if (fit === "good") score = 70;
  else if (fit === "fair") score = 55;
  else if (fit === "low") score = 35;
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
  if (p.includes("high")) return "high";
  if (p.includes("low")) return "low";
  return "medium";
}

function bestWindow(row: Row): string | null {
  const category = `${row["Category"] || ""} ${row["Subcategory"] || ""}`.toLowerCase();
  if (category.includes("convenience") || category.includes("gas") || category.includes("market")) return "weekend or 7-10 PM";
  if (category.includes("arcade") || category.includes("entertainment") || category.includes("dessert") || category.includes("pizza")) return "weekend or 7-10 PM";
  return row["Walk-in ease"] || null;
}

function noteFromRow(row: Row): string | null {
  const parts = [
    row["Pokemon buyer-fit rationale"],
    row["Foot-traffic / impulse rationale"],
    row["Corporate/franchise friction"],
    row["Space / placement note"],
    row["Notes"],
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function importRows(abs: string, dryRun: boolean) {
  const rows = rowsFromCsv(abs);
  const counts = {
    row_count: rows.length,
    leads_created: 0,
    leads_updated: 0,
    contacts_created: 0,
    phones_created: 0,
    emails_created: 0,
    skipped: 0,
  };
  const warnings: string[] = [];

  if (dryRun) {
    for (const [i, row] of rows.entries()) {
      if (!row["Venue"]) {
        counts.skipped++;
        warnings.push(`row ${i + 2}: missing Venue`);
      }
    }
    return { dry_run: true, ...counts, warnings };
  }

  const db = getDb();
  const tx = db.transaction(() => {
    const batch = db.prepare(
      `INSERT INTO pokemon_import_batches (source_filename, source_kind, row_count)
       VALUES (?, 'pokemon_pipeline_csv', ?)`
    ).run(path.basename(abs), rows.length);
    const batchId = Number(batch.lastInsertRowid);

    const findLead = db.prepare(`SELECT id FROM pokemon_leads WHERE venue_name = ? AND address = ?`);
    const upsertLead = db.prepare(
      `INSERT INTO pokemon_leads
         (external_key, venue_name, category, address, city, state, website, venue_phone,
          vending_score, pokemon_fit_score, owner_access_score, route_cluster, best_visit_window,
          priority, next_action, source, source_batch_id, raw_json, notes)
       VALUES
         (@external_key, @venue_name, @category, @address, @city, @state, @website, @venue_phone,
          @vending_score, @pokemon_fit_score, @owner_access_score, @route_cluster, @best_visit_window,
          @priority, @next_action, 'pokemon_lead_agent', @batch_id, @raw_json, @notes)
       ON CONFLICT(venue_name, address) DO UPDATE SET
         external_key = COALESCE(excluded.external_key, pokemon_leads.external_key),
         category = excluded.category,
         city = excluded.city,
         state = excluded.state,
         website = excluded.website,
         venue_phone = excluded.venue_phone,
         vending_score = excluded.vending_score,
         pokemon_fit_score = excluded.pokemon_fit_score,
         owner_access_score = excluded.owner_access_score,
         route_cluster = excluded.route_cluster,
         best_visit_window = excluded.best_visit_window,
         priority = excluded.priority,
         next_action = excluded.next_action,
         raw_json = excluded.raw_json,
         notes = COALESCE(pokemon_leads.notes, excluded.notes),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    );
    const findContact = db.prepare(`SELECT id FROM pokemon_contacts WHERE lead_id = ? AND name = ?`);
    const insertContact = db.prepare(
      `INSERT INTO pokemon_contacts (lead_id, name, title, source_note, confidence, raw_contact_cell)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const findPhone = db.prepare(
      `SELECT id FROM pokemon_phone_numbers WHERE lead_id = ? AND COALESCE(contact_id, -1) = COALESCE(?, -1) AND phone = ?`
    );
    const insertPhone = db.prepare(
      `INSERT INTO pokemon_phone_numbers (lead_id, contact_id, phone, phone_type, priority_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    const findEmail = db.prepare(
      `SELECT id FROM pokemon_emails WHERE lead_id = ? AND email = ?`
    );
    const insertEmail = db.prepare(
      `INSERT INTO pokemon_emails (lead_id, contact_id, email, source) VALUES (?, ?, ?, ?)`
    );

    for (const [idx, row] of rows.entries()) {
      const venue = row["Venue"];
      if (!venue) {
        counts.skipped++;
        warnings.push(`row ${idx + 2}: missing Venue`);
        continue;
      }
      const address = row["Address"] || "";
      const baseScore = pipelineBaseScore(row);
      const ownerNameForScoring = row["Owner name candidate"] || row["Decision-maker name"] || "";
      const ownerPhoneForScoring = normPhone(row["Owner phone"] || "");
      const publicPhoneForScoring = normPhone(row["Public contact phone"] || row["Phone"] || "");
      const ownerEmailForScoring = cleanEmail(row["Owner email"] || "");
      const publicEmailForScoring = cleanEmail(row["Public contact email"] || "");
      const fitInput = {
        venue_name: venue,
        category: row["Category"] || null,
        vending_score: baseScore,
        rating: null,
        reviews: null,
        has_owner_name: !!ownerNameForScoring,
        has_owner_phone: !!ownerPhoneForScoring,
        has_phone: !!(ownerPhoneForScoring || publicPhoneForScoring),
        has_email: !!(ownerEmailForScoring || publicEmailForScoring),
        has_address: !!address,
        has_website: !!row["Website"],
      };
      const existing = findLead.get(venue, address) as { id: number } | undefined;
      upsertLead.run({
        external_key: row["Lead ID"] || null,
        venue_name: venue,
        category: row["Category"] || null,
        address,
        city: row["City"] || null,
        state: row["State"] || null,
        website: row["Website"] || null,
        venue_phone: normPhone(row["Phone"] || row["Public contact phone"] || "") || null,
        vending_score: baseScore,
        pokemon_fit_score: pokemonFitScore(fitInput),
        owner_access_score: ownerAccessScore(fitInput),
        route_cluster: row["Region"] || null,
        best_visit_window: bestWindow(row),
        priority: priorityFromRow(row),
        next_action: row["Suggested first move"] || null,
        batch_id: batchId,
        raw_json: JSON.stringify(row),
        notes: noteFromRow(row),
      });
      const leadId = (findLead.get(venue, address) as { id: number }).id;
      if (existing) counts.leads_updated++;
      else counts.leads_created++;

      let contactId: number | null = null;
      const ownerName = ownerNameForScoring;
      if (ownerName) {
        const found = findContact.get(leadId, ownerName) as { id: number } | undefined;
        if (found) contactId = found.id;
        else {
          const res = insertContact.run(
            leadId,
            ownerName,
            row["Owner title/role"] || row["Decision-maker role"] || null,
            row["Owner source"] || row["Owner/franchise notes"] || null,
            row["Owner confidence"] || "needs_review",
            JSON.stringify({ owner_fields: true, lead_id: row["Lead ID"] || null })
          );
          contactId = Number(res.lastInsertRowid);
          counts.contacts_created++;
        }
      }

      const phoneCandidates: Array<{ phone: string; type: string; contact: number | null; priority: number }> = [];
      const ownerPhone = ownerPhoneForScoring;
      const publicPhone = publicPhoneForScoring;
      if (ownerPhone) phoneCandidates.push({ phone: ownerPhone, type: "owner_candidate", contact: contactId, priority: 1 });
      if (publicPhone) phoneCandidates.push({ phone: publicPhone, type: "venue", contact: null, priority: 50 });
      for (const pc of phoneCandidates) {
        if (!findPhone.get(leadId, pc.contact, pc.phone)) {
          insertPhone.run(leadId, pc.contact, pc.phone, pc.type, pc.priority);
          counts.phones_created++;
        }
      }

      const emailCandidates: Array<{ email: string | null; contact: number | null; source: string }> = [
        { email: ownerEmailForScoring, contact: contactId, source: "pokemon_pipeline_owner" },
        { email: publicEmailForScoring, contact: null, source: "pokemon_pipeline_public" },
      ];
      for (const ec of emailCandidates) {
        if (ec.email && !findEmail.get(leadId, ec.email)) {
          insertEmail.run(leadId, ec.contact, ec.email, ec.source);
          counts.emails_created++;
        }
      }
    }

    db.prepare(
      `UPDATE pokemon_import_batches
          SET leads_created = ?, leads_updated = ?, contacts_created = ?, phones_created = ?, emails_created = ?, warnings_json = ?
        WHERE id = ?`
    ).run(
      counts.leads_created,
      counts.leads_updated,
      counts.contacts_created,
      counts.phones_created,
      counts.emails_created,
      JSON.stringify(warnings),
      batchId
    );
  });

  tx();
  pushEvent(
    "pokemon-crm",
    `Imported ${counts.leads_created} new / ${counts.leads_updated} updated Pokemon lead-agent rows into CRM`,
    "success"
  );
  return { dry_run: false, ...counts, warnings };
}

function main() {
  const { file, dryRun } = parseArgs();
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`file not found: ${abs}`);
    process.exit(1);
  }
  const result = importRows(abs, dryRun);
  console.log(JSON.stringify(result, null, 2));
}

main();
