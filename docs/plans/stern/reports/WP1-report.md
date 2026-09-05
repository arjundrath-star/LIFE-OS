# WP1 report — Club Recruiting

## Summary

Implemented the Fall 2026 club recruiting tracker in `stern/wp1`: an idempotent 32-club catalog, board and searchable Add-clubs dialog, five-tab club detail, program/checklist/chat workflows, structured interview prep, deadline strip, process timeline, and archive/undo flows. Mutations use IMMEDIATE SQLite transactions, write the WP0 audit log, and broadcast the complete Stern snapshot. People are read through the schema, with no WP2 domain imports.

The implementation follows screens 02/03 of the Claude Design markup: three-column club cards, compact process timeline, two program cards plus checklist, E-board/activity sidebar, scoped light theme, and existing Stern status/source primitives. UI values come from SQLite; unpopulated sections explain what is missing.

## Files changed

- `lib/stern-types.ts`: client-safe recruiting rows, snapshot and transition graphs; process/interview-prep audit entity types.
- `lib/stern/recruiting.ts`: catalog, interest/checklist setup, clubs/programs, archiving, interview prep, deadline sweep, SQL counts and recruiting snapshot.
- `lib/stern/coffee.ts`: chat identity, transitions, timestamp/touchpoint/audit writes, editable notes and affiliation reconciliation.
- `lib/stern/recruiting-write.ts`: internal audited insert/patch, runtime validation and URL checks.
- `lib/stern/time.ts`: existing New York day-boundary helper extracted without changing its behavior; calendar-day deadline calculations and date validation.
- `lib/stern/audit.ts`: register processes and interview prep with existing undo machinery.
- `lib/stern/snapshot.ts`: include recruiting in the complete live payload; preserve public time-helper re-exports.
- `db/migrations/0030_stern_interview_prep.sql`: the permitted additive structured interview-prep table and index.
- `app/api/stern/recruiting/route.ts`: guarded GET and all 13 specified POST actions; browser writes always use server-generated manual audit metadata.
- `app/stern/recruiting/page.tsx`: board entry point under the gated Stern layout.
- `app/stern/recruiting/[clubId]/page.tsx`: validated club route and optional network-draft-route detection.
- `components/stern/recruiting/RecruitingBoard.tsx`: filters, catalog search/toggles, timeline, real club metrics, priorities and process archive dialog.
- `components/stern/recruiting/ClubDetail.tsx`: all five tabs, checklist, editable club details, interview questions/answers, takeaways, activity and archive/undo.
- `components/stern/recruiting/ProgramCard.tsx`: overview facts, requirements and editable application fields/status.
- `components/stern/recruiting/People.tsx`: schema-linked E-board people, CoffeeChatChip, status controls, schedule recording, chat notes and optional draft request.
- `components/stern/recruiting/Controls.tsx`: shared recruiting buttons/dialogs, priorities, fields, dates, links and mutation feedback using house primitives.
- `components/stern/recruiting/useRecruiting.ts`: first paint with useApi; updates from useLiveData and mutation responses; no polling.
- `components/stern/DeadlineStrip.tsx`: reusable upcoming-deadline cards with three-day warning and one-day error tones.
- `app/globals.css`: recruiting-specific light-theme layout, responsive cards/forms, dialog and scoped shared-primitive overrides.
- `server/scheduler.ts`: the existing guarded 15-second Stern tick runs the local deadline sweep before broadcasting.
- `scripts/seed-stern.ts`: local public-catalog seed CLI.
- `scripts/stern-recruiting-deadlines.ts`: local deadline sweep CLI.
- `scripts/stern-recruiting-e2e.ts`: isolated production browser/API/WebSocket journey on port 3110 with synthetic auth, outbound-fetch blocking and audited fixture cleanup.
- `tests/stern-recruiting.test.ts`: 11 test groups covering all status pairs, persistence, dedupe, undo, timestamps, snapshot counts, deadline expiry and EDT/DST boundaries.
- `tests/fixtures/stern/recruiting.json`: placeholder-only people and test content.
- `package.json`: test, seed, deadline and E2E scripts.
- `docs/plans/stern/reports/WP1-report.md`: this report.

## How verified

All application/CLI commands used `/home/Arjun/stern-build/db/wp1.db`; domain tests use disposable test databases following the repo pattern. No production deployment, push, external messaging, or real provider calls were performed. The browser harness starts Next and the existing authenticated hub on loopback port 3110, without starting the general scheduler. It uses only placeholder auth values and rejects outbound web requests.

Public seed, twice against the assigned copy:

```text
$ npm run seed:stern
{"processId":1,"clubs":32}
$ npm run seed:stern
{"processId":1,"clubs":32}
```

Targeted checks:

```text
$ npm run test:stern-recruiting
# tests 11
# pass 11
# fail 0
$ npm run test:stern-foundation
# tests 5
# pass 5
# fail 0
$ npm run test:stern-workspace
# tests 6
# pass 6
# fail 0
$ npm run typecheck
> tsc --noEmit
# exit 0
```

The first full gate passed all 206 tests, both migrations and the production build:

```text
GATE wp1 result=PASS log=/home/Arjun/stern-build/logs/gate-wp1-20260905T000739Z.log
```

Initial isolated production browser journey:

```json
{"auth":"401 anonymous API, 307 anonymous page, 200 placeholder session","catalog":32,"tabs":5,"checklist":7,"programSaved":true,"prepPersisted":true,"chatTransitions":true,"liveMessages":15,"archiveUndo":true,"phoneFits":true,"browserErrors":0}
{"cleanup":"test mutations undone; public catalog retained"}
```

Screenshots were inspected from ignored `shots/stern-wp1-board.png`, `shots/stern-wp1-detail.png`, and `shots/stern-wp1-phone.png`. Inspection identified utility-class overrides on primary buttons and inactive tabs; those were fixed and added as browser assertions. The final gate and browser rerun both passed against code commit `8888604`:

```text
$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp1 /home/Arjun/stern-build/db/wp1.db wp1
--- typecheck rc=0
# tests 206
# pass 206
# fail 0
--- tests rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp1.db
--- migrate-1 rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp1.db
--- migrate-2 rc=0
✓ Compiled successfully in 19.4s
--- build rc=0
GATE wp1 result=PASS log=/home/Arjun/stern-build/logs/gate-wp1-20260905T001342Z.log
```

The gate ran with the assigned DB and synthetic auth configuration, including `RATHWORKSPACE_SECRETS_PATH=/dev/null`. No real credentials were loaded for the gate/browser session.

```text
$ npm run e2e:stern-recruiting
{"auth":"401 anonymous API, 307 anonymous page, 200 placeholder session","catalog":32,"tabs":5,"checklist":7,"programSaved":true,"prepPersisted":true,"chatTransitions":true,"liveMessages":15,"archiveUndo":true,"phoneFits":true,"browserErrors":0}
{"cleanup":"test mutations undone; public catalog retained"}
```

The final browser run also asserted violet primary buttons and transparent inactive tabs. Final board/detail screenshots were re-inspected. The local server was closed and placeholder writes were undone; the assigned copy retains only the public club catalog from this feature's seed.

Commits: `e234479` (domain/API/UI/tests), `8888604` (browser verification and UI refinements), plus this final report commit. `git diff --check` passed.

### Acceptance evidence

| Checklist item | Implementation and verification |
| --- | --- |
| Catalog seeded idempotently, public data only | `lib/stern/recruiting.ts:25`; `tests/stern-recruiting.test.ts:42`; unchanged public catalog and placeholder fixture. |
| Board, Add-clubs, five detail tabs, DeadlineStrip, archive flows, honest empty states | `components/stern/recruiting/RecruitingBoard.tsx:28`; `components/stern/recruiting/ClubDetail.tsx:30`; `components/stern/DeadlineStrip.tsx:8`; production browser journey. |
| Server-side program/chat transitions, audit and broadcasts | `lib/stern/recruiting.ts:148`; `lib/stern/coffee.ts:25`; `app/api/stern/recruiting/route.ts:18`; `lib/stern/snapshot.ts:60`; exhaustive pair tests at `tests/stern-recruiting.test.ts:111` and `:168`. |
| Interview prep persists | `db/migrations/0030_stern_interview_prep.sql:2`; `lib/stern/recruiting.ts:177`; persistence/undo test at `tests/stern-recruiting.test.ts:58`; browser reload assertion. |
| Deadline automation and local day math | `lib/stern/recruiting.ts:159`; `server/scheduler.ts:273`; deadline tests at `tests/stern-recruiting.test.ts:147` and `:245`. |
| Archive data preserved and reversible | `lib/stern/recruiting.ts:108`; `tests/stern-recruiting.test.ts:125`; browser process archive/undo. |

## Decisions made

- Used the catalog's program-window dates when the design example dates differ. Requirements, dress code and application URLs remain blank until supplied; no design mock content is seeded.
- Used three priority stars because the fixed schema has three levels; three filled stars means priority 1/top target.
- Date-only deadlines remain due through 23:59:59.999 America/New_York. Offset-bearing timestamps preserve their exact instant. Day counts compare New York calendar dates, including DST changes.
- Kept GET snapshots read-only. Only the existing guarded Stern scheduler tick (or the explicit local deadline CLI) marks open/drafting programs missed. Archived and hidden clubs are excluded from active deadline/owed counts.
- Club transitions: Considering → Applying/Declined; Applying → Interviewing/Accepted/Rejected/Declined; Interviewing → Accepted/Rejected/Declined; Accepted → Declined. Archive is a separate explicit action; an archived process permits archiving its clubs. Archived workflows resume through audit undo.
- Program progression follows the specified sequential graph. Declined/Withdrawn are available from Open through Accepted/Rejected; Not open, Missed, Declined and Withdrawn cannot jump to later stages. Same-state requests are idempotent.
- A Done coffee chat still owes a thank-you, so it remains the active chat identity. No reply also retains its identity for retries. Thank-you sent and Declined are terminal for explicit chat creation. Affiliation reconciliation returns existing terminal chats too, preventing recurring triggers from creating endless new attempts.
- Retry counts are SQL counts of recorded follow-up touchpoints, not increments in application memory. Manual touchpoints use a namespaced `local:` ID in the schema's non-null dedupe key so repeated manual conversations are not collapsed.
- A scheduled chat requires an explicit timezone-bearing agreed time. Manual status changes record what happened; they do not send email or create calendar events.
- Seed refill checks the audit history, so intentionally cleared manual fields stay cleared. Stable catalog slugs are retained when a club is renamed.
- The board's All filter includes interested archived clubs, dimmed, matching screen 02. Archived counts refer to interested cards, while process archive updates all catalog clubs and preserves every program/chat/checklist.
- Kept the design's status/source primitives. Activity displays readable change descriptions and omits housekeeping `updated_at` entries; the full audit retains every field for undo.
- Interview prep uses the specifically permitted 0030 migration. Registered its rows and processes in WP0 audit entity mappings so creation, editing and archiving are undoable.
- Draft email is disabled with the required tooltip while the network route is absent. When present, it calls `/api/stern/network` with `action: drafts.request`; no network-domain code is imported.
- Validation failures remain visible inside dialogs. Shared Radix primitives provide focus management, Escape closing and accessible tab navigation.

## Known gaps

No outstanding WP1 acceptance gaps. Real people/affiliations, club-specific requirements, and application links are intentionally not populated by this package. The optional draft action depends on the later network/automation route, as specified. No production deployment or real Google/calendar operation was attempted.

## Follow-ups for the orchestrator

- Merge `stern/wp1`, including the permitted 0030 migration and both audit-entity additions. Keep any later migration numbering unique.
- Preserve the typed `RecruitingSnapshot` section when integrating other Stern snapshot sections. `DeadlineStrip` takes `snapshot.recruiting.deadlines` and is ready for Overview.
- WP2 writes people/affiliations through the schema. WP3 can call `ensureCoffeeChatsForPerson(personId, auditMeta)` and the chat/program functions with one batch per source message; production automation should pass its own trusted audit metadata.
- Wire the network route's `drafts.request` action to the supplied `personId`, `clubId`, and optional `coffeeChatId` payload.
- Use `npm run seed:stern` in the eventual target environment to load only public clubs; it never selects targets or loads personal data. Use `npm run stern:recruiting-deadlines` for a local sweep if needed.
- Run integration review and the orchestrator's separate AI acceptance gate before merging/deploying. WP1's production browser harness is deliberately restricted to this worktree/database/port and must not be pointed at production.
