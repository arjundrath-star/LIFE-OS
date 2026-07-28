// Granola adapter: an AI meeting-notes tool that produces per-meeting note
// documents. Scaffolding, deliberately inert: the credential check, health
// probe, normalization, and idempotent write path are real code, but the vendor
// fetch is not wired because Granola does not publish a stable export API to
// build against yet. Until GRANOLA_API_TOKEN is set this module fetches nothing
// and writes nothing, and it never fabricates rows.
import { hasSecret, secret } from "@/lib/secrets";
import {
  noteFingerprint,
  runCaptureIngest,
  type CaptureNote,
  type CaptureSource,
  type HealthResult,
  type IngestResult,
  type TouchpointDraft,
} from "@/server/ingest";

const SOURCE_ID = "granola";
export const TOKEN_ENV = "GRANOLA_API_TOKEN";
// Set once a stable export endpoint (or documented local cache format) exists.
export const BASE_ENV = "GRANOLA_API_BASE";

export function configured(): boolean {
  return hasSecret(TOKEN_ENV);
}

export async function health(): Promise<HealthResult> {
  if (!configured()) return { ok: false, detail: `not configured: set ${TOKEN_ENV}` };
  // A token exists but the vendor client below is not wired, so the probe
  // cannot prove the credential works. Report that instead of claiming ok.
  return { ok: false, detail: "credential stored; vendor API client not wired yet" };
}

/**
 * Pull recent meeting notes. Not wired: returns an empty list until a stable
 * export surface is confirmed and implemented here. The remaining work is one
 * authenticated list-plus-fetch against `${GRANOLA_API_BASE}` mapped to
 * CaptureNote (externalId = document id, occurredAt = meeting start, venueHint
 * = the meeting title or the attendee organization when Granola provides one).
 */
async function fetchNotes(): Promise<CaptureNote[]> {
  if (!configured() || !secret(BASE_ENV)) return [];
  return [];
}

/** Map one meeting-notes document to the touchpoint shape the CRM already writes. */
export function normalize(note: CaptureNote): TouchpointDraft {
  const title = (note.title || "").trim().slice(0, 120);
  return {
    type: "note",
    outcome: title ? `Meeting notes: ${title}` : "Meeting notes",
    notes: String(note.text || "").trim(),
    actor: "granola-ingest",
    fingerprint: noteFingerprint(SOURCE_ID, note),
    venueHint: note.venueHint,
  };
}

export async function ingest(): Promise<IngestResult> {
  return runCaptureIngest(granolaSource, fetchNotes);
}

export const granolaSource: CaptureSource = {
  id: SOURCE_ID,
  label: "Granola notes",
  tokenEnv: TOKEN_ENV,
  configured,
  health,
  normalize,
  ingest,
};
