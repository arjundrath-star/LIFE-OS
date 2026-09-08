# WP9 report: Trust and self-correction

## Summary

Implemented shared name-stage identity resolution, audited duplicate sweeps, visible scheduling-in-progress state, independent hot-thread scans, automatic subscription-based batch verification, New York time parsing, and Google consent reminders. User API mutations run independently of the scanner. Fix round 1 addresses all 14 review/live-scan findings, including conflicting roster identities, retryable verifier failures, sender muting, course-title matching, and chronological thread context.

Worktree: `/home/Arjun/stern-build/wt/wp9`, branch `stern/wp9`. Commands use the assigned DB copy or isolated fixture databases inside this worktree. No deployment, production DB access, mail scan against real accounts, or external messaging/calendar writes were performed.

Acceptance evidence:

- Identity resolution: `lib/stern/people.ts:170` and `:192`; shared import, API quick-add, CLI capture, and email paths. `sweepDuplicates` at `:436`, scan integration at `lib/stern/gmail-scan.ts:117`, and POST action at `app/api/stern/network/route.ts:57`. Sweeps preserve linked chat/draft/task/calendar records and are undoable.
- Scheduling: migration `db/migrations/0033_stern_hot_threads.sql:2`; apply logic `lib/stern/apply.ts:145`; terminal clearing `lib/stern/coffee.ts:44` and `:125`; snapshot phase and label in `lib/stern-types.ts`; both chat-chip surfaces and Overview display it. Hot eligibility/account/thread scope at `lib/stern/gmail-scan.ts:146`, guarded minute tick at `server/scheduler.ts:286`.
- Verification: dossier, Codex/Claude boundaries, schema, policy and persistent call history in `lib/stern/verify.ts:18` and `:58`; automatic call before calendar writes at `lib/stern/apply.ts:293`. Last 20 results, full-batch links, original/correction actions and provider settings appear in `components/stern/automation/AutomationView.tsx`. Claude connection registration and hourly check: `lib/stern/connections.ts:50`.
- Time parsing: `lib/stern/time.ts:109`; confirmed/proposed times in `lib/stern/apply.ts:269`, manual/observed scheduled times in `lib/stern/coffee.ts:49` and `:115`, interviews in `lib/stern/recruiting.ts:151`. Raw failures become audited suggestions through `lib/stern/time-review.ts`.
- Consent reminders: `lib/stern/google-reauth.ts:16`; consent callback `app/api/google/callback/route.ts:39`; migration backfill `db/migrations/0033_stern_hot_threads.sql:23`; scheduler reminder evaluation and connection countdown use the same consent source.
- Mutation independence: automation API dispatch no longer enters `automationJob`; network writes retain short IMMEDIATE transactions. `tests/stern-trust.test.ts:105` makes a real route-dispatched merge while a fixture scan is held. `:207` prevents stale calendar creation after a concurrent chat edit.

## Files changed

- `db/migrations/0034_stern_review_fixes.sql`: append-only verification attempts and direct-recipient/list-delivery evidence; shipped migration 0033 remains unchanged.
- `db/migrations/0033_stern_hot_threads.sql`: scheduling/thread metadata, message verification marker, verification history, indexes and consent backfill.
- `lib/stern/people.ts`: normalized-name resolution, promotion, ambiguous-name review, audited duplicate sweep and phase-aware person detail.
- `lib/stern/time.ts`: bounded New York event-time parser with invalid-date and DST-gap rejection.
- `lib/stern/time-review.ts`: shared audited raw-time review helper.
- `lib/stern/verify.ts`: untrusted dossier, strict verifier schema, subscription CLI boundaries, automatic policy and history.
- `lib/stern/llm.ts`: export the existing strict execution boundary and single-flight queue; permit a separate verifier model.
- `lib/stern/apply.ts`: parsed times, scheduling phase, shared identity resolution, automatic verification, review replay and stale-calendar check.
- `lib/stern/audit.ts`: protect later manual edits on created entities and audit/undo the sender mute setting.
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
- `tests/stern-trust.test.ts`: 37 trust regressions covering domains, API/CLI capture, concurrency, CLI stubs, reauth and migration idempotency.
- `tests/stern-automation.test.ts`: independent verifier fixture mode and six-card expectation.
- `tests/stern-network.test.ts`: model a legacy duplicate explicitly because normal capture now prevents it.
- `tests/stern-overview.test.ts`: six-card cached/live read-model expectation.
- `docs/plans/stern/reports/WP9-report.md`: implementation decisions, evidence and handoff.

## How verified

Fixture regression suites on isolated temporary databases inside this worktree:

```text
$ npm run test:stern-trust
# tests 37
# pass 37
# fail 0

$ npm run test:stern-automation
# tests 37
# pass 37
# fail 0
```

The trust suite rejects network fetches and uses local executable stubs for both model CLIs. It covers large stdin prompts, isolated Claude HOME contents, a Claude auth probe while the LLM queue is held, retry after infrastructure failure, all verifier verdict policies, time correction/acknowledgement, conflicting roster imports, per-group sweep rollback, sender muting and undo, authenticated API actions, chronological thread units, course matching, scheduling, hot/full scan concurrency, and API mutations during a held scan.

Initial regressions reproduced three reported bugs before the fixes (`22 pass / 3 fail`). The broader automation suite then exposed a synthetic message missing direct-To evidence; that fixture now supplies the new delivery metadata. The cleanup API regression caught an SQL parenthesis error before final verification.

Assigned-DB lifecycle output:

```text
{"eventId":6022,"run":"stern-wp9-fix1","agent":"rathworkspace-platform-developer","status":"running"}
[db] applied migration 0034_stern_review_fixes.sql
{"eventId":6023,"run":"stern-wp9-fix1","agent":"rathworkspace-platform-developer","status":"running"}
```

The first round-1 gate passed all stages at `20260908T195557Z`. Final-review improvements to manual acceptance and malformed deadline handling were made during that gate, so a second gate is required on the final commit. Final gate output is recorded below when complete.

## Decisions made

- The name comparison strips punctuation, folds case and collapses whitespace. Email capture promotes a matching roster entry; club affiliation breaks ties, then the oldest row wins. Import and sweep preserve conflicting known club/org identities and create an audited merge review. Club names and abbreviations are equivalent organization identities. Existing email identities and merge tombstones take precedence.
- Sweeps archive duplicate people via existing audited merges, preserving history. A group containing multiple email-bearing rows or conflicting club/org identities is left alone. Each group has its own transaction rollback boundary; failed groups increment the failure count without stopping later groups. The sweep also repairs stale name-only dedupe keys, preserving disambiguating suffixes when distinct identities share a canonical key. Sweeps also move linked chat/draft/task/calendar references so those records remain visible.
- Added `coffee_chats.gmail_account` in migration 0033 because an account is necessary for safe thread identity. Existing threads backfill from stored message evidence. Without an account, a legacy chat is not guessed into another account's scan.
- Hot scans use Gmail's thread endpoint, which returns the messages in that account's thread, including messages outside INBOX/SENT. They bypass the full background-job lane but share the FIFO single-flight model queue. Scheduler time is one minute; eligible threads are checked at most every five minutes while hot for 30 minutes.
- Verify database effects before external calendar creation. Strong disagreement rolls back atomically; a newer user edit causes the batch to remain applied and flagged instead of partially undoing user work. A second schedule check prevents stale calendar intents after a pending verifier.
- The existing Codex executor supplies strict schema enforcement and subscription authentication; no API-key fallback was added. Claude uses its subscription-default model and logs that selection. Dossiers go through stdin, never argv. Its temporary HOME contains only a credentials symlink before startup; verifier instructions use `--system-prompt`. Tools, inherited settings, and MCP configuration are disabled. The auth probe sends exactly `Reply OK` outside the LLM queue, has a five-second timeout, and is cached across processes for an hour.
- Provider/model edits are audited manual settings. Selecting a provider enables its connection so health failures become visible. Low-confidence disagreement is flagged, alongside unsure results and any reported issues.
- Provider infrastructure/auth/schema failures keep `verdict` empty and do not flag messages or create review suggestions. A ten-minute claim lease permits automatic retry on later full/hot scan sweeps, including recovery from a crashed worker. Every attempt is retained in `stern_verification_attempts`; the original per-batch `stern_verifications` row shows its current pending/final outcome. Genuine model unsure/issue responses still create review flags. Fixture mode records deterministic opinions without contacting a provider.
- Unparseable time text is retained as a review suggestion rather than aborting ingestion. Explicit offsets are preserved; naive and natural values resolve in New York relative to message date. Missing manual scheduling input is still a validation error. The parser requires a concrete time and rejects nonexistent DST wall times. It accepts Sept, noon, midnight, and shared am/pm context, and advances an elapsed same-weekday time to the following week. Accepting an unparsed-time review without correction only acknowledges it. A correction must supply a parseable ISO value for every failed field before replay.
- Reauth reminders are keyed by account and New York day, use both channels, and reuse existing delivery rules. `invalid_grant` queues an urgent reminder immediately; the reminder scheduler dispatches it. Reconsent invalidates pending old-consent reminders.

- `other_nyu` suggestions require a personal To recipient (only connected own addresses in To) or mandatory/required wording, plus a valid future deadline within 30 days. List/automated delivery headers and no-reply/marketing/ServiceNow senders suppress these suggestions regardless of wording. This is an automatic-ingestion filter; an explicit manual acceptance remains authoritative.
- “Not for me” atomically dismisses and mutes the sender in audited kv. Bulk cleanup operates by suggestion type; `other_nyu` also recognizes legacy classification-array suggestions so old newsletter spam can be cleaned up without dismissing unrelated categories.
- Course resolution uses code, then normalized title in subject/body, then professor sender email; ambiguous matches remain reviewable. Threads are grouped as units after sorting by message date, and classifier context contains earlier messages only.
- Migration 0034 is additive because 0033 is already committed and shipped in the branch. It adds delivery evidence and per-attempt history without changing the schema contract or existing verifier history.

## Fix round 1

All findings are addressed. The numbered mapping below uses the orchestrator's review numbers.

| Finding | Implementation and regression evidence |
| --- | --- |
| 1: roster identity collision | `lib/stern/people.ts:145`, `:192`, `:436`; conflicting orgs and club-only affiliations survive repeated imports/sweeps; audited candidate review. `tests/stern-trust.test.ts:230`, `:336`. |
| 2: Claude argv limit/privacy | `lib/stern/verify.ts:18`; prompt streams to stdin. Executable stub checks a 180 KB prompt is absent from argv. `tests/stern-trust.test.ts:171`. |
| 3: verifier outage spam | `lib/stern/verify.ts:80`, `:112`; empty verdict, retained failed attempt, automatic later retry, no review flag. `tests/stern-trust.test.ts:262`. |
| 4: blocking Claude probe | `lib/stern/connections.ts:62`; independent five-second probe, hourly cache. Held-queue test at `tests/stern-trust.test.ts:171`. |
| 5: infinite time review replay | `lib/stern/apply.ts:307`; acknowledge-only default and validated `timeCorrections`; input controls at `components/stern/automation/AutomationView.tsx:26`. Tests at `:244`, `:253`, `:346`. |
| 6: bookkeeping blocks Undo | `lib/stern/audit.ts:275`; later-edit guard checks manual provenance. `tests/stern-trust.test.ts:277` also retains concurrent-manual-edit coverage. |
| 7: natural clock forms | `lib/stern/time.ts:109`; Sept/noon/midnight/shared meridiem and next same weekday. `tests/stern-trust.test.ts:240`. |
| 8: reschedule hot lane | `lib/stern/coffee.ts:119`; incoming terminal state clears scheduling, a new proposal returns a scheduled chat to reply_received. `tests/stern-trust.test.ts:287`. |
| 9: stale name dedupe keys | `lib/stern/people.ts:466`; audited sweep recomputation, preserving distinct identities. `tests/stern-trust.test.ts:287`. |
| 10: throwing sweep group | `lib/stern/people.ts:443`; per-group rollback and failure count; scanner adds failures to errors at `lib/stern/gmail-scan.ts:117`. Injected SQLite trigger test at `tests/stern-trust.test.ts:277`. |
| 11: inherited Claude instructions | `lib/stern/verify.ts:22`; temporary HOME with only a credentials symlink and explicit system prompt. Executable-stub assertions at `tests/stern-trust.test.ts:171`. |
| 12: suggestion spam/muting/cleanup | `lib/stern/apply.ts:61`, `:356`, `:374`; delivery evidence in migration 0034 and scanner; authenticated actions in `app/api/stern/automation/route.ts:47`; one-tap controls in `components/stern/automation/AutomationView.tsx:50`. Tests at `tests/stern-trust.test.ts:296`, `:306`, `:346`, `:362`, `:369`. |
| 13: course title matching | `lib/stern/apply.ts:41`, `:222`; code/title/professor order with ambiguity handling. Exact public course-title example at `tests/stern-trust.test.ts:315`. |
| 14: thread order/context | `lib/stern/gmail-scan.ts:60`, `:88`; thread units in date order and earlier-message context; `lib/stern/llm.ts:145` marks context untrusted. Interleaved-thread fixture at `tests/stern-trust.test.ts:326`. |

## Known gaps

- The supplied DB copy did not contain Stern tables before the session migration, and no worktree note contained suggestion 2's raw scheduled-time value. The requested read therefore could not supply that exact regression case. Tests cover all specified time formats with placeholders; the original value remains an evidence gap for the orchestrator.
- No new implementation gaps remain for the review findings. No real provider authentication smoke or production deployment was performed. The supplied notes say Claude headless auth is expired; the exact remediation is tested with an executable stub and displayed when the health check sees that failure.
- During initial regression work, an existing test temporarily selecting live LLM mode reached the new verifier boundary before its own fixture mode was added. That run was interrupted. Final tests independently force verifier fixtures or explicit local CLI stubs.

## Follow-ups for the orchestrator

- Merge the committed WP9 branch, then use the normal deployment workflow. Keep production verifier selection on Codex unless Claude subscription auth has been repaired with `claude setup-token`.
- Supply the missing historical raw time from suggestion 2 as a sanitized regression fixture during integration, without adding personal source data to git.
- Use the `other_nyu` bulk cleanup action to dismiss legacy newsletter task suggestions after integration; no production rows were modified here.
- After deployment, inspect automatic verification history and hot-thread freshness against authorized live mail. This build deliberately used fixture evidence and did not deploy.
