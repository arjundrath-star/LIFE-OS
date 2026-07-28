// Capture-source ingestion layer. A capture source is an external service that
// records conversations (a wearable recorder, a meeting-notes tool) and yields
// transcript-like notes. Ingestion turns each note into ONE CRM touchpoint on a
// resolved lead, idempotently, reusing the fingerprint-plus-receipt pattern from
// scripts/import-pokemon-pipeline-crm.ts. Server-only (imports @/db).
//
// Invariants, matching the rest of the CRM:
// - No fabrication. With no credential configured nothing is fetched and nothing
//   is written; results report zero counts honestly.
// - No fuzzy matching. A note attaches to a lead only on an exact normalized
//   venue-name match with exactly one candidate. Ambiguous or unmatched notes
//   are counted and skipped, never guessed onto a lead.
// - Idempotent. Each note is fingerprinted; a receipt row written in the same
//   SQLite transaction as the touchpoint makes re-ingesting a no-op.
import crypto from "node:crypto";
import { all, getDb } from "@/db";
import { logTouchpoint } from "@/lib/pokemon-crm";

export type HealthResult = { ok: boolean; detail: string };

/** One transcript-like note as delivered by a vendor API. */
export type CaptureNote = {
  /** vendor-stable id (recording id, document id) */
  externalId: string;
  /** ISO 8601 capture time */
  occurredAt: string;
  title: string | null;
  /** transcript or summary body */
  text: string;
  /** venue / company name the vendor attached to the capture, if any */
  venueHint: string | null;
};

/**
 * The CRM write a note normalizes into. Field names mirror lib/pokemon-crm
 * logTouchpoint, which is the single write path every touchpoint goes through
 * (it also enforces the active=1 invariant). leadId is resolved separately so
 * normalize() stays a pure payload mapping.
 */
export type TouchpointDraft = {
  type: "note";
  outcome: string;
  notes: string;
  actor: string;
  /** sha256 identity used for the receipt check */
  fingerprint: string;
  /** carried through for lead resolution in the ingest loop */
  venueHint: string | null;
};

export type IngestResult = {
  source: string;
  configured: boolean;
  fetched: number;
  written: number;
  skippedExisting: number;
  skippedUnresolved: number;
  detail: string;
};

/** An external capture source that yields notes which become CRM touchpoints. */
export interface CaptureSource {
  id: string;
  label: string;
  /** env key the credential lives under in the secret store */
  tokenEnv: string;
  /** true only when the credential is present (never true by default) */
  configured(): boolean;
  /** cheap, honest probe. Never claims ok without proving the credential works. */
  health(): Promise<HealthResult>;
  /** pure mapping from a vendor payload to the CRM touchpoint shape */
  normalize(note: CaptureNote): TouchpointDraft;
  /** idempotent pull. Zero-count no-op until the source is configured. */
  ingest(): Promise<IngestResult>;
}

// Versioned so a future change to the canonical form cannot silently collide
// with receipts written under the old form (same convention as the pipeline
// importer's FINGERPRINT_VERSION).
const FINGERPRINT_VERSION = "capture-ingest-v1";

/** Deterministic identity for one note from one source. */
export function noteFingerprint(sourceId: string, note: CaptureNote): string {
  const canonical = JSON.stringify({
    externalId: note.externalId,
    occurredAt: note.occurredAt,
    text: String(note.text || "").trim().replace(/\s+/g, " "),
  });
  return crypto
    .createHash("sha256")
    .update(`${FINGERPRINT_VERSION}\n${sourceId}\n${canonical}`)
    .digest("hex");
}

// Same normalization the pipeline importer applies to venue names, so a vendor
// hint like "Main St. Market & Deli" matches the CRM row it was imported as.
function normalizeVenue(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Exact-match lead resolution: one normalized venue-name candidate or nothing.
 * Zero matches and multiple matches both return null; the caller counts the
 * note as unresolved and skips it. No fuzzy merge, same policy as the CSV
 * importers' identity preflight.
 */
export function resolveLeadId(venueHint: string | null): number | null {
  if (!venueHint) return null;
  const target = normalizeVenue(venueHint);
  if (!target) return null;
  const rows = all<{ id: number; venue_name: string }>(
    "SELECT id, venue_name FROM pokemon_leads"
  );
  const matches = rows.filter((r) => normalizeVenue(r.venue_name) === target);
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Write ONE touchpoint plus its receipt in a single transaction. Returns false
 * (and writes nothing) when a receipt for this fingerprint already exists.
 * logTouchpoint's inner transaction becomes a savepoint inside this one, the
 * same nesting logPhoneCall relies on.
 */
export function writeTouchpointOnce(
  sourceId: string,
  leadId: number,
  draft: TouchpointDraft
): boolean {
  const db = getDb();
  let written = false;
  const tx = db.transaction(() => {
    const existing = db
      .prepare("SELECT fingerprint FROM capture_ingest_receipts WHERE fingerprint = ?")
      .get(draft.fingerprint);
    if (existing) return;
    logTouchpoint({
      leadId,
      type: draft.type,
      outcome: draft.outcome,
      actor: draft.actor,
      notes: draft.notes,
    });
    db.prepare(
      "INSERT INTO capture_ingest_receipts (fingerprint, source, lead_id) VALUES (?, ?, ?)"
    ).run(draft.fingerprint, sourceId, leadId);
    written = true;
  });
  tx.immediate();
  return written;
}

/**
 * Shared ingest loop. fetchNotes is the adapter's vendor call; everything after
 * it (normalize, resolve, receipt-checked write) is identical across sources.
 * Unconfigured sources return a zero-count result without calling fetchNotes.
 */
export async function runCaptureIngest(
  source: CaptureSource,
  fetchNotes: () => Promise<CaptureNote[]>
): Promise<IngestResult> {
  const base: IngestResult = {
    source: source.id,
    configured: source.configured(),
    fetched: 0,
    written: 0,
    skippedExisting: 0,
    skippedUnresolved: 0,
    detail: "",
  };
  if (!base.configured) {
    return { ...base, detail: "not configured; nothing fetched, nothing written" };
  }
  const notes = await fetchNotes();
  base.fetched = notes.length;
  for (const note of notes) {
    const draft = source.normalize(note);
    const leadId = resolveLeadId(draft.venueHint);
    if (leadId == null) {
      base.skippedUnresolved++;
      continue;
    }
    if (writeTouchpointOnce(source.id, leadId, draft)) base.written++;
    else base.skippedExisting++;
  }
  base.detail = `${base.written} written, ${base.skippedExisting} already ingested, ${base.skippedUnresolved} unresolved`;
  return base;
}
