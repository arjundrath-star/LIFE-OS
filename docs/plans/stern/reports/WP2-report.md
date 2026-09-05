# WP2 report — Network

## Summary

Implemented the Stern people database and Network workspace on `stern/wp2`, in `/home/Arjun/stern-build/wt/wp2`. The domain, authenticated API, live snapshot, table, person drawer, and global quick-add sheet are connected. The existing capture CLI now uses the same people domain. No schema changes were needed.

Acceptance evidence:

| Requirement | Implementation and verification |
| --- | --- |
| People CRUD, dedupe, transitions, relationships, merge, archive, import/export | `lib/stern/people.ts:131` (create), `:155` (update), `:161` (status/relationships), `:235` (merge), `:302` (export), `:311` (import). Tests cover all 49 status pairs, collisions, repeated imports, SQL filtering and CSV escaping. |
| Affiliations and touchpoints with audit history | `lib/stern/people.ts:190` and `:215`; transactions and field-level audit at `:12` and `:64`. Touchpoint chronology and newest-50 tail are tested, including repeated local notes and Gmail dedupe. |
| Authenticated API and broadcast after every successful action | `app/api/stern/network/route.ts:17` and `:31`. The route test exercises every action and checks broadcasts/audit batches; anonymous browser access returns 401. |
| Table, filters, pagination and exports | `components/stern/network/NetworkTable.tsx:14`; all requested columns and filters, plus sphere, archived and sort controls. |
| Drawer, notes, affiliations, read-only chats/drafts, timeline | `components/stern/network/PersonDrawer.tsx:13`; chat/draft sections at `:73`, notes at `:76`, status/archive footer at `:81`. |
| Deep links, Escape, global capture, phone/desktop layouts | Network URL selection in `NetworkTable.tsx`; Radix dialog in `shared.tsx:10`; `QuickAddSheet.tsx:12` handles `stern:quick-add` and `?add=1`. Browser journey covers both entry paths and closing. |
| Read-only WP1 records | `lib/stern/people.ts:269` selects coffee chats and drafts. Merge only moves affiliations/touchpoints and archives the duplicate person. Tests compare chat/draft rows before and after merge. |
| Vault notes and undo | `lib/stern/people-note.ts:5`; `Stern/People/person-<id>.md` with required frontmatter. Writes defer until the outer transaction commits. Audit undo restores existing notes and marks undone captures. Missing vault is tested as a no-op. |
| Verification and durable handoff | Results below; scoped implementation commits and this report are on `stern/wp2`. |

## Files changed

- `lib/stern/people.ts`: validation, SQL queries/counts, write transactions, dedupe, editable allowlist, transitions, affiliations, touchpoints, merge/archive, import/export and vault coordination.
- `lib/stern/people-note.ts`: shared vault renderer used by writes and undo, with stable filenames.
- `lib/stern/audit.ts`: synchronize existing person notes after a successful undo; preserve withdrawn capture narratives with an explicit marker.
- `lib/stern-types.ts`: client-safe person, affiliation, touchpoint, query/response and Network snapshot contracts.
- `lib/stern/snapshot.ts`: populate the Network section of the shared Stern broadcast.
- `app/api/stern/network/route.ts`: authenticated snapshot/detail/query/download GETs and all required mutation actions.
- `app/stern/network/page.tsx`: Network page entry and Suspense skeleton.
- `components/stern/network/NetworkTable.tsx`: filters, real empty states, dense table, exports, pagination and person deep links.
- `components/stern/network/PersonDrawer.tsx`: all requested sections, contact copying/editing, affiliation actions, serial notes autosave, relationship/strength/status controls and archive.
- `components/stern/network/QuickAddSheet.tsx`: global Person/Task/Note capture; keyboard viewport handling; explicit Task 404 fallback.
- `components/stern/network/shared.tsx`: themed Radix dialogs, form controls and network action helper.
- `components/stern/SternShell.tsx`: mount capture across Stern pages and display a live outreach count on the Network rail entry.
- `components/stern/Page.tsx`: test IDs on the reusable strength controls.
- `app/globals.css`: scoped Network layouts and responsive styles, using the existing Stern tokens; correct shared Button colors within Stern.
- `scripts/stern-cli.ts`: route people/status/touchpoint writes through the new domain while retaining existing arguments, output and task behavior.
- `tests/stern-network.test.ts`: nine test groups covering domain, transactions, every API action, authentication boundary, audit/undo and vault behavior.
- `tests/fixtures/stern/network.json`: placeholder-only import fixtures.
- `scripts/stern-network-e2e.ts`: repeatable, local-only authenticated desktop/mobile browser journey, external request blocking and audit-API cleanup.
- `package.json`: `test:stern-network` and `e2e:stern-network` scripts.
- `.gitignore`: isolated test directories and browser artifacts.
- `docs/plans/stern/reports/WP2-report.md`: this handoff.

## How verified

All shell commands inherited `RATHWORKSPACE_DB=/home/Arjun/stern-build/db/wp2.db`; domain tests explicitly create disposable test databases, matching the repo test convention. The local browser server used port 3120, a fixture-only NextAuth identity, `STERN_VAULT_WRITE=0`, and Next's server without the scheduler. Browser requests outside the local origin were blocked. The server was stopped after verification. Production was not deployed, restarted, or modified.

Targeted domain/API checks:

```text
$ npm run test:stern-network
1..9
# tests 9
# pass 9
# fail 0
```

Existing CLI/foundation regression checks:

```text
$ npm run test:stern-foundation
1..5
# tests 5
# pass 5
# fail 0
```

Authenticated browser journey:

```text
$ npm run e2e:stern-network
{"anonymousStatus":401,"desktopTable":true,"drawerWidth":440,"deepLink":true,"escape":true,"notesAutosave":true,"relationshipAndStrength":true,"phoneSheet":{"x":0,"width":390,"bottom":844},"task404Fallback":true,"quickNote":true,"keyboardViewportSaveVisible":true,"browserErrors":0}
```

The keyboard check reduces the phone viewport to 390×520 and asserts Save remains visible; this is a viewport simulation, not a physical phone keyboard test. Reviewed the generated desktop table/drawer and phone sheet screenshots in `.stern-network-e2e/` (ignored, fixture-only artifacts). The journey undoes its mutation batches through `/api/stern` before exiting.

Mechanical gate (fixture-only auth environment; assigned DB path):

```text
$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp2 /home/Arjun/stern-build/db/wp2.db wp2
--- typecheck rc=0
# tests 204
# pass 204
# fail 0
--- tests rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp2.db
--- migrate-1 rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp2.db
--- migrate-2 rc=0
 ✓ Compiled successfully in 31.1s
--- build rc=0
GATE wp2 result=PASS log=/home/Arjun/stern-build/logs/gate-wp2-20260905T001326Z.log
```

Post-browser cleanup query returned `{"browserFixturesRemaining":{"n":0}}`. Lifecycle events in the assigned DB: start `6019`, verification `6020`, under run `stern-wp2-build`. Implementation commits: `532592d` and `db053b0`. Final handoff is committed separately with this report.

## Decisions made

1. Followed the HTML design handoff screens 04, 05 and 11 by reading their markup, without rendering the design export. Used 40px table rows, the 440px drawer, violet relationship chips, muted section labels, and a fixed Save footer. The affiliation form expands on demand so the drawer's notes and timeline remain visible.
2. Preserved the shipped schema. Local touchpoints receive a `local:<uuid>` value in `gmail_message_id`; real Gmail references retain their exact values. This avoids the existing UNIQUE constraint collapsing all manual notes of the same kind. `source` distinguishes local entries from email records.
3. Merges archive the duplicate instead of deleting it, preventing cascading writes to WP1's coffee chats. Affiliation/touchpoint duplicates consolidate blank metadata and retain full delete snapshots for undo. Coffee chats and drafts stay attached to their original person and remain accessible from that person's archived drawer.
4. When a survivor lacks an email or organization identity, merge can transfer that identity after releasing the duplicate's dedupe key in the same audited transaction. A non-empty survivor email is retained; a different duplicate email fills an empty alternate-email field.
5. Vault filenames use stable `person-<id>` slugs so names can change and identical names cannot overwrite each other's notes. Undoing a create retains its existing narrative with `capture_undone: true`; undoing an edit restores the existing note. No vault files are deleted.
6. `createPerson` can enrich an exact name/org capture when its email becomes known. Otherwise it resolves by dedupe key and fills only empty fields unless the trusted caller explicitly passes `overwrite:true`. Status edits always use the transition rules.
7. SQL searches escape LIKE metacharacters; pagination is 25 rows and export includes every matching row, not just the current page. CSV quotes fields, escapes quotes/newlines and prefixes spreadsheet formula-leading text with an apostrophe.
8. One server-generated audit batch covers an API action, including a quick-add person plus affiliation. Trusted jobs can supply one batch across related domain calls. `peopleWrite()` is the outer transaction helper for coordinated writes and deferred vault updates.
9. The Task segment sends `{action:"task.create", task:{...}}` to the future Tasks API. Until that route exists, its specified 404 message appears inline. Note capture requires an existing person and uses `touchpoint.add`.
10. Used event-driven API refreshes from `useLiveData("stern")`; no client polling or scheduler additions. The rail badge counts `needToReachOut`. No real people were seeded.

## Known gaps

No outstanding WP2 implementation gaps. Task creation depends on WP4's Tasks route, as specified; its absent-route fallback is implemented and verified. WP1 records are intentionally read-only. A merge does not relink those records, and their original archived person remains available for inspection.

No production service, external provider or physical-phone session was exercised. The local browser server used a fixture identity and blocked external requests; production auth behavior was not changed.

## Follow-ups for the orchestrator

- Merge shared-file changes additively: retain both packages' sections in `lib/stern/snapshot.ts` and `lib/stern-types.ts`, plus the global quick-add mount in `SternShell.tsx`.
- WP3 should call these exported domain functions with its source and shared batch ID. WP1/WP3 retain ownership of coffee-chat creation and draft rules after a person enters `need_to_reach_out`.
- WP4 should accept the documented Task action payload; remove no fallback behavior while that route is absent.
- If product semantics later require moving coffee chats/drafts when people merge, coordinate that explicitly with their owning package; WP2 preserves the read-only boundary.
- Rebuild with the real runtime environment during the integration/deployment package. WP2's gate and browser setup use fixture auth configuration and do not authorize deployment.
