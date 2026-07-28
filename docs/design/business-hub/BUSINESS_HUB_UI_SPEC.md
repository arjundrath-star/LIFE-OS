# LIFE-OS Business Hub UI specification

## Concept and information architecture

Business is a separate top-level workspace inside LIFE-OS, reached through a deliberate Personal / Business switch. It changes navigation, information hierarchy, and visual tone instead of adding business tabs to the personal control room. The prototype is a professional, desktop-first operating cockpit for one operator across Pokemon Vending, Portable Charging, Subtap, and an All view.

The navigation follows the operator's loop: **Command** scans, **Pipeline** wins placements, **Sites** operates assets, **Inventory** controls physical stock, **Finance** reconciles operating evidence, **Intelligence** finds opportunities, **Automations** supervises delegated work, and **Connections** establishes source trust.

## Design principles

- Dense but calm: flat sections, row rhythm, restrained borders, and limited card rounding.
- Business identity: warm white, graphite, steel, and cobalt; unit colors appear only on semantic tags.
- Decision-ready: surfaces emphasize next action, owner/contact signal, freshness, confidence, and blockers.
- Honest state: sample aggregates are labeled; named rows and financial values are visibly prototype data.
- Evidence before polish: key metrics, tables, and drawers identify source and freshness.
- Progressive detail: cross-business scanning first, drill-down in drawers, specialist screens second.

## Tab jobs

1. **Command**: daily KPI strip, ranked action queue, unit pulse, urgent matches, source posture, and business-unit drill-down.
2. **Pipeline**: unified placement CRM for Pokemon vending and charging; board/table toggle; stage, owner/contact confidence, next action, route density, and business-fit context. Missing ownership is an enrichment state, not a reason to discard a qualified site.
3. **Sites**: machine/station/location status, last visit, next service, expected cadence, route context, uptime, and unit economics.
4. **Inventory**: product and purchase-lot identity, physical storage, online order links, true cost, assignments, and distinct `on_hand`, `assigned`, `in_transit`, `reserved`, and `available` quantities.
5. **Finance**: read-only cash and expense visibility, settlement/payment matching, per-machine economics, bills, close checklist, and links back to tax-ready evidence. It is not a general ledger.
6. **Intelligence**: dated sourcing and retailer observations, price/margin signals, drop calendar with timezone and confidence tier, and freshness/source badges. “Verified empty” differs from “not checked.”
7. **Automations**: only business-relevant Pokemon/charging agents, a live workboard, schedules, run history, explicit approval gates, and blockers. No personal agents appear.
8. **Connections**: Drive, LIFE-OS SQLite, the bank API, accounting, Discord/webhooks, and calendar/email with health, last sync, provenance, scope, and re-auth state.

## Data and provenance rules

Every key decision object carries `source_id`, source display name, source-of-truth status, `observed_at`, `last_checked_at`, timezone, ingestion run, and transformation version. User-entered and inferred values are visually distinguishable. Staleness thresholds are domain-specific and visible. Failures retain the last successful value with a stale badge rather than appearing current.

Inventory changes are immutable movement events; corrections append reversals. Alert ingestion uses a durable event ledger, stable dedupe keys, normalized timestamps, source attribution, freshness, and confidence. Discord is never the database. Store observations represent `in_stock`, `verified_empty`, `not_checked`, and `unknown` separately, with optional evidence.

## Source map

| Domain | Current / proposed source | Authority and UI treatment |
| --- | --- | --- |
| CRM and touchpoints | LIFE-OS SQLite Pokemon CRM | Operational source of truth; sample aggregates: 120 leads, 45 touchpoints |
| Vending and sourcing | LIFE-OS SQLite | Operational source; sample aggregates: 3 machines, 2 purchase lots, 41 sales, 96 observations, 0 recommendations |
| Agents and systems | LIFE-OS SQLite | Run/connection source; sample aggregates: 210 runs, 10 connections, 16 accounts |
| Books and expenses | Vending Books - Live Tracker | Phase 1 accounting source of truth; deep-link evidence rather than copying a ledger |
| Placement leads | Pokemon CRM folder, Pokemon vending lead/active files, Miscellaneous Leads, `MAIN: Charging_Lead_Pipeline.xlsx` | CRM is primary where present; Drive files expose sync state and provenance |
| Hardware | Supplier hardware price schedule 2026 PDF | Reference document with document date and link |
| Cash activity | Bank API, only after authorization | Read-only accounts/transactions and incoming settlement matching; webhook freshness shown |
| Alerts | Durable LIFE-OS event ledger → Discord bot/webhook | Database first, delivery second; no user-token automation |

## Accounting recommendation

Phase 1 should keep the Vending Books - Live Tracker as the accounting source of truth, add bank-API read-only ingestion when credentials are deliberately authorized, and enforce a monthly close checklist with linked evidence. The Business Hub should match settlements and explain machine/site economics, but must not post journal entries or pretend to replace an accounting ledger.

Choose QuickBooks Online or Xero later with accountant input. QuickBooks remains the accountant/tax compatibility leader, while inventory-oriented features sit in higher tiers. Its official list pricing observed July 20, 2026 is $38 / $75 / $115 / $275 per month before promotions. Xero provides reconciliation, reports, and unlimited users; US list prices observed for Early/Growing/Established are $25 / $55 / $90, with projects and expenses concentrated higher. Wave is the low-cost path (Starter free, Pro pricing should be rechecked at decision time) but has less multi-location operations depth. Zoho Books/Inventory has strong multi-location physical stock capabilities but introduces another ecosystem and may exceed current needs. Operations inventory remains in LIFE-OS regardless of ledger selection.

## Discord and intelligence architecture

Use official bot accounts for interactive behavior and incoming webhooks for one-way alert delivery. Never automate a normal Discord user account. Persist normalized source events before delivery, acknowledge webhook retries idempotently, and expose dedupe/freshness status in the UI. Drop calendar records require `confirmed`, `scheduled`, or `watch` confidence, explicit timezone, source URL, observed time, and last-checked time.

## Responsive behavior

At 1440px the interface uses a persistent 228px business rail, four KPI columns, split content panels, and wide tables. Below 900px the rail becomes an off-canvas menu, KPI bands reduce to two columns, and dense boards/tables scroll horizontally. Around 390px KPIs stack, actions wrap, secondary table columns may be hidden, touch targets remain usable, and the prototype label avoids primary controls. Drawers use at most 92% of viewport width.

## Accessibility

The concept uses semantic navigation, headings, tables, buttons, labels, and drawer state; a strong `:focus-visible` ring; text-first status indicators that do not rely on color; sufficient target sizes; and reduced-motion support. Implementation should add focus trapping/restoration for modal drawers, live-region announcements for source refresh, proper sortable-table semantics, tested 4.5:1 body contrast, and keyboard support for board movement. No information is encoded only by business-unit color.

## States

Production implementation must cover loading skeletons, scoped empty states, connection errors with last-known-good timestamps, stale data, partial synchronization, re-auth required, no-match and ambiguous-match finance rows, and explicit approval blockers. The prototype demonstrates honest empty/loading language in its patterns without simulating live connections.

## Implementation boundaries

This packet is design only. It introduces no routes, APIs, schema, migrations, connectors, auth changes, credentials, jobs, or deployment configuration. It reads no live data and uses no external network dependency. A future implementation must preserve current auth gates, permission boundaries, outreach approvals, event history, and existing personal workspace behavior. Bank and Discord states in the prototype do not imply credentials or connections exist.

## Unanswered decisions for approval

- Should Business be a global workspace toggle or a dedicated authenticated route with the toggle as navigation?
- Which screen is the first implementation slice: Command + Connections, or Pipeline + Sites?
- Is Subtap mature enough for a persistent unit filter, or should it remain hidden until it has source data?
- Which source wins when Drive pipeline rows and CRM records disagree, and who resolves conflicts?
- What freshness thresholds should trigger attention for each source class?
- Which accountant should participate in the QuickBooks/Xero decision, and what reports must they receive?

## Research sources

Primary sources reviewed July 20, 2026. Prices can change and must be rechecked before purchase.

- QuickBooks Online product/pricing: https://quickbooks.intuit.com/products/
- Xero US pricing: https://www.xero.com/us/pricing-plans/
- Xero accounting overview: https://www.xero.com/us/
- Wave pricing: https://www.waveapps.com/pricing
- Zoho Inventory multi-warehouse: https://www.zoho.com/us/inventory/multi-warehouse-stock/
- Zoho Inventory pricing comparison: https://www.zoho.com/us/inventory/pricing-comparison/
- Banking provider API and webhook reference documentation (reviewed for the read-only ingestion design)
- Discord bots: https://docs.discord.com/developers/platform/bots
- Discord webhooks: https://docs.discord.com/developers/platform/webhooks
- Discord OAuth2 bot vs. user accounts: https://discord.com/developers/docs/topics/oauth2
