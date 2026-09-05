import publicCatalog from "@/docs/plans/stern/seeds/clubs-catalog.json";
import { getDb, nowIso } from "@/db";
import {
  CLUB_CATEGORIES, CLUB_TRANSITIONS, PROGRAM_TRACKS, PROGRAM_TRANSITIONS, CHECKLIST_KEYS, CHECKLIST_LABELS, statusLabel,
  type ClubStatus, type ProgramStatus, type RecruitingClub, type RecruitingProcess, type RecruitingProgram,
  type RecruitingSnapshot, type RecruitingWindow, type RecruitingClubDetail, type RecruitingDeadline,
  type RecruitingActivity, type RecruitingPerson, type CoffeeChat, type InterviewPrep,
} from "@/lib/stern-types";
import { SternError } from "@/lib/stern/errors";
import { meta, row, insert, patch, textFields, httpUrl, id, type ChangeMeta, type Row } from "./recruiting-write";
import { deadlineDays, deadlineInstant, nyDateKey, nyDayBounds, validDate } from "./time";
export { deadlineDays } from "./time";

const PROCESS_SLUG = "stern-clubs-fall-2026";
function catalogSeed(): { clubs: Array<Record<string, string>>; program_windows: RecruitingWindow[] } {
  // Bundled once with the server, so snapshots do not depend on runtime cwd or docs files.
  return publicCatalog as { clubs: Array<Record<string, string>>; program_windows: RecruitingWindow[] };
}
function slug(name: string) { return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function activeClub(clubId: number) {
  const club = row<RecruitingClub>("club", clubId);
  if (club.status === "archived" || row<RecruitingProcess>("process", club.process_id).status === "archived") throw new SternError(400, "Archived recruiting is read-only; undo the archive to resume");
  return club;
}
export function seedClubCatalog(): { processId: number; clubs: number } {
  const db = getDb();
  return db.transaction(() => {
    const audit = meta({ source: "seed" });
    const seed = catalogSeed();
    let process = db.prepare("SELECT * FROM stern_processes WHERE slug = ?").get(PROCESS_SLUG) as RecruitingProcess | undefined;
    if (!process) process = row("process", insert("process", { slug: PROCESS_SLUG, name: "Stern Clubs, Fall 2026", kind: "club_recruiting", season: "Fall 2026" }, audit));
    for (const raw of seed.clubs) {
      const item = textFields(Object.fromEntries(["name", "short_name", "category", "website", "instagram", "notes"].map(key => [key, raw[key] ?? ""])), ["name", "short_name", "category", "website", "instagram", "notes"]) as Record<string, string>;
      if (!item.name || !slug(item.name) || !(CLUB_CATEGORIES as readonly string[]).includes(item.category)) throw new SternError(400, "Invalid club catalog entry");
      httpUrl(item.website);
      if (item.instagram && !/^@?[a-zA-Z0-9._]+$/.test(item.instagram)) httpUrl(item.instagram);
      const existing = db.prepare("SELECT * FROM stern_clubs WHERE process_id = ? AND slug = ?").get(process!.id, slug(item.name)) as RecruitingClub | undefined;
      if (!existing) insert("club", { process_id: process!.id, slug: slug(item.name), ...item, interested: 0 }, audit);
      else {
        const blanks: Row = {};
        for (const field of ["name", "short_name", "category", "website", "instagram", "notes"] as const) {
          // A deliberately cleared manual field is an edit, too. Never refill it on reseed.
          const edited = db.prepare("SELECT 1 FROM stern_audit_log WHERE entity_type = 'club' AND entity_id = ? AND field = ? AND source <> 'seed' AND undone_at = '' LIMIT 1").get(existing.id, field);
          if (!existing[field] && item[field] && !edited) blanks[field] = item[field];
        }
        patch("club", existing.id, blanks, audit);
      }
    }
    return { processId: process!.id, clubs: (db.prepare("SELECT COUNT(*) n FROM stern_clubs WHERE process_id = ?").get(process!.id) as { n: number }).n };
  }).immediate();
}

export function setInterested(clubId: number, interested: boolean, options: ChangeMeta = {}) {
  if (typeof interested !== "boolean") throw new SternError(400, "interested must be a boolean");
  return getDb().transaction(() => {
    const club = activeClub(clubId);
    const audit = meta(options);
    if (interested) {
      activeClub(clubId);
      patch("club", clubId, { interested: 1, ...(club.interested ? {} : { status: "considering" }) }, audit);
      for (const window of catalogSeed().program_windows) {
        const existing = getDb().prepare("SELECT id FROM stern_programs WHERE club_id = ? AND track = ? LIMIT 1").get(clubId, window.track);
        if (!existing) insert("program", { club_id: clubId, name: window.track === "exploratory" ? "Exploratory program" : "Teams program", track: window.track,
          app_opens_at: window.applications_open, app_deadline_at: window.applications_close, interview_start: window.interviews_start, interview_end: window.interviews_end, decision_at: window.decisions }, audit);
      }
      CHECKLIST_KEYS.forEach((key, sort) => {
        if (!getDb().prepare("SELECT id FROM stern_checklist_items WHERE club_id = ? AND program_id = 0 AND key = ?").get(clubId, key)) {
          insert("checklist_item", { club_id: clubId, program_id: 0, key, label: CHECKLIST_LABELS[key], sort, source: options.source && options.source !== "manual" ? "auto" : "manual" }, audit);
        }
      });
    } else patch("club", clubId, { interested: 0 }, audit);
    return clubId;
  }).immediate();
}

export function updateClub(clubId: number, input: Record<string, unknown>, options: ChangeMeta = {}) {
  return getDb().transaction(() => {
    activeClub(clubId);
    const { priority, target_chats, ...strings } = input;
    const fields = textFields(strings, ["name", "short_name", "category", "website", "instagram", "coffee_chat_form_url", "email_domains", "notes"]);
    if (fields.name !== undefined && !fields.name) throw new SternError(400, "Club name is required");
    if (fields.category && !(CLUB_CATEGORIES as readonly string[]).includes(String(fields.category))) throw new SternError(400, "Invalid club category");
    for (const key of ["website", "coffee_chat_form_url"]) if (fields[key]) httpUrl(String(fields[key]));
    if (fields.instagram && !/^@?[a-zA-Z0-9._]+$/.test(String(fields.instagram))) httpUrl(String(fields.instagram));
    if (fields.email_domains !== undefined) {
      let domains: unknown; try { domains = JSON.parse(String(fields.email_domains)); } catch { throw new SternError(400, "email_domains must be a JSON array"); }
      if (!Array.isArray(domains) || domains.some(v => typeof v !== "string")) throw new SternError(400, "email_domains must be a JSON array of strings");
    }
    for (const [key, value, min, max] of [["priority", priority, 1, 3], ["target_chats", target_chats, 0, 100]] as const) {
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new SternError(400, `Invalid ${key}`);
      fields[key] = value;
    }
    patch("club", clubId, fields, meta(options));
    return clubId;
  }).immediate();
}
export function setClubStatus(clubId: number, next: ClubStatus, options: ChangeMeta & { explicitArchive?: boolean } = {}) {
  return getDb().transaction(() => {
    const club = row<RecruitingClub>("club", clubId);
    if (club.status === next) return clubId;
    if (next === "archived") {
      if (!options.explicitArchive && row<RecruitingProcess>("process", club.process_id).status !== "archived") throw new SternError(400, "Use the explicit archive action");
    } else {
      activeClub(clubId);
      if (!CLUB_TRANSITIONS[club.status].includes(next)) throw new SternError(400, `Invalid club transition: ${club.status} → ${next}`);
    }
    patch("club", clubId, { status: next }, meta(options));
    return clubId;
  }).immediate();
}
export function archiveClub(clubId: number, options: ChangeMeta = {}) { return setClubStatus(clubId, "archived", { ...options, explicitArchive: true }); }
export function archiveProcess(processId: number, options: ChangeMeta = {}) {
  return getDb().transaction(() => {
    const process = row<RecruitingProcess>("process", processId);
    if (process.status === "archived") return processId;
    const audit = meta(options);
    patch("process", processId, { status: "archived", archived_at: nowIso() }, audit);
    const clubs = getDb().prepare("SELECT id FROM stern_clubs WHERE process_id = ?").all(processId) as { id: number }[];
    for (const club of clubs) archiveClub(club.id, audit);
    return processId;
  }).immediate();
}
const PROGRAM_FIELDS = ["name", "track", "app_opens_at", "app_deadline_at", "interview_start", "interview_end", "decision_at", "application_url", "requirements", "dress_code", "interview_at", "interview_location", "notes"];
export function upsertProgram(input: Record<string, unknown>, options: ChangeMeta = {}): number {
  return getDb().transaction(() => {
    const { id: programId, club_id, ...strings } = input;
    const fields = textFields(strings, PROGRAM_FIELDS);
    let existing = programId === undefined ? undefined : row<RecruitingProgram>("program", id(programId));
    const clubId = existing?.club_id ?? id(club_id, "club_id");
    if (club_id !== undefined && club_id !== clubId) throw new SternError(400, "Cannot move a program to another club");
    activeClub(clubId);
    if (fields.name !== undefined && !fields.name) throw new SternError(400, "Program name is required");
    if (fields.track !== undefined && !(PROGRAM_TRACKS as readonly string[]).includes(String(fields.track))) throw new SternError(400, "Invalid track");
    if (!existing && (!fields.name || !fields.track)) throw new SternError(400, "Program name and track are required");
    if (!existing) existing = getDb().prepare("SELECT * FROM stern_programs WHERE club_id = ? AND track = ? AND name = ?").get(clubId, fields.track, fields.name) as RecruitingProgram | undefined;
    for (const key of ["app_opens_at", "app_deadline_at", "interview_start", "interview_end", "decision_at", "interview_at"]) {
      if (fields[key] !== undefined && !validDate(String(fields[key]))) throw new SternError(400, `${key} must be a date or ISO time with timezone`);
    }
    const merged: Record<string, string | number | undefined> = { ...existing, ...fields };
    for (const [start, end] of [["app_opens_at", "app_deadline_at"], ["interview_start", "interview_end"]]) {
      if (merged[start] && merged[end] && deadlineInstant(String(merged[start])) > deadlineInstant(String(merged[end]))) throw new SternError(400, `${end} must not precede ${start}`);
    }
    if (fields.application_url) httpUrl(String(fields.application_url));
    const collision = getDb().prepare("SELECT id FROM stern_programs WHERE club_id = ? AND track = ? AND name = ? AND id <> ?").get(clubId, merged.track, merged.name, existing?.id ?? 0);
    if (collision) throw new SternError(409, "A program with this name and track already exists");
    const audit = meta(options);
    if (existing) { patch("program", existing.id, fields, audit); return existing.id; }
    return insert("program", { club_id: clubId, ...fields }, audit);
  }).immediate();
}
export function setProgramStatus(programId: number, next: ProgramStatus, options: ChangeMeta = {}) {
  return getDb().transaction(() => {
    const program = row<RecruitingProgram>("program", programId);
    activeClub(program.club_id);
    if (program.status === next) return programId;
    if (!PROGRAM_TRANSITIONS[program.status].includes(next)) throw new SternError(400, `Invalid program transition: ${program.status} → ${next}`);
    patch("program", programId, { status: next }, meta(options));
    return programId;
  }).immediate();
}
/** Scheduler-owned sweep, one audit batch per scan. Snapshot GETs remain read-only. */
export function markMissedPrograms(now: Date = new Date(), options: ChangeMeta = {}) {
  return getDb().transaction(() => {
    const audit = meta({ ...options, source: options.source || "auto_calendar", evidenceType: "deadline", evidenceExcerpt: "Application deadline passed" });
    const candidates = getDb().prepare("SELECT p.* FROM stern_programs p JOIN stern_clubs c ON c.id = p.club_id JOIN stern_processes r ON r.id = c.process_id WHERE p.status IN ('open','drafting') AND p.app_deadline_at <> '' AND c.interested = 1 AND c.status <> 'archived' AND r.status = 'active'").all() as RecruitingProgram[];
    const missed = candidates.filter(p => {
      if (!(deadlineInstant(p.app_deadline_at) < now.getTime())) return false;
      // Undo is an intentional correction. Keep it until a newer status/deadline edit.
      // Ignore undo mirror rows; the original row retains both its value and undone_at.
      const latest = getDb().prepare(`SELECT id, after_value, undone_at, evidence_type, evidence_excerpt
        FROM stern_audit_log WHERE entity_type = 'program' AND entity_id = ?
        AND field = 'status' AND action = 'update' ORDER BY id DESC LIMIT 1`).get(p.id) as
        { id: number; after_value: string; undone_at: string; evidence_type: string; evidence_excerpt: string } | undefined;
      if (!latest?.undone_at || latest.after_value !== "missed" || latest.evidence_type !== "deadline") return true;
      const deadlineEdited = getDb().prepare(`SELECT 1 FROM stern_audit_log WHERE entity_type = 'program'
        AND entity_id = ? AND field = 'app_deadline_at' AND id > ? LIMIT 1`).get(p.id, latest.id);
      // Legacy sweeps had no date in their excerpt: conservatively preserve their undo too.
      return !!deadlineEdited || (latest.evidence_excerpt !== "Application deadline passed"
        && latest.evidence_excerpt !== `Application deadline passed (${p.app_deadline_at})`);
    });
    for (const program of missed) patch("program", program.id, { status: "missed" },
      { ...audit, evidenceExcerpt: `Application deadline passed (${program.app_deadline_at})` });
    return { missed: missed.length, batchId: audit.batchId };
  }).immediate();
}
export function toggleChecklist(itemId: number, done: boolean, options: ChangeMeta = {}) {
  if (typeof done !== "boolean") throw new SternError(400, "done must be a boolean");
  return getDb().transaction(() => {
    const item = row<{ club_id: number; done_at: string }>("checklist_item", itemId);
    activeClub(item.club_id);
    if (!!item.done_at !== done) patch("checklist_item", itemId, { done_at: done ? nowIso() : "" }, meta(options));
    return itemId;
  }).immediate();
}
export function upsertPrep(input: Record<string, unknown>, options: ChangeMeta = {}): number {
  return getDb().transaction(() => {
    const { id: prepId, program_id, sort, ...strings } = input;
    const fields = textFields(strings, ["question", "answer"]);
    const existing = prepId === undefined ? undefined : row<InterviewPrep>("interview_prep", id(prepId));
    const programId = existing?.program_id ?? id(program_id, "program_id");
    if (program_id !== undefined && program_id !== programId) throw new SternError(400, "Cannot move interview prep to another program");
    activeClub(row<RecruitingProgram>("program", programId).club_id);
    if ((!existing && !fields.question) || fields.question === "") throw new SternError(400, "Question is required");
    if (sort !== undefined) {
      if (typeof sort !== "number" || !Number.isSafeInteger(sort) || sort < 0) throw new SternError(400, "sort must be a non-negative integer");
      fields.sort = sort;
    }
    const audit = meta(options);
    if (existing) { patch("interview_prep", existing.id, fields, audit); return existing.id; }
    return insert("interview_prep", { program_id: programId, ...fields }, audit);
  }).immediate();
}

function clubTimeline(clubId: number): RecruitingActivity[] {
  const db = getDb();
  const audit = db.prepare(`SELECT a.id, a.created_at at, a.source, a.batch_id, a.undone_at,
    a.entity_type, a.action, a.field, a.after_value, a.evidence_type, a.evidence_excerpt
    FROM stern_audit_log a WHERE a.field <> 'updated_at' AND (
    (a.entity_type = 'club' AND a.entity_id = ?) OR
    (a.entity_type = 'program' AND a.entity_id IN (SELECT id FROM stern_programs WHERE club_id = ?)) OR
    (a.entity_type = 'checklist_item' AND a.entity_id IN (SELECT id FROM stern_checklist_items WHERE club_id = ?)) OR
    (a.entity_type = 'coffee_chat' AND a.entity_id IN (SELECT id FROM coffee_chats WHERE club_id = ?)) OR
    (a.entity_type = 'interview_prep' AND a.entity_id IN (SELECT i.id FROM stern_interview_prep i JOIN stern_programs p ON p.id = i.program_id WHERE p.club_id = ?))
    ) ORDER BY a.id DESC LIMIT 100`).all(clubId, clubId, clubId, clubId, clubId) as (Omit<RecruitingActivity, "key" | "summary"> & { entity_type: string; action: string; field: string; after_value: string; evidence_type: string; evidence_excerpt: string })[];
  audit.reverse();
  const touches = db.prepare(`SELECT t.id, t.occurred_at at, t.source, t.summary, '' batch_id, '' undone_at FROM people_touchpoints t
    WHERE t.person_id IN (SELECT person_id FROM people_affiliations WHERE club_id = ?) ORDER BY t.id DESC LIMIT 100`).all(clubId) as Omit<RecruitingActivity, "key">[];
  touches.reverse();
  const labels: Record<string, string> = { club: "Club", program: "Program", coffee_chat: "Coffee chat", checklist_item: "Checklist item", interview_prep: "Interview prep" };
  const batchSummaries = new Map<string, string>();
  function undoSummary(batchId: string): string {
    if (batchSummaries.has(batchId)) return batchSummaries.get(batchId)!;
    const changes = db.prepare(`SELECT action, entity_type, after_value, COUNT(*) n FROM stern_audit_log
      WHERE batch_id = ? AND undone_at = '' AND action <> 'undo' AND field <> 'updated_at'
      GROUP BY action, entity_type, CASE WHEN action = 'create' THEN id ELSE 0 END`).all(batchId) as
      { action: string; entity_type: string; after_value: string; n: number }[];
    const summary = changes.map(change => {
      const label = labels[change.entity_type] || statusLabel(change.entity_type);
      if (change.action === "create") {
        let name = "";
        try { const value = JSON.parse(change.after_value); name = value.name || value.label || value.question || ""; } catch { /* Older history may lack a row snapshot. */ }
        return `Remove ${label.toLowerCase()}${name ? `: ${name}` : ""}`;
      }
      return change.action === "delete" ? `Restore ${change.n} ${label.toLowerCase()} record(s)` : `Revert ${change.n} ${label.toLowerCase()} field change(s)`;
    }).join(". ");
    batchSummaries.set(batchId, summary);
    return summary;
  }
  const summaries = audit.map(a => {
    const entity = labels[a.entity_type] || statusLabel(a.entity_type);
    const field = statusLabel(a.field);
    const summary = a.action === "create" ? `${entity} added` : a.action === "undo" ? `${entity}: change undone`
      : a.field === "status" || a.field === "state" ? `${entity}: ${statusLabel(a.after_value)}`
      : a.field === "done_at" ? `Checklist item ${a.after_value ? "completed" : "reopened"}`
      : a.field === "interested" ? `Club ${a.after_value === "1" ? "added to" : "removed from"} board`
      : `${entity}: ${field.toLowerCase()} updated`;
    return { key: `audit-${a.id}`, id: a.id, at: a.at, source: a.evidence_type === "deadline" ? "auto_calendar" : a.source,
      summary: a.evidence_type === "deadline" && a.action !== "undo" ? `${summary} · ${a.evidence_excerpt}` : summary,
      batch_id: a.source === "seed" || a.source === "undo" || a.action === "undo" || (a.action === "create" && ["club", "process"].includes(a.entity_type)) ? "" : a.batch_id, undone_at: a.undone_at,
      undoSummary: undoSummary(a.batch_id) };
  });
  return [...summaries, ...touches.map(t => ({ ...t, key: `touch-${t.id}` }))]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id).slice(0, 100);
}
export function recruitingSnapshot(now: Date = new Date()): RecruitingSnapshot {
  const db = getDb();
  const process = db.prepare("SELECT * FROM stern_processes WHERE slug = ?").get(PROCESS_SLUG) as RecruitingProcess | undefined;
  const catalog = process ? db.prepare("SELECT * FROM stern_clubs WHERE process_id = ? ORDER BY name COLLATE NOCASE").all(process.id) as RecruitingClub[] : [];
  const deadlines = (db.prepare(`SELECT p.id, c.id clubId, c.name club, p.name, p.track, p.app_deadline_at deadlineAt, p.status
    FROM stern_programs p JOIN stern_clubs c ON c.id = p.club_id JOIN stern_processes r ON r.id = c.process_id
    WHERE r.slug = ? AND r.status = 'active' AND c.interested = 1 AND c.status <> 'archived'
    AND p.status IN ('not_open','open','drafting') AND p.app_deadline_at <> ''`).all(PROCESS_SLUG) as Omit<RecruitingDeadline, "days">[])
    .filter(p => Number.isFinite(deadlineInstant(p.deadlineAt)) && deadlineInstant(p.deadlineAt) >= now.getTime())
    .map(p => ({ ...p, days: deadlineDays(p.deadlineAt, now) })).sort((a, b) => deadlineInstant(a.deadlineAt) - deadlineInstant(b.deadlineAt) || a.id - b.id);
  const clubs = catalog.filter(c => c.interested === 1).map((club): RecruitingClubDetail => {
    const programs = db.prepare("SELECT * FROM stern_programs WHERE club_id = ? ORDER BY CASE track WHEN 'exploratory' THEN 0 WHEN 'teams' THEN 1 ELSE 2 END, id").all(club.id) as RecruitingProgram[];
    const checklist = db.prepare("SELECT * FROM stern_checklist_items WHERE club_id = ? ORDER BY sort, id").all(club.id) as RecruitingClubDetail["checklist"];
    const progress = db.prepare("SELECT COUNT(*) checklistTotal, COALESCE(SUM(done_at <> ''), 0) checklistDone FROM stern_checklist_items WHERE club_id = ?").get(club.id) as { checklistTotal: number; checklistDone: number };
    const chatsDone = (db.prepare("SELECT COUNT(DISTINCT person_id) n FROM coffee_chats WHERE club_id = ? AND state IN ('done','thank_you_sent')").get(club.id) as { n: number }).n;
    const chats = db.prepare("SELECT * FROM coffee_chats WHERE club_id = ? ORDER BY id DESC LIMIT 500").all(club.id) as CoffeeChat[];
    chats.reverse();
    const people = (db.prepare(`SELECT p.id, p.display_name, p.email, p.year, p.title, GROUP_CONCAT(DISTINCT a.role) role FROM people p
      JOIN people_affiliations a ON a.person_id = p.id WHERE a.club_id = ? AND a.is_eboard = 1 AND p.archived = 0 GROUP BY p.id ORDER BY p.display_name COLLATE NOCASE`).all(club.id) as Omit<RecruitingPerson, "chat">[])
      .map(person => ({ ...person, chat: [...chats].reverse().find(c => c.person_id === person.id) ?? null }));
    const prep = db.prepare("SELECT i.* FROM stern_interview_prep i JOIN stern_programs p ON p.id = i.program_id WHERE p.club_id = ? ORDER BY i.sort, i.id").all(club.id) as InterviewPrep[];
    return { ...club, programs, checklist, ...progress, chatsDone, chats, people, nextDeadline: deadlines.find(d => d.clubId === club.id) ?? null, prep, timeline: clubTimeline(club.id) };
  }).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const counts = db.prepare(`SELECT COUNT(*) interested, COALESCE(SUM(status = 'archived'),0) archived, COALESCE(SUM(status = 'applying'),0) applying,
    COALESCE(SUM(status = 'interviewing'),0) interviewing FROM stern_clubs WHERE process_id = ? AND interested = 1`).get(process?.id ?? 0) as RecruitingSnapshot["counts"];
  counts.coffeeChatsOwed = (db.prepare(`SELECT COUNT(*) n FROM coffee_chats h JOIN stern_clubs c ON c.id = h.club_id JOIN stern_processes r ON r.id = c.process_id
    WHERE c.interested = 1 AND c.status <> 'archived' AND r.slug = ? AND r.status = 'active'
    AND (h.state = 'to_request' OR (h.state = 'reply_received' AND h.reply_needs_me = 1))`).get(PROCESS_SLUG) as { n: number }).n;
  const today = nyDayBounds(now);
  const in14 = nyDayBounds(now, 14);
  counts.deadlines14d = (db.prepare(`SELECT COUNT(*) n FROM stern_programs p
    JOIN stern_clubs c ON c.id = p.club_id JOIN stern_processes r ON r.id = c.process_id
    WHERE r.slug = ? AND r.status = 'active' AND c.interested = 1 AND c.status <> 'archived'
    AND p.status IN ('not_open','open','drafting') AND p.app_deadline_at <> ''
    AND ((length(p.app_deadline_at) = 10 AND p.app_deadline_at BETWEEN ? AND ?)
      OR (length(p.app_deadline_at) > 10 AND julianday(p.app_deadline_at) >= julianday(?)
        AND julianday(p.app_deadline_at) < julianday(?)))`).get(PROCESS_SLUG, today.dateKey, in14.dateKey, now.toISOString(), in14.endIso) as { n: number }).n;
  return { updatedAt: now.toISOString(), today: nyDateKey(now), process: process ?? null, catalog, clubs, deadlines, windows: catalogSeed().program_windows, counts };
}
