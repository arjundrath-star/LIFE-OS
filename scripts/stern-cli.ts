#!/usr/bin/env -S tsx
// Stern CLI: a TRUSTED LOCAL WRITER for the Stern tab. Touches ONLY SQLite through the same
// domain rules the app uses (dedupe keys, enums, audit rows). No network, no email, no auth,
// no browser. Hermes (iMessage capture), cron, and the orchestrator call it; the running
// dashboard picks the rows up on its 15 s "stern" tick. Every write runs in one IMMEDIATE
// transaction and every invocation gets one audit batch id, so a bad capture can be undone.
//
// Usage (run from the repo root; `npm run stern-cli -- ...` does that):
//   stern-cli add-person       --source imessage|agent|manual --json '{...}' | --json-file <path>
//       fields: name | first_name+last_name, display_name, org, role, club (name or slug),
//               is_eboard, email, email_alt, phone, instagram, linkedin, year, major, how_met,
//               met_at (ISO, default now), met_event, notes, relationship_type, strength,
//               sphere, need_to_reach_out (true -> status need_to_reach_out)
//   stern-cli add-task         --source ... --json '{title, domain?, due_at?, priority?, notes?, dedupe_key?, person?, club?}'
//   stern-cli add-touchpoint   --source ... --json '{person: id|name|email, kind, summary, detail?, occurred_at?}'
//   stern-cli set-person-status --source ... --json '{person, status}'
//   stern-cli list-people      [--q <text>] [--limit <n>]
//
// Output: exactly one JSON object on stdout ({ ok:true, ... } or { ok:false, error }).
// Exit codes: 0 ok · 1 write/validation error · 2 usage error. Migration chatter goes to stderr.
import fs from "node:fs";

// Everything DB-backed is imported lazily inside main() so `console.log` can be routed to
// stderr first: db/index.ts logs migrations with console.log and stdout must stay pure JSON.
type Db = import("better-sqlite3").Database;

const COMMANDS = new Set(["add-person", "add-task", "add-touchpoint", "set-person-status", "list-people"]);
const SOURCES = ["imessage", "agent", "manual"] as const;
type CliSource = (typeof SOURCES)[number];

function usage(message?: string): never {
  if (message) console.error(`error: ${message}`);
  console.error(
    "usage: stern-cli <add-person|add-task|add-touchpoint|set-person-status|list-people>\n" +
      "       [--source imessage|agent|manual] [--json '<json>' | --json-file <path>] [--q <text>] [--limit <n>]"
  );
  process.stdout.write(JSON.stringify({ ok: false, error: message || "usage" }) + "\n");
  process.exit(2);
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  if (!argv.length || argv[0].startsWith("--")) usage("command required");
  const command = argv[0];
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) usage(`unexpected argument: ${a}`);
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined) usage(`flag --${key} needs a value`);
    flags[key] = next;
    i++;
  }
  return { command, flags };
}

function payloadFrom(flags: Record<string, string>): Record<string, unknown> {
  let raw = flags.json;
  if (flags["json-file"]) {
    try {
      raw = fs.readFileSync(flags["json-file"], "utf8");
    } catch (e) {
      usage(`could not read --json-file: ${(e as Error).message}`);
    }
  }
  if (!raw) usage("--json or --json-file is required");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) usage("--json must be an object");
    return parsed as Record<string, unknown>;
  } catch (e) {
    if ((e as any)?.code === 2) throw e;
    usage(`invalid JSON: ${(e as Error).message}`);
  }
}

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const bool = (v: unknown): boolean => v === true || v === 1 || (typeof v === "string" && /^(1|true|yes|y|on)$/i.test(v));
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
const isoOrEmpty = (v: unknown, label: string): string => {
  const s = str(v, 40);
  if (!s) return "";
  if (Number.isNaN(Date.parse(s))) throw new Error(`${label} must be an ISO date`);
  return s;
};

function dedupeKeyFor(email: string, fullName: string, org: string): string {
  if (email) return email.toLowerCase();
  return `name:${normalize(fullName)}:${normalize(org)}`;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!COMMANDS.has(command)) usage(`unknown command: ${command}`);
  const source = (flags.source || "manual") as CliSource;
  if (!SOURCES.includes(source)) usage(`--source must be one of ${SOURCES.join("|")}`);

  // Route db/index.ts migration logs (console.log) to stderr; stdout is reserved for the result.
  const realLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  const [{ getDb, nowIso }, types, audit] = await Promise.all([import("@/db"), import("@/lib/stern-types"), import("@/lib/stern/audit")]);
  console.log = realLog;
  const { SternError } = await import("@/lib/stern/errors");
  const people = await import("@/lib/stern/people");
  const db: Db = getDb();
  const auditSource = source; // imessage -> imessage, agent -> agent, manual -> manual (all valid AUDIT_SOURCES)
  const personSource = source === "manual" ? "manual" : "imessage"; // people.source has no 'agent'
  const touchpointSource = source === "manual" ? "manual" : "imessage";
  const taskSource = source; // stern_tasks.source accepts imessage | agent | manual
  const batchId = audit.newBatchId(`cli-${source}`);
  const meta = { batchId, source: auditSource };

  const resolvePerson = (ref: unknown): { id: number; display_name: string; last_contact_at: string } => {
    const asNumber = typeof ref === "number" ? ref : typeof ref === "string" && /^\d+$/.test(ref.trim()) ? Number(ref) : null;
    let row: any;
    if (asNumber !== null) row = db.prepare("SELECT id, display_name, last_contact_at FROM people WHERE id = ?").get(asNumber);
    else {
      const s = str(ref, 320);
      if (!s) throw new SternError(400, "person is required (id, email, or name)");
      if (s.includes("@")) row = db.prepare("SELECT id, display_name, last_contact_at FROM people WHERE lower(email) = ? OR lower(email_alt) = ?").get(s.toLowerCase(), s.toLowerCase());
      if (!row) row = db.prepare("SELECT id, display_name, last_contact_at FROM people WHERE lower(display_name) = ? AND archived = 0 ORDER BY id LIMIT 1").get(s.toLowerCase());
      if (!row) row = db.prepare("SELECT id, display_name, last_contact_at FROM people WHERE display_name LIKE ? AND archived = 0 ORDER BY id LIMIT 1").get(`%${s}%`);
    }
    if (!row) throw new SternError(404, `person not found: ${String(ref)}`);
    return row;
  };

  const resolveClub = (ref: unknown): { id: number; name: string } | null => {
    const s = str(ref, 200);
    if (!s) return null;
    const key = s.toLowerCase();
    const slug = normalize(s).replace(/\s+/g, "-");
    let row: any = db.prepare("SELECT id, name FROM stern_clubs WHERE slug = ? OR lower(name) = ? OR (short_name <> '' AND lower(short_name) = ?) ORDER BY interested DESC, id LIMIT 1").get(slug, key, key);
    if (!row) row = db.prepare("SELECT id, name FROM stern_clubs WHERE name LIKE ? ORDER BY interested DESC, id LIMIT 1").get(`%${s}%`);
    return row || null;
  };

  let output: Record<string, unknown>;

  if (command === "list-people") {
    const q = str(flags.q, 200);
    const limit = Math.max(1, Math.min(200, Number(flags.limit) || 50));
    const rows = q
      ? db.prepare(
          `SELECT id, display_name, org, status, relationship_type, email, last_contact_at FROM people
            WHERE archived = 0 AND (display_name LIKE ? OR org LIKE ? OR email LIKE ? OR instagram LIKE ?)
            ORDER BY display_name LIMIT ?`
        ).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit)
      : db.prepare("SELECT id, display_name, org, status, relationship_type, email, last_contact_at FROM people WHERE archived = 0 ORDER BY display_name LIMIT ?").all(limit);
    output = { ok: true, count: rows.length, people: rows };
  } else if (command === "add-person") {
    const input = payloadFrom(flags);
    let first = str(input.first_name, 120);
    let last = str(input.last_name, 120);
    const name = str(input.name, 240);
    if (!first && !last && name) {
      const parts = name.split(/\s+/);
      first = parts.shift() || "";
      last = parts.join(" ");
    }
    const display = str(input.display_name, 240) || `${first} ${last}`.trim();
    if (!display) throw new SternError(400, "name is required");
    const email = str(input.email, 320).toLowerCase();
    const club = resolveClub(input.club);
    const org = str(input.org, 240) || club?.name || str(input.club, 240);
    const dedupeKey = dedupeKeyFor(email, display, org);
    const relationship = str(input.relationship_type, 40) || (club || bool(input.is_eboard) ? "club_connect" : "general_connect");
    if (!(types.RELATIONSHIP_TYPES as readonly string[]).includes(relationship)) throw new SternError(400, `invalid relationship_type: ${relationship}`);
    const howMet = str(input.how_met, 40);
    if (howMet && !(types.HOW_MET as readonly string[]).includes(howMet)) throw new SternError(400, `invalid how_met: ${howMet}`);
    const sphere = str(input.sphere, 20) || "stern";
    if (!(types.SPHERES as readonly string[]).includes(sphere)) throw new SternError(400, `invalid sphere: ${sphere}`);
    const strength = input.strength === undefined || input.strength === "" ? 1 : Number(input.strength);
    if (!Number.isInteger(strength) || strength < 1 || strength > 5) throw new SternError(400, "strength must be 1 to 5");
    const metAt = isoOrEmpty(input.met_at, "met_at") || nowIso();
    const needToReachOut = bool(input.need_to_reach_out);
    const fields: Record<string, string | number> = {
      first_name: first, last_name: last, display_name: display, year: str(input.year, 40), major: str(input.major, 120), org, title: str(input.title ?? input.role, 120),
      sphere, relationship_type: relationship, strength, how_met: howMet, met_at: metAt, met_event: str(input.met_event, 240), email, email_alt: str(input.email_alt, 320).toLowerCase(),
      phone: str(input.phone, 40), instagram: str(input.instagram, 120).replace(/^@/, ""), linkedin: str(input.linkedin, 300), hometown: str(input.hometown, 120), dorm: str(input.dorm, 120),
      notes: str(input.notes, 20000),
    };

    const result = people.peopleWrite(() => {
      const created = people.createPerson({ ...fields, source: personSource, status: needToReachOut ? "need_to_reach_out" : "met" }, meta);
      const id = created.person.id;
      if (needToReachOut && created.person.status !== "need_to_reach_out") people.setStatus(id, "need_to_reach_out", meta);
      const affiliationId = club || org ? people.addAffiliation(id, { clubId: club?.id || 0, org, role: input.role, isEboard: bool(input.is_eboard), relevantForRecruiting: !!club }, meta).id : 0;
      const hasMet = db.prepare("SELECT id FROM people_touchpoints WHERE person_id = ? AND kind = 'met' LIMIT 1").get(id);
      const touchpointId = hasMet ? 0 : people.addTouchpoint(id, "met", { occurredAt: metAt, source: touchpointSource, summary: fields.met_event ? `Met at ${fields.met_event}` : "Met" }, meta).id;
      return { id, created: created.created, affiliationId, touchpointId };
    });
    output = { ok: true, ...result, batchId, displayName: display, dedupeKey, clubResolved: !!club, clubName: club?.name ?? "", status: db.prepare("SELECT status FROM people WHERE id = ?").pluck().get(result.id) };
  } else if (command === "add-task") {
    const input = payloadFrom(flags);
    const title = str(input.title, 240);
    if (!title) throw new SternError(400, "title is required");
    const domain = str(input.domain, 20) || "professional";
    if (!(types.TASK_DOMAINS as readonly string[]).includes(domain)) throw new SternError(400, `invalid domain: ${domain}`);
    const priority = input.priority === undefined || input.priority === "" ? 2 : Number(input.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw new SternError(400, "priority must be 1 to 3");
    const dueAt = isoOrEmpty(input.due_at, "due_at");
    const dedupeKey = str(input.dedupe_key, 200);
    const person = input.person !== undefined && input.person !== "" ? resolvePerson(input.person) : null;
    const club = resolveClub(input.club);
    const tx = db.transaction(() => {
      if (dedupeKey) {
        const existing = db.prepare("SELECT id FROM stern_tasks WHERE dedupe_key = ?").get(dedupeKey) as any;
        if (existing) return { id: existing.id, created: false };
      }
      const ts = nowIso();
      const row = { title, domain, club_id: club?.id ?? 0, person_id: person?.id ?? 0, due_at: dueAt, priority, status: "open", source: taskSource, dedupe_key: dedupeKey, notes: str(input.notes, 5000), created_at: ts, updated_at: ts };
      const cols = Object.keys(row);
      const result = db.prepare(`INSERT INTO stern_tasks (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`).run(row);
      const id = Number(result.lastInsertRowid);
      audit.logCreate("task", id, { id, ...row }, meta);
      return { id, created: true };
    });
    output = { ok: true, ...tx.immediate(), batchId, title, dueAt };
  } else if (command === "add-touchpoint") {
    const input = payloadFrom(flags);
    const person = resolvePerson(input.person);
    const kind = str(input.kind, 40) || "note";
    const occurredAt = isoOrEmpty(input.occurred_at, "occurred_at") || nowIso();
    const summary = str(input.summary, 500);
    if (!summary) throw new SternError(400, "summary is required");
    const id = people.addTouchpoint(person.id, kind, { occurredAt, summary, detail: str(input.detail, 5000), source: touchpointSource }, meta).id;
    output = { ok: true, id, created: true, batchId, personId: person.id, personName: person.display_name, kind };
  } else {
    // set-person-status
    const input = payloadFrom(flags);
    const person = resolvePerson(input.person);
    const status = str(input.status, 40);
    if (!(types.PERSON_STATUSES as readonly string[]).includes(status)) throw new SternError(400, `invalid status: ${status}`);
    const before = db.prepare("SELECT status FROM people WHERE id = ?").pluck().get(person.id) as string;
    people.setStatus(person.id, status, meta);
    const result = { before, changed: before !== status };
    output = { ok: true, id: person.id, personName: person.display_name, status, ...result, batchId };
  }

  process.stdout.write(JSON.stringify(output) + "\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  process.exit(1); // validation and write errors; usage errors already exited with 2
});
