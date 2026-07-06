// Import a PeopleFinder CSV export into the Pokemon CRM tables.
// Idempotent: leads upsert on (venue_name, address); contacts matched by (lead_id, name);
// phones/emails INSERT OR IGNORE on their unique constraints. Re-importing the same file
// never duplicates rows and never touches stage/active/notes on existing leads.
//
//   npm run import-pokemon-crm -- /path/to/peoplefinder.csv
import fs from "node:fs";
import path from "node:path";
import { getDb, pushEvent } from "@/db";
import { ownerAccessScore, pokemonFitScore } from "@/lib/pokemon-fit";

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// ---- CSV (RFC 4180: quoted fields may contain commas, newlines, "" escapes) ----
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
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
  // drop fully-empty trailing rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function normPhone(s: string): string {
  const digits = (s || "").replace(/\D+/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return (s || "").trim();
}

type Person = { name: string; title: string; phones: string[]; raw: string };

// Cell format: "Jane Doe (Owner)/ (555) 555-0100/ ... | John Roe (Owner)/ ..."
function splitDecisionMakers(value: string): Person[] {
  const people: Person[] = [];
  for (const rawPart of (value || "").split(/\s+\|\s+/)) {
    const part = rawPart.trim();
    if (!part) continue;
    let name = part;
    let title = "";
    let rest = "";
    const m = part.match(/^(.*?)\s*\(([^)]*)\)\s*\/?\s*(.*)$/s);
    if (m) {
      name = m[1].trim();
      title = m[2].trim();
      rest = m[3].trim();
    } else {
      const idx = part.indexOf("/");
      if (idx >= 0) {
        name = part.slice(0, idx).trim();
        rest = part.slice(idx + 1).trim();
      }
    }
    if (!name) continue;
    const phones = [...new Set((rest.match(PHONE_RE) || []).map(normPhone))];
    people.push({ name, title, phones, raw: part });
  }
  return people;
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("usage: npm run import-pokemon-crm -- /path/to/peoplefinder.csv");
    process.exit(1);
  }
  const abs = path.resolve(csvPath);
  if (!fs.existsSync(abs)) {
    console.error(`file not found: ${abs}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(abs, "utf8"));
  if (rows.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim());
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] || "").trim() : "";
  };
  const required = ["Location Name", "Mailing Address", "Decision-Makers (Name / Title / Phones)"];
  for (const c of required) {
    if (!header.includes(c)) {
      console.error(`CSV is missing expected column "${c}" — is this a PeopleFinder export?`);
      process.exit(1);
    }
  }
  const dataRows = rows.slice(1);

  const db = getDb();
  const warnings: string[] = [];
  const counts = {
    row_count: dataRows.length,
    leads_created: 0,
    leads_updated: 0,
    contacts_created: 0,
    phones_created: 0,
    emails_created: 0,
  };

  // Another process (the live server) shares this WAL DB — take the write lock up front.
  const importAll = db.transaction(() => {
    const batch = db
      .prepare(
        `INSERT INTO pokemon_import_batches (source_filename, source_kind) VALUES (?, 'peoplefinder_csv')`
      )
      .run(path.basename(abs));
    const batchId = Number(batch.lastInsertRowid);

    const insertLead = db.prepare(
      `INSERT INTO pokemon_leads
         (venue_name, category, address, city, state, website, venue_phone,
          rating, reviews, vending_score, pokemon_fit_score, owner_access_score,
          notes, source, source_batch_id, raw_json)
       VALUES (@venue_name, @category, @address, @city, @state, @website, @venue_phone,
          @rating, @reviews, @vending_score, @pokemon_fit_score, @owner_access_score,
          @notes, 'peoplefinder_csv', @batch_id, @raw_json)
       ON CONFLICT(venue_name, address) DO UPDATE SET
         category = excluded.category,
         city = excluded.city,
         state = excluded.state,
         website = excluded.website,
         venue_phone = excluded.venue_phone,
         rating = excluded.rating,
         reviews = excluded.reviews,
         vending_score = excluded.vending_score,
         pokemon_fit_score = excluded.pokemon_fit_score,
         owner_access_score = excluded.owner_access_score,
         raw_json = excluded.raw_json,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    );
    const findLead = db.prepare(
      `SELECT id FROM pokemon_leads WHERE venue_name = ? AND address = ?`
    );
    const findContact = db.prepare(
      `SELECT id FROM pokemon_contacts WHERE lead_id = ? AND name = ?`
    );
    const insertContact = db.prepare(
      `INSERT INTO pokemon_contacts (lead_id, name, title, source_note, confidence, raw_contact_cell)
       VALUES (?, ?, ?, ?, 'needs_review', ?)`
    );
    const insertPhone = db.prepare(
      `INSERT OR IGNORE INTO pokemon_phone_numbers (lead_id, contact_id, phone, priority_order)
       VALUES (?, ?, ?, ?)`
    );
    const maxPhonePriority = db.prepare(
      `SELECT COALESCE(MAX(priority_order), 0) AS m FROM pokemon_phone_numbers WHERE contact_id = ?`
    );
    const insertEmail = db.prepare(
      `INSERT OR IGNORE INTO pokemon_emails (lead_id, contact_id, email, source)
       VALUES (?, ?, ?, ?)`
    );

    for (const [idx, r] of dataRows.entries()) {
      const rowNo = idx + 2; // 1-based + header
      const venueName = col(r, "Location Name");
      const address = col(r, "Mailing Address");
      if (!venueName) {
        warnings.push(`row ${rowNo}: missing Location Name — skipped`);
        continue;
      }

      // "Boston, MA, USA" → city Boston, state MA
      const cityParts = col(r, "City").split(",").map((p) => p.trim());
      const rating = parseFloat(col(r, "Rating"));
      const reviews = parseInt(col(r, "Reviews"), 10);
      const vendingScore = parseInt(col(r, "Vending Score"), 10);
      const category = col(r, "Business Type") || null;
      const cleanRating = Number.isFinite(rating) ? rating : null;
      const cleanReviews = Number.isFinite(reviews) ? reviews : null;
      const cleanVendingScore = Number.isFinite(vendingScore) ? vendingScore : null;
      const peopleForScoring = splitDecisionMakers(col(r, "Decision-Makers (Name / Title / Phones)"));
      const hasOwnerPhone = peopleForScoring.some((p) => p.phones.length > 0);
      const venuePhone = normPhone(col(r, "Venue Phone"));
      const hasEmail = EMAIL_RE.test(col(r, "Emails") || "");
      EMAIL_RE.lastIndex = 0;
      const fitInput = {
        venue_name: venueName,
        category,
        vending_score: cleanVendingScore,
        rating: cleanRating,
        reviews: cleanReviews,
        has_owner_name: peopleForScoring.length > 0,
        has_owner_phone: hasOwnerPhone,
        has_phone: hasOwnerPhone || !!venuePhone,
        has_email: hasEmail,
        has_address: !!address,
        has_website: !!col(r, "Website"),
      };

      // address stays a plain string ('' when blank): NULL would defeat both the
      // (venue_name, address) unique index (NULLs are distinct) and the = lookups.
      const existing = findLead.get(venueName, address) as { id: number } | undefined;
      insertLead.run({
        venue_name: venueName,
        category,
        address,
        city: cityParts[0] || null,
        state: cityParts[1] || null,
        website: col(r, "Website") || null,
        venue_phone: venuePhone || null,
        rating: cleanRating,
        reviews: cleanReviews,
        vending_score: cleanVendingScore,
        pokemon_fit_score: pokemonFitScore(fitInput),
        owner_access_score: ownerAccessScore(fitInput),
        notes: col(r, "Notes") || null,
        batch_id: batchId,
        raw_json: JSON.stringify(Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))),
      });
      const leadId = (findLead.get(venueName, address) as { id: number }).id;
      if (existing) counts.leads_updated++;
      else counts.leads_created++;

      // contacts + their phones
      const people = splitDecisionMakers(col(r, "Decision-Makers (Name / Title / Phones)"));
      const ownerSources = col(r, "Owner Source").split(/\s+\|\s+/).map((s) => s.trim());
      const contactIds: number[] = [];
      for (const [ci, person] of people.entries()) {
        const sourceNote =
          ownerSources.length === people.length ? ownerSources[ci] : col(r, "Owner Source");
        let contactId: number;
        let priorityBase = 0;
        const found = findContact.get(leadId, person.name) as { id: number } | undefined;
        if (found) {
          contactId = found.id;
          // Append after existing numbers so a later export can't collide with
          // (or jump ahead of) priorities assigned by an earlier import.
          priorityBase = (maxPhonePriority.get(contactId) as { m: number }).m;
        } else {
          const res = insertContact.run(
            leadId,
            person.name,
            person.title || null,
            sourceNote || null,
            person.raw
          );
          contactId = Number(res.lastInsertRowid);
          counts.contacts_created++;
        }
        contactIds.push(contactId);
        for (const [pi, phone] of person.phones.entries()) {
          const res = insertPhone.run(leadId, contactId, phone, priorityBase + (pi + 1) * 10);
          counts.phones_created += res.changes;
        }
      }
      if (people.length === 0) warnings.push(`row ${rowNo} (${venueName}): no decision-makers`);

      // Emails: PeopleFinder separates per-contact groups with ";". Map groups to
      // contacts by position when the counts line up; otherwise keep at lead level.
      const emailCell = col(r, "Emails");
      const groups = emailCell
        .split(";")
        .map((g) => [...new Set(g.match(EMAIL_RE) || [])])
        .filter((g) => g.length > 0);
      const mapped = groups.length > 0 && groups.length === contactIds.length;
      if (emailCell && !mapped && groups.length > 0 && contactIds.length > 0) {
        warnings.push(
          `row ${rowNo} (${venueName}): ${groups.length} email groups vs ${contactIds.length} contacts — stored unmapped`
        );
      }
      for (const [gi, group] of groups.entries()) {
        for (const email of group) {
          const res = insertEmail.run(
            leadId,
            mapped ? contactIds[gi] : null,
            email.toLowerCase(),
            mapped ? "peoplefinder_semicolon_group" : "peoplefinder_export_unmapped"
          );
          counts.emails_created += res.changes;
        }
      }
    }

    db.prepare(
      `UPDATE pokemon_import_batches SET
         row_count = ?, leads_created = ?, leads_updated = ?,
         contacts_created = ?, phones_created = ?, emails_created = ?, warnings_json = ?
       WHERE id = ?`
    ).run(
      counts.row_count,
      counts.leads_created,
      counts.leads_updated,
      counts.contacts_created,
      counts.phones_created,
      counts.emails_created,
      warnings.length ? JSON.stringify(warnings) : null,
      batchId
    );
    return batchId;
  });

  const batchId = importAll.immediate();
  pushEvent(
    "pokemon-crm",
    `imported ${path.basename(abs)}: ${counts.leads_created} new leads, ${counts.phones_created} phones, ${counts.emails_created} emails`,
    "success"
  );

  console.log(JSON.stringify({ batchId, ...counts, warnings }, null, 2));
}

main();
