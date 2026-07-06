# Claude Design / Fable Prompt — Pokemon CRM Prototype

## Repo / product context

Use this GitHub repo exactly:

- GitHub repo: `arjundrath-star/LIFE-OS`
- Remote URL: `https://github.com/arjundrath-star/LIFE-OS.git`
- Branch: `main`
- Target implementation route: `app/(dash)/pokemon-crm/page.tsx`
- Reusable components can live under: `components/pokemon-crm/*`
- Existing style reference page: `app/(dash)/vending/page.tsx`

Do not design a standalone SaaS app. This needs to fit directly inside the existing Rathworkspace dashboard.

## Company / app name and blurb

Name: Rathworkspace

Blurb: Rathworkspace is Arjun Rath’s private operating dashboard for personal systems and business operations. It has a dark cyan control-room style and is used to manage agents, email, calendar, health, vending operations, projects, files, and terminal workflows from one authenticated workspace.

This new page is a Pokemon vending-machine placement CRM inside Rathworkspace. It helps Arjun and a helper manually call and visit local venues to place Pokemon/card vending machines.

## Existing design system in the repo

Do not create a new design system. Use the existing Rathworkspace code design system.

Inspect and follow:

- `tailwind.config.ts`
  - dark cyan control-room theme
  - colors: `base`, `panel`, `panel-2`, `border`, `accent`, `healthy`, `warn`, `error`, `off`, `txt-primary`, `txt-muted`, `txt-faint`
  - radii: `rounded-panel`, `rounded-inner`
  - shadows: `shadow-panel`, `shadow-glow-sm`, `shadow-glow-lg`
- `app/globals.css`
  - dark background
  - subtle grid backdrop
  - cyan focus rings
  - panel hairline
- `components/shell/ProjectPage.tsx`
  - `ProjectPage`, `HeroStat`, `Section`
- `components/ui.tsx`
  - `Button`, `Badge`, `Dialog`, `DialogContent`, `Tabs`
- `components/StatusDot.tsx`
- `app/(dash)/vending/page.tsx`
  - use this as the closest existing page style reference

Visual style: dark, compact, cyan-accented, operator dashboard, not consumer SaaS.

## Reference screenshot

Use the PeopleFinder CRM screenshot I attached in the Claude Design chat as UX inspiration, not a direct clone.

Important patterns to preserve:

1. Dense lead table with rows and small controls.
2. Top search/filter/category chips.
3. Row-level status dropdown.
4. Owner/contact action column.
5. Floating contact popover / phone selector.
6. Contact card with many phone numbers and quick outcome controls.
7. Failed numbers stay visible, crossed out/dimmed.

## Product requirements

This is a purpose-built CRM for Pokemon vending-machine placements.

It is not a generic CRM. It ingests PeopleFinder-style CSVs and helps Arjun/friends manually call and visit local venues.

PeopleFinder exports look like:

- one venue row
- multiple possible owner/operator contacts per venue
- many candidate phone numbers per contact
- emails that may be unmapped, stale, personal, or secondary

The core workflow is tracking:

- which numbers were tried
- which numbers failed
- who answered
- whether owner/manager was reached
- when a lead becomes Active
- what the next call/visit action is

Cold email is secondary. Calls and in-person visits are primary.

## Active vs inactive rule

Represent this clearly:

- Imported leads start as **Not Active**.
- A lead becomes **Active** once a real touchpoint is logged:
  - call
  - voicemail
  - email sent/logged
  - in-person visit
  - follow-up note
- Active does not mean interested. It means activity has started.

## Required screen 1: Main lead table

Use the existing `ProjectPage` style.

Header:

- Title: `Pokemon CRM`
- Subtitle: `Manual call and visit pipeline for Pokemon machine placements.`
- Hero stats:
  - All Leads
  - Active Leads
  - Untested Numbers
  - Follow Ups Due
- Search bar
- Button: `Import CSV`

Filter chips:

- All
- Not Active
- Active
- Call Queue
- Visit Queue
- Has Untested Numbers
- Weekend Route
- 7-10 PM
- 7-9 AM

Category chips:

- Convenience
- 7-Eleven / Franchise C-store
- Gas + Convenience
- Grocery / Specialty Market
- Arcade / Bowling / Family Entertainment
- Toy / Card / Hobby
- Dessert / Bubble Tea / Pizza
- Smoke / Vape / Liquor

Table columns:

- Score
- Venue
- Stage
- Category
- Address
- Business Phone
- Rating
- Reviews
- Web
- Notes
- Owner/Contacts
- Next Action

Each row should show:

- score badge colored by priority
- venue name plus small route cluster
- stage dropdown
- Active / Not Active chip
- category chip
- contact count
- untested phone count
- next action
- quick open button

Stages:

- New
- Call Queue
- Visit Queue
- Contacted
- Interested
- Follow Up
- No
- Placed
- Hold

## Required screen 2: Lead profile drawer / detail panel

When a row is clicked, open a right-side drawer or large dialog that feels like Rathworkspace’s `DialogContent`, but optimized as a lead profile.

Top summary:

- Venue name
- Address
- Category
- Score
- Website
- Venue phone
- Best visit window
- Stage
- Active chip

Sections:

1. Venue notes
2. Contacts
3. Phone selector
4. Emails
5. Touchpoint timeline
6. Next action

## Required screen 3: Phone selector — core UX

This is the most important component.

It should resemble the contact popover in the PeopleFinder screenshot, adapted to Rathworkspace.

For each contact card:

- Contact name
- Title, e.g. Owner, Franchisee, Manager, Needs Review
- Source note
- Confidence chip
- Phone numbers list

Each phone number row:

- Phone number in green if usable/untested
- Status chip
- Compact outcome buttons:
  - No answer
  - Left VM
  - Reached owner
  - Reached manager
  - Wrong person
  - Bad number
  - Do not call
- Bad/wrong numbers appear crossed out or dimmed, but remain visible.
- Current best/next number should be visually obvious.

Emails are below phones and visually secondary.

## Required screen 4: Touchpoint timeline

Timeline items:

- call
- voicemail
- text/manual note
- email sent/logged
- in-person visit
- follow-up

Each item shows:

- actor: Arjun or friend
- timestamp
- outcome
- notes
- next action if any

## Empty/loading state

Design at least one empty state:

- No CSV imported yet.
- CTA: `Import PeopleFinder CSV`.
- Microcopy: `Leads start inactive until you log a call, visit, email, or follow-up.`

## Visual style requirements

- Dark Rathworkspace style.
- Compact rows.
- Monospace micro-labels.
- Colored chips.
- Green usable phones.
- Red/crossed-out failed phones.
- Yellow/orange needs-review.
- Cyan accent only for primary focus/action.
- It should feel like an operator command center for a local placement business.

## Implementation-ready output requirements

Produce an implementation-ready prototype/spec for Claude Code / UltraCode.

Include:

1. Component hierarchy using existing repo components where possible:
   - `ProjectPage`
   - `HeroStat`
   - `Section`
   - `Button`
   - `Badge`
   - `DialogContent`
   - `StatusDot`
2. Tailwind class recommendations using existing theme tokens.
3. Exact page target: `app/(dash)/pokemon-crm/page.tsx`.
4. Suggested reusable subcomponents:
   - `PokemonLeadTable`
   - `LeadProfileDrawer`
   - `ContactPhoneSelector`
   - `TouchpointTimeline`
   - `LeadFilterChips`
5. Mock data shape for one venue with two contacts and multiple phone numbers.
6. Clear note: no automated outreach; log-only workflow.

## If writing code/prototype to GitHub

If you can create a branch/prototype in GitHub:

- Use branch: `design/pokemon-crm-prototype`
- Do not merge to `main`
- Do not replace app shell or navigation structure
- Do not introduce a second design system
- Preferred prototype path: `app/(dash)/pokemon-crm/page.tsx`
- Reusable components: `components/pokemon-crm/*`

Final deliverable: a polished prototype/spec for the Pokemon CRM page and lead profile drawer, clearly tied to Rathworkspace’s existing design system and ready for UltraCode implementation.
