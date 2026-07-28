// Pocket adapter: a wearable audio capture device whose companion service holds
// conversation transcripts. Scaffolding, deliberately inert: the credential
// check, health probe, normalization, and idempotent write path are real code,
// but the vendor fetch is not wired because the API endpoint has not been
// confirmed against vendor documentation. Until POCKET_API_TOKEN is set this
// module fetches nothing and writes nothing, and it never fabricates rows.
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

const SOURCE_ID = "pocket";
export const TOKEN_ENV = "POCKET_API_TOKEN";
// Set once the vendor's export endpoint is confirmed from their API docs.
export const BASE_ENV = "POCKET_API_BASE";

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
 * Pull recent transcripts from the vendor API. Not wired: returns an empty list
 * until the endpoint shape is confirmed and implemented here. The remaining
 * work is one authenticated GET against `${POCKET_API_BASE}` with the bearer
 * token, mapped to CaptureNote (externalId = recording id, occurredAt =
 * recording start, venueHint = the location or contact label the app attached).
 */
async function fetchNotes(): Promise<CaptureNote[]> {
  if (!configured() || !secret(BASE_ENV)) return [];
  return [];
}

/** Map one recording to the touchpoint shape the CRM already writes. */
export function normalize(note: CaptureNote): TouchpointDraft {
  const title = (note.title || "").trim().slice(0, 120);
  return {
    type: "note",
    outcome: title ? `Pocket capture: ${title}` : "Pocket capture",
    notes: String(note.text || "").trim(),
    actor: "pocket-ingest",
    fingerprint: noteFingerprint(SOURCE_ID, note),
    venueHint: note.venueHint,
  };
}

export async function ingest(): Promise<IngestResult> {
  return runCaptureIngest(pocketSource, fetchNotes);
}

export const pocketSource: CaptureSource = {
  id: SOURCE_ID,
  label: "Pocket capture",
  tokenEnv: TOKEN_ENV,
  configured,
  health,
  normalize,
  ingest,
};
