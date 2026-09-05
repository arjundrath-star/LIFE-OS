# WP2 report — Network

## Summary

The Network database, authenticated API, table, person drawer and global quick-add sheet are implemented on `stern/wp2`. This report includes the September 5 review fix round. Merged `feature/stern-tab` first (fast-forward through `217a9ed`), retaining the orchestrator's broadcast change guard and the integrated WP1/WP4 packages.

All confirmed review findings are addressed, including the permitted archived-record-link fallback for merged coffee chats and drafts. No WP2 schema migration was added, and neither `lib/stern/recruiting.ts` nor `lib/stern/coffee.ts` was edited in this round. WP2 only reads coffee chats, drafts and club catalog rows.

Acceptance checklist:

- [x] Audited people CRUD, affiliations, touchpoints, merge, archive, import/export through the authenticated API (`app/api/stern/network/route.ts:30`; domain/API tests).
- [x] Table filters, complete drawer sections, desktop/mobile quick add and deep links (`components/stern/network/NetworkTable.tsx:13`, `PersonDrawer.tsx:12`, `QuickAddSheet.tsx:11`; browser journey).
- [x] Coffee chats and drafts remain read-only, including merge regression checks (`lib/stern/people.ts:291`).
- [x] Create/notes edits write `Stern/People/` notes; missing vault is a no-op (`lib/stern/people-note.ts:5`; vault tests).
- [x] Tests and gate pass; report committed on `stern/wp2`.

## Files changed

Fix-round files, relative to the merged baseline:

- `lib/stern/people.ts`: SQL-derived Network version; audited archive restoration; non-empty merge tombstones and alias resolution; editable archived duplicates; recursive merged-record links; validation, CSV and touchpoint evidence fixes; best-effort vault synchronization.
- `lib/stern/audit.ts`: recompute contact dates from remaining touchpoints inside the undo transaction; identify both owners of moved touchpoints; contain post-commit vault failures.
- `lib/stern-types.ts`: Network version and merged-record detail contracts; document local touchpoint references.
- `app/api/stern/network/route.ts`: duplicate capture applies requested outreach status in the same audited transaction; unexpected failures return a generic message.
- `components/stern/network/shared.tsx`: ref-based version invalidation shared by all three consumers; native Stern buttons.
- `components/stern/network/NetworkTable.tsx`: use version invalidation, empty-state Quick add action and row actions.
- `components/stern/network/PersonDrawer.tsx`: version invalidation, archived merge links, exact kind labels, friendly missing-person message and native buttons.
- `components/stern/network/QuickAddSheet.tsx`: version invalidation, explicit matched-person feedback/link, Tasks availability preflight and native buttons.
- `app/globals.css`: row actions, fieldset layout and scoped ghost-button states that coexist with recruiting's shared primitive remaps.
- `scripts/stern-cli.ts`: document the existing enforced status transition contract.
- `tests/stern-network.test.ts`: 16 groups covering the original acceptance criteria and fix-round regressions, including API broadcasts after vault failure.
- `tests/stern-foundation.test.ts`: trusted CLI rejects non-adjacent status transitions without changing the person.
- `scripts/stern-network-e2e.ts`: runtime-only auth secret, deterministic local live snapshots, duplicate feedback, request-count assertions, Tasks 404 and available-route coverage, desktop/mobile journey and audit cleanup.
- `docs/plans/stern/reports/WP2-report.md`: this report.

Earlier implementation commits (`532592d`, `db053b0`, `9bfd028`) supply the remaining WP2 files, including the Network page, global shell mount, People vault renderer, import fixtures and package scripts.

## Fix round

| Finding | Resolution and evidence |
| --- | --- |
| 1: idle/unrelated live objects trigger GETs | `lib/stern/people.ts:345` computes a digest of SQL markers, scoped audit IDs and picker values. `components/stern/network/shared.tsx:9` remembers the last marker. Table, drawer and sheet all use it. Unchanged ticks and unrelated tasks keep the version stable; affiliation edits/deletes, undo, touchpoints and read-only drawer data change it. Tests exercise the hook and real built components. |
| 2 / 10: empty merge key and uneditable archived duplicate | `lib/stern/people.ts:257` writes audited `merged:<dropId>:<keepId>` tombstones for every merge. `:125` preserves them when editing archived rows. Tests assert zero empty keys for email and organization transfers, editable notes and undo restoring original keys. |
| 3 / 5: duplicate capture drops outreach intent | `app/api/stern/network/route.ts:39` explicitly transitions a match to `need_to_reach_out`. `QuickAddSheet.tsx:52` displays the matched name, explains fill-blanks/relationship preservation and links to the drawer. API regressions cover email and name identities; browser coverage checks the notice and resulting status. |
| 4: recapture lands on hidden archived person | `lib/stern/people.ts:138` restores an ordinary archived dedupe hit in the audited capture transaction. Tests verify visibility and undo of restoration. |
| 6: dropped email resolves to duplicate | Create resolves active alternate emails and follows audited tombstones to the survivor. Tests cover occupied alternate-email fields and successive merges. |
| 7: stale last contact after out-of-order undo | `lib/stern/audit.ts:179` collects affected people, including reverted touchpoint snapshots and both old/new owners. `:270` recomputes the date under the transaction lock and records derived corrections. Tests undo older then newer batches and verify the remaining maximum or empty value. |
| 8: hidden WP1 records after merge | Chose the explicitly allowed no-schema fallback. `lib/stern/people.ts:291` returns recursively merged archived records; `PersonDrawer.tsx:72` renders their names and links under “Merged records”. Their original read-only coffee chats/drafts remain discoverable. Tests assert these links' data and byte-for-byte unchanged WP1 rows. Unified survivor rendering is a WP7 follow-up. |
| 9: prototype sort keys | `lib/stern/people.ts:320` uses an own-property allowlist. Domain and API tests reject `constructor`, `__proto__`, `toString` and `hasOwnProperty` with HTTP 400 and “Invalid sort”. |

Additional low findings fixed: hide synthetic local IDs at the detail read boundary; accept Gmail evidence only for Gmail touchpoints (the browser route forces manual); contain and redact vault failures; bound name aliases, affiliation fields and touchpoint text; keep club-linked organization names canonical; neutralize whitespace-prefixed CSV formulas; use exact draft/touchpoint labels; show “Person not found”; add row/empty-state actions; preserve ghost hover styles; preflight Tasks availability; remove the committed browser auth secret. Regression coverage includes all substantive data changes.

## How verified

Commands use `RATHWORKSPACE_DB=/home/Arjun/stern-build/db/wp2.db`. Domain tests create and remove disposable databases/vaults inside this worktree. Gates use fixture auth, `RATHWORKSPACE_SECRETS_PATH=/dev/null`, a generated runtime secret, disabled vault writes and disabled Next telemetry. Browser checks use only `127.0.0.1:3120`, a Next server without the scheduler, and block external requests. The real LiveProvider receives deterministic simulated WebSocket snapshots; this checks client request behavior without starting provider jobs.

Targeted verification:

```text
$ npm run test:stern-network
# tests 16
# pass 16
# fail 0

$ npm run test:stern-foundation
# tests 9
# pass 9
# fail 0
```

The initial regression run reproduced three failing groups (archived recapture, out-of-order touchpoint undo and inherited sort keys) before the fixes. An initial browser harness failed because its injected class depended on a transpiler helper; the harness now injects plain JavaScript and waits specifically for Network requests to settle.

Final mechanical gate, against the assigned DB and final implementation commit `3595ff7`:

```text
$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp2 /home/Arjun/stern-build/db/wp2.db wp2
--- typecheck rc=0
# tests 241
# pass 241
# fail 0
--- tests rc=0
--- migrate-1 rc=0
--- migrate-2 rc=0
 ✓ Compiled successfully in 19.1s
--- build rc=0
GATE wp2 result=PASS log=/home/Arjun/stern-build/logs/gate-wp2-20260905T031457Z.log
```

Final authenticated browser journey, after the gate rebuilt the application:

```text
$ npm run e2e:stern-network
{"anonymousStatus":401,"duplicateCaptureNotice":true,"unchangedLiveGets":0,"changedLiveGets":2,"unchangedSheetGets":0,"changedSheetGets":2,"desktopTable":true,"drawerWidth":440,"deepLink":true,"escape":true,"notesAutosave":true,"relationshipAndStrength":true,"phoneSheet":{"x":0,"width":390,"bottom":844},"task404Fallback":true,"taskCreate":true,"quickNote":true,"keyboardViewportSaveVisible":true,"browserErrors":0}
```

Zero unchanged GETs applies separately to table+drawer and table+sheet. Each changed marker caused exactly one GET per mounted consumer. The absent Tasks response was simulated locally; task creation also passed against the real integrated Tasks API. Reviewed fixture-only desktop drawer and phone sheet screenshots under the ignored `.stern-network-e2e/` directory.

Cleanup and lifecycle outputs:

```text
{"browserCleanup":{"people":0,"tasks":0,"emptyKeys":0}}
$ ss -ltnp 'sport = :3120'
State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
{"eventId":6022,"run":"stern-wp2-fix-20260905","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6023,"run":"stern-wp2-fix-20260905","agent":"rathworkspace-platform-developer","status":"completed"}
```

The local server exited successfully. No browser fixtures remain, no assigned-database person has an empty dedupe key, and the final handoff commits this report with a clean worktree.

## Decisions made

1. Preserve fill-blanks semantics on duplicate capture. Outreach intent is an explicit permitted status transition; an existing relationship remains intact and the sheet states that clearly, with a link to edit it.
2. Restore ordinary archived contacts on recapture. Merged duplicates instead resolve to their survivor, including merge chains; they are never restored as independent contacts by that lookup.
3. Keep the schema contract unchanged. Encode the survivor in the audited non-empty tombstone and expose archived-record links. Merges move affiliations/touchpoints only; coffee chats and drafts retain their original owners.
4. Use SQL-computed version inputs plus scoped audit IDs, rather than timestamps alone: same-millisecond mutations, deletions and undo must invalidate queries. Unrelated recruiting status/program/task changes do not invalidate Network data.
5. Treat contact dates as derived data, recomputed inside undo's IMMEDIATE transaction. Vault writes happen after commit and are best-effort; their failures cannot misreport a committed database write or prevent its broadcast.
6. Keep stable `Stern/People/person-<id>.md` filenames. These are unique slugs, survive renames and preserve existing vault links. Human-readable names remain in frontmatter.
7. Keep the trusted CLI on the same status transition rules as the dashboard. Documented the contract in its header and added a foundation regression; no force bypass was introduced.
8. Scope UI changes to WP2 and preserve imported recruiting button rules. The available Tasks route is exercised locally, and its missing-route fallback remains supported.

## Known gaps

No outstanding confirmed WP2 review findings or acceptance blockers. Read-only merged coffee chats/drafts require opening the linked archived record, as permitted by the fix instructions. The drawer still offers draft copying rather than an unverified provider deep link; Gmail draft/calendar links are deferred for agreement with WP1. Local touchpoint uniqueness still uses internal synthetic references under the shipped constraint; the detail API hides them.

A failed vault mirror is logged with a redacted message and may remain stale until another write or reconciliation. No real provider credentials, production service, external side effects or physical phone keyboard were exercised. Mobile keyboard verification uses a reduced viewport.

## Follow-ups for the orchestrator

- Merge `stern/wp2` again; fix commits are `088843f` and `3595ff7`, followed by this report's final commit. No push or deployment was performed.
- WP7: if unified survivor coffee-chat/draft sections are desired, add an explicit merge relation migration and coordinate read models with WP1; the archived links are the current supported path. Coordinate verified Gmail/calendar deep links with WP1 as well.
- WP7: consider dedicated local touchpoint identifiers and a vault reconciliation/retry job. Do not expose synthetic IDs as Gmail evidence.
- Carry the documented CLI status transition contract into the owning Hermes prompt. Captures can always request `need_to_reach_out`; non-adjacent status jumps return an error.
- Deploy/build with the actual runtime configuration in the integration package. This run authorizes no production restart, provider write or git push.
