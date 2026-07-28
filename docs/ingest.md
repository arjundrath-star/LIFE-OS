# Capture-source ingestion (`server/ingest/`)

A capture source is an external service that records conversations and yields
transcript-like notes: a wearable audio recorder, a meeting-notes tool. Ingestion
turns each note into one CRM touchpoint on a resolved lead, through the same
write path (`logTouchpoint` in `lib/pokemon-crm.ts`) every other touchpoint uses.

Two adapters exist today, Pocket and Granola. Both are scaffolding by design:
the interface, health probes, normalization, and the idempotent write path are
real and typechecked, and both are inert until a credential is configured. With
no credential, `configured()` is false, `health()` reports not-configured, and
`ingest()` returns a zero-count result without fetching or writing anything.
Nothing in this layer fabricates data. There are no sample rows.

## The interface

`server/ingest/index.ts` defines `CaptureSource`:

| Member | Contract |
|---|---|
| `configured()` | true only when the credential is present in the secret store (`lib/secrets.ts`); never true by default |
| `health()` | cheap probe; never reports ok without proving the credential works |
| `normalize(note)` | pure mapping from a vendor payload (`CaptureNote`) to the CRM touchpoint shape (`TouchpointDraft`) |
| `ingest()` | idempotent pull; zero-count no-op until configured |

Shared machinery in the same file:

- **Fingerprinting.** `noteFingerprint()` hashes a versioned canonical form of
  each note (source id, external id, occurrence time, whitespace-normalized
  text), the same convention as the pipeline importer's source fingerprint in
  `scripts/import-pokemon-pipeline-crm.ts`.
- **Receipts.** `writeTouchpointOnce()` checks `capture_ingest_receipts`
  (migration `0018`) and writes the touchpoint plus its receipt in one SQLite
  transaction. Re-ingesting an already-seen note is a verifiable no-op. This
  mirrors `pokemon_pipeline_sink_receipts` from migration `0010`.
- **Lead resolution.** `resolveLeadId()` attaches a note to a lead only on an
  exact normalized venue-name match with exactly one candidate. Zero or multiple
  matches count the note as unresolved and skip it. No fuzzy merge, matching the
  CSV importers' identity policy.

## Adapters

### Pocket (`server/ingest/pocket.ts`)

Wearable audio capture. Connection id `pocket`, registered in
`lib/connections/registry.ts` as an off-by-default dashboard surface with an
API-key connect flow.

Remaining to wire:

1. Credential: `POCKET_API_TOKEN` in the secret store.
2. Endpoint: confirm the vendor's transcript-export endpoint from their API
   docs and set `POCKET_API_BASE`.
3. Implement `fetchNotes()`: one authenticated GET mapped to `CaptureNote`
   (external id = recording id, occurred-at = recording start, venue hint = the
   location or contact label the companion app attached).

### Granola (`server/ingest/granola.ts`)

AI meeting notes. Connection id `granola`, registered the same way.

Remaining to wire:

1. Credential: `GRANOLA_API_TOKEN` in the secret store.
2. Endpoint: Granola does not publish a stable export API yet; when one exists
   (or a documented local cache format is chosen instead), set
   `GRANOLA_API_BASE`.
3. Implement `fetchNotes()`: list plus fetch, mapped to `CaptureNote`
   (external id = document id, occurred-at = meeting start, venue hint = meeting
   title or attendee organization when provided).

## Health semantics

The registry's contract is that a check proves the credential or endpoint works.
These adapters cannot prove that until their vendor clients are implemented, so
`health()` returns not-ok even when a token is stored, with a detail that says
exactly why ("credential stored; vendor API client not wired yet"). A pasted
token therefore shows as configured-but-not-verified rather than falsely green.

## Deliberately not scheduled

`server/scheduler.ts` does not call these adapters. Wiring a poll interval is a
decision to make when a credential exists and the vendor client is implemented,
not before. Until then the only way to run `ingest()` is an explicit call, and
that call writes nothing.
