# System audit

Working inventory of what exists and runs, produced 2026-07-28 by reading the code and
inspecting live state on the host. Every row is marked VERIFIED (observed in code, in the
database, or in a running service) or CLAIMED-UNVERIFIED (described in a doc, not confirmed)
or ABSENT (referenced somewhere but not built). Only VERIFIED rows may be stated as working
in the README.

Method: nine parallel readers over disjoint subsystems, each required to cite file:line,
a query result, or a command output, followed by a completeness critic that re-checked gaps
and contradictions directly against the host.

## Runtime and security model

| Item | Status | Evidence |
|---|---|---|
| Custom Node server owns Next.js, one WebSocket, and the scheduler | VERIFIED | `server.ts`, `server/live.ts`, `server/scheduler.ts` |
| Scheduler is the only poller; panels never poll | VERIFIED | `server/scheduler.ts` tick broadcasts channel snapshots; panels read `useLiveData` |
| Three-layer auth gate (NextAuth signIn callback, middleware, custom-server cookie check) | VERIFIED | `lib/auth.ts`, `middleware.ts`, `server.ts` upgrade/proxy checks |
| Email allowlist gate on every route and on the WebSocket | VERIFIED | `lib/secrets.ts` allowlist read, `middleware.ts`, server upgrade handler |
| Cloudflare tunnel is the sole public ingress | VERIFIED | `cloudflared-rathworkspace.service` enabled; app binds loopback only |
| Four systemd units (app, ttyd, filebrowser, tunnel) all enabled and running | VERIFIED | `systemctl` on the host. A fifth `rathworkspace-placeholder.service` exists and is disabled |
| Secrets in an out-of-repo env file; Google/WHOOP refresh tokens AES-256-GCM encrypted at rest | VERIFIED | `lib/secrets.ts`, `lib/crypto.ts`, `db/migrations/0004_whoop_tokens.sql` |
| ttyd and filebrowser bound to loopback, reachable only through gated path proxies | VERIFIED | `scripts/run-ttyd.sh`, `scripts/run-filebrowser.sh`, `server.ts` `proxyFor` |
| SQLite data layer, migrations applied on boot | VERIFIED | `db/index.ts`, `db/migrations/0001..0017` |

## Life OS dashboard

| Item | Status | Evidence |
|---|---|---|
| Routed app under `app/(dash)` with shared server-auth layout | VERIFIED | `app/(dash)/layout.tsx`, `components/shell/DashShell.tsx` |
| Nav rail as a live instrument (per-item status off the WebSocket) | VERIFIED | `components/shell/NavRail.tsx`, `hooks/useLiveData.tsx` |
| Command palette, ambient mode | VERIFIED | `components/shell/CommandPalette.tsx`, `components/shell/AmbientScreen.tsx`, `hooks/useIdle.ts` |
| Google accounts: per-account Gmail unread radar, recent feed, today's calendar | VERIFIED | `lib/sources/google/index.ts`, scheduler tick, live DB rows |
| WHOOP v2 recovery / sleep / strain | VERIFIED | `lib/sources/whoop/index.ts`; live and returning values (README previously called this stubbed) |
| Hermes gateway + Telegram health surfaced from the agent runtime's own status | VERIFIED | `lib/sources/hermes/index.ts`, `lib/sources/telegram/index.ts` |
| Obsidian vault projects feed | VERIFIED | `lib/sources/vault/index.ts` |
| Ad-agency page reading live generation history and credit balance from a CLI | VERIFIED | `app/api/adagency/route.ts` |
| AgentMemory read-only BFF (fixed upstream paths, secret redaction, bounded search) | VERIFIED | `lib/agentmemory.ts`, `app/api/agentmemory/route.ts`; upstream service live on loopback |
| Terminal and Files embeds behind the gate | VERIFIED | `app/(dash)/terminal`, `app/(dash)/files`, server proxy on trailing-slash subpaths |
| Mercury revenue ingestion | ABSENT | No tracked code writes `revenue_daily`; `lib/vending.ts` only reads it. The old README claimed revenue "fills in automatically" |

## Business suite

| Item | Status | Evidence |
|---|---|---|
| Second shell at `app/business` with its own layout, rail, and business-unit switcher | VERIFIED | `app/business/layout.tsx`, `components/business/BusinessShell.tsx` |
| Legacy `/vending`, `/pokemon-crm`, `/pokemon-ops` are redirect stubs into `/business/*` | VERIFIED | those three page files; `lib/business-workspace.ts` redirect map |
| Unit boundary: non-Pokemon units render honest empty states, never relabeled data | VERIFIED | `components/business/BusinessContext.tsx` `PokemonDataBoundary` |
| CRM: one editable SQLite pipeline plus five read-only lead sheets | VERIFIED | `components/business/CrmWorkspace.tsx`, `lib/business/crm-sheets.ts` |
| CRM data model: leads, contacts, phone numbers, emails, touchpoints, import batches | VERIFIED | `db/migrations/0009_pokemon_crm.sql` |
| CRM invariant: leads start inactive, first logged touchpoint flips active permanently | VERIFIED | `lib/pokemon-crm.ts` |
| Idempotent pipeline import with fingerprint receipts | VERIFIED | `db/migrations/0010_pokemon_pipeline_sink_receipts.sql`, `scripts/import-pokemon-pipeline-crm.ts` |
| Lead fit and owner-access scoring | VERIFIED | `lib/pokemon-fit.ts` |
| Locations: fleet with service-priority scoring, placement kanban, outreach read model | VERIFIED | `components/business/LocationsWorkspace.tsx`, `lib/vending.ts`, `lib/vending-service.ts` |
| Machine service loop: physical counts, snapshot-token concurrency, idempotency key, lot-sourced refills | VERIFIED | `lib/vending-service.ts`, `db/migrations/0014_vending_service_loop.sql`, 12/12 unit tests pass |
| Stock is derived, never stored (audit baseline plus subsequent events minus sales) | VERIFIED | `lib/vending-service.ts` |
| Sourcing: tracked products, dated buy targets, market benchmarks, deal evaluation | VERIFIED | `lib/pokemon-ops/*`, `db/migrations/0011..0017` |
| Daily market price refresh and twice-weekly sourcing scan | VERIFIED | agent runtime cron jobs; `agents/pokemon-sourcing-scout/scripts/*` |
| Rules engine producing recommendations, plus alert digest | VERIFIED | `lib/pokemon-ops/rules.ts`, `scripts/pokemon-ops-alerts*` |
| Inventory reconciliation between assignments, stock events, sales, and physical counts | VERIFIED | `lib/pokemon-ops/db.ts`, `lib/vending-service.ts` |
| Finance workspace as an operational read model with an explicit "not a ledger" boundary | VERIFIED | `components/business/FinanceWorkspace.tsx` |
| Machine cost / monthly payment / ROI / tax / insurance tracking | ABSENT in this repo | No such fields or computations exist. The books live in an external spreadsheet maintained by an agent skill |
| Automated telemetry ingestion from the machine payment terminal | ABSENT | Planned only |
| CRM ingestion from daily sales logs | ABSENT | Confirmed absent in the repo and on the host |
| Pocket (wearable audio) ingestion | ABSENT before this session | Adapter scaffolding added this session, inert until configured |
| Granola ingestion | ABSENT before this session | Adapter scaffolding added this session, inert until configured |

## Agent harness

| Item | Status | Evidence |
|---|---|---|
| Agent runtime on the host is the top-level orchestrator, woken by cron and by chat | VERIFIED | runtime install and its own cron scheduler on the host |
| Five worker profiles plus a default profile | VERIFIED | profile directories on the host: personal-trainer, pokemon-scout, portable-outreach, portable-scout, platform-dev |
| Sub-agent spawning: workers launch as bounded profile sessions from repo dispatchers | VERIFIED | `agents/*/scripts/*.sh` |
| In-process delegation with a depth limit | VERIFIED | runtime delegate tool |
| Eight agent definitions in the repo, each with a manifest | VERIFIED | `agents/*/AGENTS.md` |
| Cron-scheduled skills (morning brief, weekly triage, nightly maintenance, sourcing scans, auth watchdog) | VERIFIED | runtime cron inventory: 16 jobs, 11 enabled |
| Run reporting: one local CLI writes SQLite, scheduler broadcasts, dashboard renders | VERIFIED | `scripts/agent-event.ts`, `lib/agents.ts`, `db/migrations/0006..0008`, `components/panels/AgentRunsPanel.tsx`; 215 run rows |
| Agent registry with 8 slugs and live run history | VERIFIED | SQLite `agent_registry`, `agent_runs` |
| Telegram control plane owned by the gateway, health surfaced in the dashboard | VERIFIED | gateway process, `lib/sources/telegram/index.ts` |
| Claude Code integration as a reporting worker identity | VERIFIED | `AGENTS.md`, `CLAUDE.md`, `agents/rathworkspace-platform-developer/` |
| Deliverability monitor agent | CLAIMED-UNVERIFIED | Manifest exists, never run |
| A dedicated deal-evaluation skill | ABSENT | Deal evaluation is code (`lib/pokemon-ops/operator.ts`), not a skill |
| Cron-driven machine-vs-dashboard inventory reconciliation | ABSENT | Reconciliation exists inside the app, not as a scheduled job |

## Known state worth reporting honestly

- The weekly field-packet cron wrapper timed out at 120s on its last run while the
  backgrounded worker completed. The wrapper timeout is the bug, not the worker.
- One scraper is code-complete and exercised, but returns zero usable rows from this host
  because the upstream site localizes pricing by server geography and the importer accepts
  one currency. Not a code defect, an environment mismatch.
- The Discord deal watcher is fully built (code, schema, connect flow) and dormant: no
  credentials configured and no schedule invokes it.
- Two Google accounts need re-auth; the connections panel reports this correctly rather
  than hiding it.

## Contradictions found and resolved

1. Old README promised automatic revenue sync from a banking API. No ingestion code exists.
   Code wins; the README now says the integration is not built.
2. Old README documented `/vending` and `/pokemon-crm` as full pages under the dashboard
   group. They are redirect stubs; the business shell owns that content and was entirely
   undocumented.
3. One subsystem read reported the alert path as fully dormant. The direct-send path is
   dormant, but a daily cron does run the alert evaluation in dry-run mode and folds the
   result into the morning brief.
