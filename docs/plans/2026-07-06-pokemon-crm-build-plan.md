# Pokemon CRM Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a purpose-built Pokemon machine placement CRM inside Rathworkspace that imports lead-export CSVs, keeps all leads in a pool, moves touched leads into Active, and lets the operator and helpers track every candidate owner number/email, call, visit, and outcome.

**Architecture:** Keep this inside `~/rathworkspace` as an auth-gated Next.js module backed by the existing SQLite database and API route pattern. The first useful version is not a generic CRM: it is a lead table + lead profile + contact/phone selector + touchpoint history + CSV importer. Phone numbers are first-class rows because one owner candidate can have many possible numbers.

**Tech Stack:** Rathworkspace Next.js App Router, React client pages, SQLite via `better-sqlite3`, additive SQL migrations, existing `requireUser` auth guard, existing UI primitives, optional Fable 5 / Claude Design for visual spec and UltraCode for implementation.

---

## Product decisions locked from user

- Leads can be **inactive pool** or **active**.
- A lead becomes active the moment an email is sent, a call is logged, an in-person visit is logged, or another real touchpoint happens.
- Cold email is not the core channel. The CRM must optimize for in-person visits and calls.
- Visit windows are constrained; planning views should respect weekends, 7-10 PM, and rare 7-9 AM windows.
- Do not focus on a single chain category. Include all plausible Pokemon machine venue types.
- A second person may help, so every action needs an `actor` field.
- No automated outreach in MVP. Log actions, do not call/text/email automatically.

## Screenshot UX reference: prior lead CRM

Reference image: a screenshot of the prior lead-tracking CRM (kept outside this repo).

Important patterns to preserve:

1. **Dense lead table**
   - Top nav/search/filter row.
   - Category chips: All, Arcade, Bowling Alley, Gas Station / Convenience, Hotel / Motel, etc.
   - Rows show score, venue, status dropdown, category chip, address, venue phone, rating, reviews, web link, notes, owner/contact actions.

2. **Status dropdown per row**
   - Example status: `Not Started`.
   - For Pokemon CRM statuses should include: New, Call Queue, Visit Queue, Contacted, Interested, Follow Up, No, Placed, Hold.
   - Active state should be derived from touchpoints but displayable as a filter/chip.

3. **Owner/contact column**
   - Shows contact count.
   - Quick actions like add contact, research owner, search managers.
   - For our CRM: show untested phone count, verified contact indicator, and next action.

4. **Floating contact popover / phone selector**
   - Card appears over the table for one contact.
   - Header: contact name + title + source note.
   - Phone list: each phone line has quick icons/checks/crosses.
   - Email list: each email line has status controls.
   - Note input at bottom.
   - This is the most important interaction to replicate.

5. **Visual hierarchy**
   - Dark UI, narrow mono labels, small status chips, green phones, colored score badges.
   - It is okay to adapt to Rathworkspace’s existing design language, but keep the compact operator feel.

## Data model

Create migration `db/migrations/0009_pokemon_crm.sql`.

### `pokemon_import_batches`

```sql
CREATE TABLE IF NOT EXISTS pokemon_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_filename TEXT NOT NULL,
  drive_file_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'lead_export_csv',
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  row_count INTEGER NOT NULL DEFAULT 0,
  leads_created INTEGER NOT NULL DEFAULT 0,
  leads_updated INTEGER NOT NULL DEFAULT 0,
  contacts_created INTEGER NOT NULL DEFAULT 0,
  phones_created INTEGER NOT NULL DEFAULT 0,
  emails_created INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT
);
```

### `pokemon_leads`

```sql
CREATE TABLE IF NOT EXISTS pokemon_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT,
  venue_name TEXT NOT NULL,
  category TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  active INTEGER NOT NULL DEFAULT 0,
  address TEXT,
  city TEXT,
  state TEXT,
  website TEXT,
  venue_phone TEXT,
  rating REAL,
  reviews INTEGER,
  vending_score INTEGER,
  pokemon_fit_score INTEGER,
  owner_access_score INTEGER,
  route_cluster TEXT,
  best_visit_window TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'manual',
  source_batch_id INTEGER REFERENCES pokemon_import_batches(id),
  raw_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_leads_active_stage ON pokemon_leads(active, stage);
CREATE INDEX IF NOT EXISTS idx_pokemon_leads_cluster ON pokemon_leads(route_cluster);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_leads_dedupe ON pokemon_leads(venue_name, address);
```

### `pokemon_contacts`

```sql
CREATE TABLE IF NOT EXISTS pokemon_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  relationship_to_venue TEXT,
  source_note TEXT,
  confidence TEXT NOT NULL DEFAULT 'needs_review',
  status TEXT NOT NULL DEFAULT 'untested',
  raw_contact_cell TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_contacts_lead ON pokemon_contacts(lead_id);
```

### `pokemon_phone_numbers`

```sql
CREATE TABLE IF NOT EXISTS pokemon_phone_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  phone_type TEXT NOT NULL DEFAULT 'unknown',
  priority_order INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'untested',
  call_count INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT,
  last_result TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(lead_id, contact_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_pokemon_phone_numbers_status ON pokemon_phone_numbers(status);
CREATE INDEX IF NOT EXISTS idx_pokemon_phone_numbers_lead ON pokemon_phone_numbers(lead_id);
```

### `pokemon_emails`

```sql
CREATE TABLE IF NOT EXISTS pokemon_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'lead_export_unmapped',
  hunter_status TEXT NOT NULL DEFAULT 'unverified',
  status TEXT NOT NULL DEFAULT 'untested',
  last_emailed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(lead_id, email)
);
CREATE INDEX IF NOT EXISTS idx_pokemon_emails_status ON pokemon_emails(status);
```

### `pokemon_touchpoints`

```sql
CREATE TABLE IF NOT EXISTS pokemon_touchpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE SET NULL,
  phone_id INTEGER REFERENCES pokemon_phone_numbers(id) ON DELETE SET NULL,
  email_id INTEGER REFERENCES pokemon_emails(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL DEFAULT 'arjun',
  summary TEXT,
  next_action_at TEXT,
  raw_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_pokemon_touchpoints_lead ON pokemon_touchpoints(lead_id, occurred_at DESC);
```

## API shape

Create `/app/api/pokemon-crm/route.ts` for JSON actions, following `/app/api/vending/route.ts` auth style.

Actions:

- `GET /api/pokemon-crm?view=list&active=0|1&stage=&category=&cluster=&q=`
- `GET /api/pokemon-crm?view=lead&id=123`
- `POST { action: 'update_lead_stage', leadId, stage }`
- `POST { action: 'update_lead_notes', leadId, notes }`
- `POST { action: 'log_phone_call', leadId, contactId, phoneId, outcome, notes, actor }`
- `POST { action: 'update_phone_status', phoneId, status, notes }`
- `POST { action: 'log_visit', leadId, outcome, notes, actor }`
- `POST { action: 'add_contact', leadId, name, title }`
- `POST { action: 'add_phone', leadId, contactId, phone }`

Rule: logging any touchpoint sets `pokemon_leads.active = 1` and updates `updated_at`.

## Importer

Create `scripts/import-pokemon-crm.ts` or `scripts/import-pokemon-crm.mjs`.

Inputs:

```bash
npm run import-pokemon-crm -- /path/to/lead-export.csv
```

Responsibilities:

1. Read UTF-8 BOM CSV.
2. Parse the lead-export columns.
3. Normalize phones.
4. Split decision makers on ` | `.
5. Parse `Name (Title)/ phone / phone`.
6. Insert/update lead by `(venue_name, address)`.
7. Insert contacts, phones, emails with `INSERT OR IGNORE` / upserts.
8. Create import batch summary.
9. Print created/updated counts.

Use the Python prototype parser (kept in the operator's notes vault, outside this repo)
as the parsing reference.

## UI pages

Preferred route: `app/(dash)/pokemon-crm/page.tsx`, plus nav item `Pokemon CRM` or subtab under `Vending`.

### MVP screen 1: lead table

Columns:

- Score
- Venue
- Status
- Category
- Address
- Business phone
- Rating
- Reviews
- Web
- Notes
- Owner/contact
- Next action

Controls:

- Search name/address.
- Category chips.
- Active / Not Active toggle.
- Filters for Has Untested Numbers, Call Queue, Visit Queue, Weekend, 7-10 PM.
- Export/print route later; not MVP-critical.

### MVP screen 2: lead profile drawer/page

Content:

- Venue profile summary.
- Contact cards.
- Phone number selector.
- Emails.
- Touchpoint timeline.
- Notes and next action.

### Phone selector behavior

For each phone number:

- Show phone in green if untested/usable.
- Quick buttons:
  - Call logged / no answer
  - Left voicemail
  - Reached owner
  - Reached manager
  - Wrong person
  - Bad/disconnected
  - Do not call
- Updating status creates a touchpoint when it represents a real call.
- Bad/wrong numbers visually cross out but remain in history.

## Build phases

### Phase 0: design spec

Use Fable 5 / Claude Design to create a high-fidelity dark UI based on the reference screenshot but using Rathworkspace visual language.

Deliverables:

- lead table mock
- lead profile drawer mock
- contact phone selector mock
- mobile-ish compact view if easy

### Phase 1: DB + importer

1. Add migration `0009_pokemon_crm.sql`.
2. Add importer script.
3. Run migration.
4. Import sample CSV.
5. Verify counts: should roughly match prototype sample: 21 leads, 31 contacts, 133 phones, 107 emails.
6. Commit.

### Phase 2: read API

1. Add server helpers in `lib/pokemon-crm.ts`.
2. Add `/api/pokemon-crm` GET list/detail.
3. Test unauthorized returns 401.
4. Test internal helper returns imported sample rows.
5. Commit.

### Phase 3: lead table UI

1. Add nav entry.
2. Add `app/(dash)/pokemon-crm/page.tsx`.
3. Build lead table with filters.
4. Use API data.
5. Build and smoke-test.
6. Commit.

### Phase 4: lead profile and phone selector

1. Add selected-lead drawer/state.
2. Render contacts and phone numbers.
3. Add quick status buttons.
4. POST updates to API.
5. Verify touchpoints and active flag.
6. Commit.

### Phase 5: route/call queues

1. Add saved filters / queue views.
2. Add next-action computation.
3. Add print/export later if useful.
4. Commit.

### Phase 6: friend mode later

Do not build full RBAC first. Before friend access, decide whether Rathworkspace auth can safely allow one friend into only this module.

## Verification commands

From `~/rathworkspace`:

```bash
git status --short
npm run migrate
npm run import-pokemon-crm -- /path/to/sample-lead-export.csv
npx tsx -e "import { pokemonCrmSnapshot } from './lib/pokemon-crm'; console.log(pokemonCrmSnapshot().summary)"
npm run build
```

If deployed:

```bash
sudo systemctl restart rathworkspace.service
systemctl status rathworkspace.service --no-pager -l
curl -I https://rathworkspace.cloud/pokemon-crm
```

Also verify unauthenticated API access returns 401.

## Out of scope for MVP

- Automated texting/calling.
- Automated cold email sending.
- Full maps integration.
- Complex permissions.
- Generic CRM fields unrelated to Pokemon placement.
- Deleting failed numbers; statuses should preserve history.

## Design prompt for Fable 5 / Claude Design

Build a dark, compact Pokemon machine placement CRM UI inside Rathworkspace. Use the attached reference CRM screenshot as UX inspiration, not a direct clone. The product is for managing Pokemon vending machine placement leads. It needs a dense table of venues and a click-in profile/drawer for each venue.

Core layout:
- Header: Pokemon CRM, counts for All Leads and Active Leads.
- Search bar and category chips.
- Toggle chips: All, Not Active, Active, Call Queue, Visit Queue, Has Untested Numbers, Weekend Route, 7-10 PM.
- Dense lead table columns: Score, Venue, Stage, Category, Address, Business Phone, Rating, Reviews, Web, Notes, Owner/Contacts, Next Action.
- Status dropdown in every row.
- Score badge colored by priority.
- Owner/contact column shows contact count, untested phone count, and action button.

Lead profile/drawer:
- Venue summary: name, address, category, score, website, venue phone, best visit window, stage.
- Contact cards for possible owners/operators.
- Phone selector like the screenshot: contact name/title, source note, list of phone numbers with compact outcome buttons. Buttons: no answer, left voicemail, reached owner, reached manager, wrong person, bad number, do not call.
- Bad/wrong numbers should appear crossed out/disabled but preserved.
- Emails below phones, secondary visual priority.
- Touchpoint timeline with calls, visits, notes, actor, outcome, timestamp.
- Notes box and next action.

Visual style:
- Dark operator dashboard.
- Compact rows, monospace micro labels, colored chips.
- Green phone numbers when usable.
- Red/crossed out bad numbers.
- Yellow/orange for needs review.
- Keep Rathworkspace polish, not a consumer SaaS CRM.

Do not design automated outreach. This is for manual calling and in-person visit tracking.

## UltraCode implementation prompt

You are working in `~/rathworkspace`. Build the Pokemon CRM MVP described in `docs/plans/2026-07-06-pokemon-crm-build-plan.md`. Read `AGENTS.md` and `agents/rathworkspace-platform-developer/AGENTS.md` first. Emit a Rathworkspace platform developer event before editing. Use additive SQLite migrations and preserve auth gates. Do not touch unrelated dirty files.

Implement in phases:
1. DB migration and importer.
2. API read/write endpoints.
3. Lead table UI.
4. Lead detail drawer with phone selector and touchpoint logging.

Use the sample lead-export CSV and the prototype parser (both kept in the operator's notes vault, outside this repo) as references. The importer should produce roughly 21 leads, 31 contacts, 133 phone numbers, and 107 emails from the sample.

Acceptance criteria:
- Sample CSV imports into SQLite.
- Lead table displays imported leads.
- Clicking a lead opens its profile/drawer.
- Phone numbers are individually markable as no answer, left voicemail, reached owner, reached manager, wrong person, bad number, do not call.
- Logging a call or visit creates a touchpoint and marks the lead active.
- Active/inactive filters work.
- Unauthenticated API access returns 401.
- `npm run build` passes.
- If deployed, restart `rathworkspace.service` and verify status.
