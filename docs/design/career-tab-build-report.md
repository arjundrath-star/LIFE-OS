# Career tab build report

Date: 2026-08-07
Platform developer run: `platform-dev-20260807T153927Z`

## 1. What I built

- Added the auth-gated `/career` dashboard tab, primary navigation entry, Career home tile, `career` WebSocket channel, and scheduler-owned live snapshot.
- Built one canonical Notion-style tracker with Table, status-grouped Board, deadline Timeline, shared category/status/search filters, quick-add, inline editing, and a right-side properties/history drawer.
- Added the next-14-day deadline strip, with error emphasis at three days or fewer.
- Added the review-gated suggestions inbox. Accept creates or updates an endeavor inside an IMMEDIATE transaction; dismiss persists the unique non-null dedupe key so the evidence cannot be proposed again.
- Added migration `0019_career.sql`: strict kind/category/status constraints, `endeavors`, append-only `endeavor_events`, `career_suggestions`, configurable `career_watchlist`, indexes, and the `career-scout` registry row.
- Added an idempotent Fall 2026 importer. It reads the source directory without modifying it, imports all 38 researched programs, recognizes 23 draft files, links drafted rows to the approved Drive track folders, adds three already-submitted Klade applications, and adds three engagement rows.
- Added `agents/career-scout/AGENTS.md`, a 30-minute Gmail status job, and a daily evidence-backed watchlist hunter. Gmail uses the existing encrypted multi-account reader, Gmail read-only scope, paginated real message IDs, and no send path.
- Added separate Connections rows and OAuth actions for `arjun@kladeai.com`, `arjundrath@gmail.com`, and the connected NYU Workspace account. An NYU OAuth refusal records the clean tenant-approval blocker instead of inventing another mail adapter.
- Added deterministic Career tests and an authenticated Puppeteer journey that covers first paint, all three views, quick-add, suggestion acceptance, WebSocket reconnection, screenshot capture, and targeted cleanup.
- Left the existing Projects tab and the auth allowlist unchanged.

## 2. What is verified

Migration idempotency, twice:

```text
$ npm run migrate
[db] migrations up to date at /home/Arjun/rathworkspace/data/rathworkspace.db
$ npm run migrate
[db] migrations up to date at /home/Arjun/rathworkspace/data/rathworkspace.db
```

Seed idempotency, twice with identical counts:

```text
$ npm run seed:career
{"sourcePrograms":38,"draftFiles":23,"counts":{"total":44,"applications":41,"engagements":3,"drafting":20,"submitted":3}}
$ npm run seed:career
{"sourcePrograms":38,"draftFiles":23,"counts":{"total":44,"applications":41,"engagements":3,"drafting":20,"submitted":3}}
```

Static checks and tests:

```text
$ npm run typecheck
tsc --noEmit
# exit 0

$ npm run test
1..88
# tests 88
# pass 88
# fail 0
```

Production build and deployment:

```text
$ npm run build
✓ Compiled successfully
BUILD_ID=ySnfWkWs980vyBpH9gyYg

$ sudo systemctl restart rathworkspace.service
$ systemctl is-active rathworkspace.service
active
MainPID=2483993
ActiveState=active
SubState=running
```

The auth gate still rejects anonymous Career API access and accepts a real allowlisted session:

```text
unauthenticated_status=401
authenticated_status=200
{"total":44,"applications":41,"engagements":3,"nextDeadline":"2026-08-09"}
```

Authenticated production browser verification through `https://rathworkspace.cloud` after the final restart:

```json
{"origin":"https://rathworkspace.cloud","authenticated":true,"seededRows":44,"boardCards":45,"table":true,"board":true,"timeline":true,"quickAdd":true,"suggestionAccepted":true,"websocket":"open","screenshot":"/tmp/career-e2e-1786118699255.png"}
```

The test rows were removed after the journey:

```json
{"total":44,"applications":41,"engagements":3,"pending":0,"e2eRows":0}
```

Agent event writer smoke:

```text
{"eventId":1280,"run":"career-smoke-20260807T160238Z","agent":"career-scout","status":"running"}
{"eventId":1281,"run":"career-smoke-20260807T160238Z","agent":"career-scout","status":"completed"}
```

The real opportunity-hunter smoke had working scheduled-job network access. It skipped already-tracked sources, fetched four untracked pages, found no qualifying explicit signal, and fabricated nothing:

```json
{"watchlist":11,"fetched":4,"proposed":0,"failed":1}
```

## 3. What is blocked

- All three Career Gmail connection rows currently need re-auth and are intentionally `off`: `arjun@kladeai.com`, `arjundrath@gmail.com`, and `ar10850@nyu.edu`. The live job isolated all three failures cleanly: `{"accounts":3,"accountFailures":3,"messages":0,"proposed":0}`.
- NYU tenant approval is not yet proven to be required. The account is presently unauthorized; if NYU returns OAuth `access_denied`, the connection row will change to `connect blocked — needs NYU tenant approval`.
- Individual Google Docs were not listed because the approved reader has no Drive scope. Drafted applications link to the correct Klade, Individual, or NYU Drive folder, which is the prompt's allowed fallback.
- One untracked watchlist page failed to fetch in the smoke run. The daily job will retry it; this is a source-specific fetch issue, not a hunter-runtime limitation.

## 4. What Arjun must do

1. Open **Connections** and connect/re-auth the three Career Gmail rows: Klade, Personal, and NYU. Use the actual NYU Google Workspace account when prompted.
2. If NYU refuses consent, leave its row in the recorded tenant-approval state and request NYU approval for the existing Google OAuth app. Do not add a Microsoft connection.
3. Open **Career → Suggestions** periodically and accept or dismiss each evidence-backed proposal. Nothing from email or the web changes an endeavor without this review.
4. Rename **Summer 2026 internship** with the exact employer when convenient.
