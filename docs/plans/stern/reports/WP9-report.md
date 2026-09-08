# WP9 report: Trust and self-correction

## Summary

Implemented shared name-stage identity resolution, audited duplicate sweeps, visible scheduling-in-progress state, independent hot-thread scans, automatic subscription-based batch verification, New York time parsing, and Google consent reminders. User API mutations run independently of the scanner.

Worktree: `/home/Arjun/stern-build/wt/wp9`, branch `stern/wp9`. Commands use the assigned DB copy or isolated fixture databases inside this worktree. No deployment, production DB access, mail scan against real accounts, or external messaging/calendar writes were performed.

Acceptance evidence:

- Identity resolution: `lib/stern/people.ts:140` and `:163`; shared import, API quick-add, CLI capture, and email paths. `sweepDuplicates` at `:409`, scan integration at `lib/stern/gmail-scan.ts:104`, and POST action at `app/api/stern/network/route.ts:57`. Sweeps preserve linked chat/draft/task/calendar records and are undoable.
- Scheduling: migration `db/migrations/0033_stern_hot_threads.sql:2`; apply logic `lib/stern/apply.ts:112`; terminal clearing `lib/stern/coffee.ts:44` and `:125`; snapshot phase and label in `lib/stern-types.ts`; both chat-chip surfaces and Overview display it. Hot eligibility/account/thread scope at `lib/stern/gmail-scan.ts:131`, guarded minute tick at `server/scheduler.ts:286`.
- Verification: dossier, Codex/Claude boundaries, schema, policy and persistent call history in `lib/stern/verify.ts:17` and `:52`; automatic call before calendar writes at `lib/stern/apply.ts:262`. Last 20 results, full-batch links, original/correction actions and provider settings appear in `components/stern/automation/AutomationView.tsx`. Claude connection registration and hourly check: `lib/stern/connections.ts:50`.
- Time parsing: `lib/stern/time.ts:109`; confirmed/proposed times in `lib/stern/apply.ts:234`, manual/observed scheduled times in `lib/stern/coffee.ts:49` and `:115`, interviews in `lib/stern/recruiting.ts:151`. Raw failures become audited suggestions through `lib/stern/time-review.ts`.
- Consent reminders: `lib/stern/google-reauth.ts:16`; consent callback `app/api/google/callback/route.ts:39`; migration backfill `db/migrations/0033_stern_hot_threads.sql:23`; scheduler reminder evaluation and connection countdown use the same consent source.
- Mutation independence: automation API dispatch no longer enters `automationJob`; network writes retain short IMMEDIATE transactions. `tests/stern-trust.test.ts:105` makes a real route-dispatched merge while a fixture scan is held. `:207` prevents stale calendar creation after a concurrent chat edit.

## Files changed

- `db/migrations/0033_stern_hot_threads.sql`: scheduling/thread metadata, message verification marker, verification history, indexes and consent backfill.
- `lib/stern/people.ts`: normalized-name resolution, promotion, ambiguous-name review, audited duplicate sweep and phase-aware person detail.
- `lib/stern/time.ts`: bounded New York event-time parser with invalid-date and DST-gap rejection.
- `lib/stern/time-review.ts`: shared audited raw-time review helper.
- `lib/stern/verify.ts`: untrusted dossier, strict verifier schema, subscription CLI boundaries, automatic policy and history.
- `lib/stern/llm.ts`: export the existing strict execution boundary and single-flight queue; permit a separate verifier model.
- `lib/stern/apply.ts`: parsed times, scheduling phase, shared identity resolution, automatic verification, review replay and stale-calendar check.
- `lib/stern/audit.ts`: refuse deletion of newly created entities with newer un-undone edits.
- `lib/stern/gmail-scan.ts`: independent thread scans, full-scan thread stamps, automatic sweep and invalid-grant reminders.
- `lib/stern/automation-source.ts`: fixture thread filtering and background-only queue contract.
- `lib/sources/google/index.ts`: account-scoped Gmail thread message listing through the existing authenticated reader.
- `lib/stern/coffee.ts`: scheduling lifecycle, time parsing and review fallbacks.
- `lib/stern/recruiting.ts`: interview parsing and chat phase snapshots.
- `lib/stern/overview.ts`: scheduling obligations with last-message timestamps and matching SQL totals.
- `lib/stern/rules-pass.ts`: account-aware reply clearing and scheduling-aware no-reply aging.
- `lib/stern/google-reauth.ts`: consent tracking, expiry calculations and daily account-specific reminders.
- `lib/stern/reminders.ts`: consent reminder evaluation and suppression after renewed consent.
- `lib/stern/connections.ts`: cached Claude headless health check and actionable authentication failure.
- `lib/stern/automation-connections.ts`: Claude card and consent expiry metadata.
- `lib/stern/automation-snapshot.ts`: bounded verification history.
- `lib/stern/notification-settings.ts`: audited provider/model settings and selected-provider connection enablement.
- `lib/stern-types.ts`: client-safe phase, verifier and consent display contracts.
- `app/api/google/callback/route.ts`: record successful consent time without changing the auth gate.
- `app/api/stern/automation/route.ts`: independent mutations, correction selection and authenticated full-batch retrieval.
- `app/api/stern/network/route.ts`: duplicate sweep action.
- `components/stern/automation/AutomationView.tsx`: verification section, correction actions, provider drawer and expiry labels.
- `components/stern/automation/shared.tsx`: stable audit batch anchors.
- `components/stern/network/PersonDrawer.tsx`, `components/stern/recruiting/People.tsx`: scheduling-aware chips.
- `server/scheduler.ts`: guarded hot-thread tick and retained minute timer.
- `package.json`: register `test:stern-trust`.
- `scripts/stern-wp6-e2e.ts`: include new settings in its fixture contract.
- `tests/fixtures/stern/trust.json`: placeholder identity, natural-time and verifier fixtures.
- `tests/stern-trust.test.ts`: 22 trust regressions covering domains, API/CLI capture, concurrency, CLI stubs, reauth and migration idempotency.
- `tests/stern-automation.test.ts`: independent verifier fixture mode and six-card expectation.
- `tests/stern-network.test.ts`: model a legacy duplicate explicitly because normal capture now prevents it.
- `tests/stern-overview.test.ts`: six-card cached/live read-model expectation.
- `docs/plans/stern/reports/WP9-report.md`: implementation decisions, evidence and handoff.

## How verified

Targeted suite:

```text
$ npm run test:stern-trust
# tests 22
# pass 22
# fail 0
```

The suite uses temporary databases, rejects network fetches, and substitutes local executables for both subscription CLIs. It covers all verdict policies, correction acceptance without automatic reverification, concurrent edit protection, hot-thread progress while a full scan is held, five-minute eligibility, and repeated real migration-runner invocations.

Local event CLI smoke on the assigned DB:

```text
{"eventId":6019,"run":"stern-wp9","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6020,"run":"stern-wp9","agent":"rathworkspace-platform-developer","status":"running"}
```

The first full gate passed 355 tests and both migrations, then caught a Next.js route signature error in its build-generated types. The GET signature was corrected before the final gate.

Final mechanical gate against the committed implementation:

```text
$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp9 /home/Arjun/stern-build/db/wp9.db wp9
=== typecheck (20260908T191302Z) ===
--- typecheck rc=0
=== tests (20260908T191306Z) ===
# tests 358
# pass 358
# fail 0
--- tests rc=0
=== migrate-1 (20260908T191357Z) ===
--- migrate-1 rc=0
=== migrate-2 (20260908T191358Z) ===
--- migrate-2 rc=0
=== build (20260908T191358Z) ===
✓ Compiled successfully in 15.9s
--- build rc=0
GATE wp9 result=PASS log=/home/Arjun/stern-build/logs/gate-wp9-20260908T191302Z.log
```

Implementation commits: `2f02c63` and `e02648a`. `git diff --check` passed. The report is committed separately after verification.

## Decisions made

- The name comparison strips punctuation, folds case and collapses whitespace. Club affiliation breaks ties; otherwise the oldest row wins. A suggestion creation audit records the candidate IDs and resolution reason. Existing email identities and merge tombstones take precedence.
- Sweeps archive duplicate people via existing audited merges, preserving history. A group containing multiple email-bearing rows is left alone. Sweeps also move linked chat/draft/task/calendar references so those records remain visible.
- Added `coffee_chats.gmail_account` in migration 0033 because an account is necessary for safe thread identity. Existing threads backfill from stored message evidence. Without an account, a legacy chat is not guessed into another account's scan.
- Hot scans use Gmail's thread endpoint, which returns the messages in that account's thread, including messages outside INBOX/SENT. They bypass the full background-job lane but share the FIFO single-flight model queue. Scheduler time is one minute; eligible threads are checked at most every five minutes while hot for 30 minutes.
- Verify database effects before external calendar creation. Strong disagreement rolls back atomically; a newer user edit causes the batch to remain applied and flagged instead of partially undoing user work. A second schedule check prevents stale calendar intents after a pending verifier.
- The existing Codex executor supplies strict schema enforcement and subscription authentication; no API-key fallback was added. Claude uses its subscription-default model and logs that selection. `claude -p` takes prompt text, so the isolated prompt file's contents are passed as an argv value, never shell interpolation. Tools and inherited MCP configuration are disabled. The auth probe sends exactly `Reply OK`; its result is cached across processes for an hour.
- Provider/model edits are audited manual settings. Selecting a provider enables its connection so health failures become visible. Low-confidence disagreement is flagged, alongside unsure results and any reported issues.
- A malformed provider response or unavailable verifier becomes an unsure/flagged record, preserving the call history and current effects for review. Fixture mode records deterministic opinions without contacting a provider.
- Unparseable time text is retained as a review suggestion rather than aborting ingestion. Explicit offsets are preserved; naive and natural values resolve in New York relative to message date. Missing manual scheduling input is still a validation error. The parser intentionally requires a concrete time and rejects nonexistent DST wall times.
- Reauth reminders are keyed by account and New York day, use both channels, and reuse existing delivery rules. `invalid_grant` queues an urgent reminder immediately; the reminder scheduler dispatches it. Reconsent invalidates pending old-consent reminders.

## Known gaps

- The supplied DB copy did not contain Stern tables before the session migration, and no worktree note contained suggestion 2's raw scheduled-time value. The requested read therefore could not supply that exact regression case. Tests cover all specified time formats with placeholders; the original value remains an evidence gap for the orchestrator.
- No real provider authentication smoke or production deployment was performed. The supplied notes say Claude headless auth is expired; the exact remediation is tested with an executable stub and displayed when the health check sees that failure.
- During initial regression work, an existing test temporarily selecting live LLM mode reached the new verifier boundary before its own fixture mode was added. That run was interrupted. Final tests independently force verifier fixtures or explicit local CLI stubs.

## Follow-ups for the orchestrator

- Merge the committed WP9 branch, then use the normal deployment workflow. Keep production verifier selection on Codex unless Claude subscription auth has been repaired with `claude setup-token`.
- Supply the missing historical raw time from suggestion 2 as a sanitized regression fixture during integration, without adding personal source data to git.
- After deployment, inspect automatic verification history and hot-thread freshness against authorized live mail. This build deliberately used fixture evidence and did not deploy.
