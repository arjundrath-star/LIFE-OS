import crypto from "node:crypto";
import { getDb, nowIso, pushEvent } from "@/db";
import { CATEGORIES, KINDS, APPLICATION_STATUSES, ENGAGEMENT_STATUSES } from "@/lib/career-types";
export { CATEGORIES, KINDS, APPLICATION_STATUSES, ENGAGEMENT_STATUSES } from "@/lib/career-types";
export type { CareerCategory, EndeavorKind } from "@/lib/career-types";

const CATEGORY_SET = new Set<string>(CATEGORIES);
const KIND_SET = new Set<string>(KINDS);
const APP_STATUS_SET = new Set<string>(APPLICATION_STATUSES);
const ENG_STATUS_SET = new Set<string>(ENGAGEMENT_STATUSES);
const EDITABLE = new Set(["title","organization","category","kind","status","deadline","primary_url","urls_json","contact_name","contact_email","location","notes"]);

export class CareerError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function required(value: unknown, name: string, max = 500) {
  if (typeof value !== "string" || !value.trim()) throw new CareerError(`${name} is required`);
  return value.trim().slice(0, max);
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validStatus(kind: string, status: string) {
  return kind === "application" ? APP_STATUS_SET.has(status) : ENG_STATUS_SET.has(status);
}
function validDeadline(value: string) {
  return value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function urlList(value: unknown, primary = "") {
  let list: unknown = value;
  if (typeof value === "string") {
    try { list = JSON.parse(value); } catch { list = value.split(/\s+/); }
  }
  const urls = Array.isArray(list) ? list.map((v) => text(v, 1000)).filter((v) => /^https?:\/\//i.test(v)) : [];
  if (primary && /^https?:\/\//i.test(primary) && !urls.includes(primary)) urls.unshift(primary);
  return JSON.stringify([...new Set(urls)].slice(0, 20));
}

export function careerSnapshot() {
  const db = getDb();
  const endeavors = db.prepare("SELECT * FROM endeavors ORDER BY updated_at DESC, id DESC").all() as any[];
  const tail = db.prepare("SELECT * FROM endeavor_events ORDER BY id DESC LIMIT 800").all() as any[];
  tail.reverse();
  const byEndeavor = new Map<number, any[]>();
  for (const event of tail) {
    const group = byEndeavor.get(event.endeavor_id) || [];
    group.push(event);
    byEndeavor.set(event.endeavor_id, group);
  }
  for (const item of endeavors) {
    try { item.urls = JSON.parse(item.urls_json || "[]"); } catch { item.urls = []; }
    delete item.urls_json;
    item.events = byEndeavor.get(item.id) || [];
  }
  const suggestionTail = db.prepare("SELECT * FROM career_suggestions ORDER BY id DESC LIMIT 200").all() as any[];
  suggestionTail.reverse();
  for (const suggestion of suggestionTail) {
    try { suggestion.proposed = JSON.parse(suggestion.proposed_data || "{}"); } catch { suggestion.proposed = {}; }
    delete suggestion.proposed_data;
  }
  const pending = suggestionTail.filter((s) => s.state === "pending");
  const activeApplicationStatuses = new Set(["researching","drafting","submitted","interviewing","offer"]);
  const nextDeadline = endeavors.filter((e) => e.deadline && activeApplicationStatuses.has(e.status)).sort((a,b) => a.deadline.localeCompare(b.deadline))[0] || null;
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = { work:0, klade:0, community:0 };
  for (const item of endeavors) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }
  return {
    endeavors,
    suggestions: suggestionTail,
    stats: { total: endeavors.length, applications: endeavors.filter((e) => e.kind === "application").length, engagements: endeavors.filter((e) => e.kind === "engagement").length, pendingSuggestions: pending.length, byStatus, byCategory, nextDeadline },
    updatedAt: nowIso(),
  };
}

function normalizedInput(input: any) {
  const kind = text(input.kind, 20) || "application";
  const category = text(input.category, 20) || "work";
  const status = text(input.status, 40) || (kind === "application" ? "researching" : "active");
  if (!KIND_SET.has(kind)) throw new CareerError("invalid endeavor kind");
  if (!CATEGORY_SET.has(category)) throw new CareerError("invalid career category");
  if (!validStatus(kind, status)) throw new CareerError(`status ${status} is invalid for ${kind}`);
  const deadline = text(input.deadline, 10);
  if (!validDeadline(deadline)) throw new CareerError("deadline must be YYYY-MM-DD");
  const primaryUrl = text(input.primary_url ?? input.primaryUrl, 1000);
  return {
    title: required(input.title, "title", 240),
    organization: text(input.organization ?? input.org, 240),
    category, kind, status, deadline,
    primary_url: primaryUrl,
    urls_json: urlList(input.urls_json ?? input.urls, primaryUrl),
    contact_name: text(input.contact_name ?? input.contactName, 240),
    contact_email: text(input.contact_email ?? input.contactEmail, 320),
    location: text(input.location, 320),
    notes: text(input.notes, 20000),
  };
}

function insertEndeavor(db: ReturnType<typeof getDb>, input: any, source: "manual"|"seed"|"discovery", dedupeKey?: string) {
  const value = normalizedInput(input);
  const ts = nowIso();
  const key = dedupeKey || `manual:${crypto.randomUUID()}`;
  const result = db.prepare(`INSERT INTO endeavors
    (dedupe_key,title,organization,category,kind,status,deadline,primary_url,urls_json,contact_name,contact_email,location,notes,source,created_at,updated_at)
    VALUES (@dedupe_key,@title,@organization,@category,@kind,@status,@deadline,@primary_url,@urls_json,@contact_name,@contact_email,@location,@notes,@source,@ts,@ts)`)
    .run({ ...value, dedupe_key:key, source, ts });
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at) VALUES (?,'created',?,?,?,?)")
    .run(id, source === "discovery" ? "Accepted discovery suggestion" : "Endeavor created", "", source, ts);
  return id;
}

export function createEndeavor(input: any) {
  const db = getDb();
  const tx = db.transaction(() => insertEndeavor(db, input, "manual"));
  const id = tx.immediate();
  pushEvent("career", `Added ${text(input.title, 120)}`, "success");
  return { id, snapshot: careerSnapshot() };
}

export function updateEndeavor(id: number, patch: any) {
  if (!Number.isInteger(id) || id < 1) throw new CareerError("invalid endeavor id");
  const db = getDb();
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM endeavors WHERE id=?").get(id) as any;
    if (!current) throw new CareerError("endeavor not found", 404);
    const clean: Record<string,string> = {};
    for (const [key, raw] of Object.entries(patch || {})) {
      if (!EDITABLE.has(key)) continue;
      if (key === "urls_json") clean[key] = urlList(raw, clean.primary_url ?? current.primary_url);
      else clean[key] = text(raw, key === "notes" ? 20000 : key.includes("url") ? 1000 : 500);
    }
    if (clean.title !== undefined && !clean.title) throw new CareerError("title is required");
    const kind = clean.kind ?? current.kind;
    const status = clean.status ?? current.status;
    const category = clean.category ?? current.category;
    if (!KIND_SET.has(kind) || !CATEGORY_SET.has(category) || !validStatus(kind, status)) throw new CareerError("invalid kind, category, or status combination");
    if (clean.deadline !== undefined && !validDeadline(clean.deadline)) throw new CareerError("deadline must be YYYY-MM-DD");
    if (!Object.keys(clean).length) throw new CareerError("no editable fields supplied");
    clean.updated_at = nowIso();
    const sets = Object.keys(clean).map((key) => `${key}=@${key}`).join(",");
    db.prepare(`UPDATE endeavors SET ${sets} WHERE id=@id`).run({ ...clean, id });
    if (clean.status && clean.status !== current.status) {
      db.prepare("INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at) VALUES (?,'status_change',?,?, 'manual',?)")
        .run(id, `${current.status.replaceAll("_"," ")} → ${clean.status.replaceAll("_"," ")}`, "", clean.updated_at);
    } else {
      const fields = Object.keys(clean).filter((k) => k !== "updated_at");
      db.prepare("INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at) VALUES (?,'properties_updated',?,?, 'manual',?)")
        .run(id, `Updated ${fields.join(", ")}`, "", clean.updated_at);
    }
  });
  tx.immediate();
  return { snapshot: careerSnapshot() };
}

export function addEndeavorEvent(id: number, input: any) {
  const summary = required(input.summary, "event summary", 500);
  const detail = text(input.detail, 4000);
  const db = getDb();
  const tx = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM endeavors WHERE id=?").get(id)) throw new CareerError("endeavor not found", 404);
    const ts = nowIso();
    db.prepare("INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at) VALUES (?,?,?,?, 'manual',?)")
      .run(id, text(input.eventType, 60) || "note", summary, detail, ts);
    db.prepare("UPDATE endeavors SET updated_at=? WHERE id=?").run(ts, id);
  });
  tx.immediate();
  return { snapshot: careerSnapshot() };
}

export function insertSuggestion(input: {
  dedupeKey:string; type:"new_endeavor"|"status_change"; endeavorId?:number|null; proposed:any;
  evidenceType:"web"|"gmail"|"manual"; evidenceUrl?:string; gmailAccount?:string; gmailMessageId?:string; subject?:string; excerpt?:string;
}) {
  const db = getDb();
  const result = db.prepare(`INSERT OR IGNORE INTO career_suggestions
    (dedupe_key,suggestion_type,endeavor_id,proposed_data,evidence_type,evidence_url,gmail_account,gmail_message_id,evidence_subject,evidence_excerpt)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      input.dedupeKey, input.type, input.endeavorId ?? null, JSON.stringify(input.proposed || {}), input.evidenceType,
      text(input.evidenceUrl,1000), text(input.gmailAccount,320), text(input.gmailMessageId,240), text(input.subject,500), text(input.excerpt,2000)
    );
  return result.changes > 0;
}

export function reviewSuggestion(id: number, decision: "accept"|"dismiss") {
  if (!Number.isInteger(id) || id < 1) throw new CareerError("invalid suggestion id");
  const db = getDb();
  const tx = db.transaction(() => {
    const suggestion = db.prepare("SELECT * FROM career_suggestions WHERE id=?").get(id) as any;
    if (!suggestion) throw new CareerError("suggestion not found", 404);
    if (suggestion.state !== "pending") throw new CareerError("suggestion was already reviewed", 409);
    const ts = nowIso();
    if (decision === "dismiss") {
      db.prepare("UPDATE career_suggestions SET state='dismissed',reviewed_at=? WHERE id=?").run(ts,id);
      return;
    }
    let proposed: any;
    try { proposed = JSON.parse(suggestion.proposed_data); } catch { throw new CareerError("suggestion data is invalid", 500); }
    if (suggestion.suggestion_type === "new_endeavor") {
      insertEndeavor(db, proposed, "discovery", `discovery:${suggestion.dedupe_key}`);
    } else {
      const endeavor = db.prepare("SELECT * FROM endeavors WHERE id=?").get(suggestion.endeavor_id) as any;
      if (!endeavor) throw new CareerError("target endeavor no longer exists", 409);
      const next = text(proposed.status,40);
      if (!validStatus(endeavor.kind,next)) throw new CareerError("suggested status is invalid",409);
      db.prepare("UPDATE endeavors SET status=?,updated_at=? WHERE id=?").run(next,ts,endeavor.id);
      db.prepare("INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at) VALUES (?,'status_change',?,?, 'discovery',?)")
        .run(endeavor.id, `${endeavor.status.replaceAll("_"," ")} → ${next.replaceAll("_"," ")}`, suggestion.evidence_subject || suggestion.evidence_url, ts);
    }
    db.prepare("UPDATE career_suggestions SET state='accepted',reviewed_at=? WHERE id=?").run(ts,id);
  });
  tx.immediate();
  pushEvent("career", `${decision === "accept" ? "Accepted" : "Dismissed"} career suggestion ${id}`, decision === "accept" ? "success" : "info");
  return { snapshot: careerSnapshot() };
}
