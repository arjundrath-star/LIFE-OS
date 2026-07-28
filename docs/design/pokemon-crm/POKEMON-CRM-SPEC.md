# Pokemon CRM — Implementation Spec (front-end only)

Prototype: `Pokemon CRM.dc.html` in this project (interactive: filters, stage dropdowns, drawer, phone outcome logging, empty state via the `showEmptyState` tweak).

I cannot write to the GitHub repo from here, so this is the paste-into-Claude-Code spec. Suggested branch when implementing: `design/pokemon-crm-prototype`. Do NOT touch the app shell or design system — everything below composes existing Rathworkspace primitives.

---

## 1. Files to create

```
app/(dash)/pokemon-crm/page.tsx            # page: ProjectPage + hero + filters + table + drawer state
components/pokemon-crm/types.ts            # Lead / Contact / Phone / EmailAddr / Touchpoint types + MOCK_LEADS
components/pokemon-crm/LeadFilterChips.tsx # filter tabs + category chips
components/pokemon-crm/PokemonLeadTable.tsx
components/pokemon-crm/LeadDetailPage.tsx      # FULL-SCREEN detail view (replaces table, not a modal)
components/pokemon-crm/ContactPhoneSelector.tsx
components/pokemon-crm/TouchpointTimeline.tsx
```

Also edit `components/shell/nav.tsx`: add after the `vending` item:
```ts
{ key: "pokemon-crm", label: "Pokemon CRM", href: "/pokemon-crm", Icon: CircleDot }, // pokeball-ish lucide icon
```
(Nav order is intentional per the file comment — insert, don't re-sort.)

All data in this step is **mock only** (`// PROTOTYPE MOCK DATA — replace with API`). No DB, no API routes.

---

## 2. Existing primitives to reuse (do not re-invent)

- `ProjectPage`, `HeroStat`, `Section` from `components/shell/ProjectPage`
- `Button`, `Badge`, `Dialog`/`DialogContent` from `components/ui`
- `StatusDot` from `components/StatusDot`
- `EmptyState` from `components/Panel`
- `cn` from `lib/cn`, icons from `lucide-react`
- Tokens from `tailwind.config.ts`: `base panel panel-2 border accent accent-glow txt-primary txt-muted txt-faint healthy warn error off`, radii `rounded-panel rounded-inner`, shadows `shadow-panel shadow-glow-sm shadow-glow-lg`, `.panel-hairline`, `.tabular`, `animate-fade-in`.

Color semantics (locked by the theme):
- **cyan `accent`** = focus/primary action only (active filter, CALL NEXT number, Import CSV, active-lead chip)
- **`healthy` green** = usable/untested phone numbers, reached owner, replied
- **`warn`** = needs review / no answer / left VM / follow-ups due / visit windows
- **`error`** = bad number / do-not-call / No stage / overdue
- **`off` / `txt-faint` + `line-through` + `opacity-55`** = dead numbers and inactive data — visible, never deleted

## 3. Types + mock data shape (`components/pokemon-crm/types.ts`)

```ts
export type Stage = "new" | "call_queue" | "visit_queue" | "contacted"
  | "interested" | "follow_up" | "no" | "placed" | "hold";

export type PhoneStatus = "untested" | "good" | "no_answer" | "left_vm" | "reached_owner"
  | "reached_manager" | "wrong_person" | "bad" | "dnc";
// usable (rendered green, still dialable): untested, good, no_answer, left_vm, reached_owner, reached_manager
// dead (dimmed + line-through, NEVER deleted): wrong_person, bad, dnc
// "good" = manually confirmed via the ✓ button

export type EmailStatus = "untested" | "emailed" | "replied" | "bounced" | "wrong_person" | "do_not_email";

export type TouchpointType = "call" | "vm" | "note" | "email" | "visit" | "followup";

export interface Phone { number: string; status: PhoneStatus; meta: string; }        // meta = "mobile · vendor primary"
export interface EmailAddr { addr: string; status: EmailStatus; }
export interface Contact {
  name: string;
  title: string;                    // "Owner" | "Franchisee" | "Manager" | "Needs Review" | ...
  conf: "high" | "medium" | "review";
  source: string;                   // "Lead vendor · property record + LLC filing match"
  phones: Phone[];
  emails: EmailAddr[];
}
export interface Touchpoint {
  type: TouchpointType; actor: string; ts: string;
  outcome: string; notes?: string; next?: string | null;
}
export interface Lead {
  id: number; score: number; venue: string; cluster: string;   // "RT-01 · weekend route"
  stage: Stage;
  active: boolean;      // DERIVED RULE: false until first touchpoint is logged
  category: string;     // one of the 8 category chips
  address: string; phone: string; rating: number; reviews: number;
  web: string | null; window: "7-10 PM" | "7-9 AM"; tags: ("weekend" | "pm" | "am")[];
  notes: string; next: string; nextDue: string;
  contacts: Contact[]; timeline: Touchpoint[];
}
```

Reference mock lead (one venue, two contacts, multiple numbers — copy the rest from the prototype's `seed()`):

```ts
export const MOCK_LEADS: Lead[] = [{
  id: 1, score: 86, venue: "Maple Street Convenience", cluster: "RT-01 · weekend route",
  stage: "call_queue", active: false, category: "Convenience",
  address: "312 Maple St, Springfield", phone: "(781) 555-0107",
  rating: 4.6, reviews: 214, web: "maplestreetconvenience.example.com", window: "7-10 PM", tags: ["weekend","pm"],
  notes: "Counter space right of register. Kids traffic after 3pm…",
  next: "Call Jordan on best line, ask for 5 min pitch", nextDue: "due Thu · 7-10 PM",
  contacts: [
    { name: "Jordan Avery", title: "Owner", conf: "high",
      source: "Lead vendor · property record + LLC filing match",
      phones: [
        { number: "(781) 555-0142", status: "untested",  meta: "mobile · vendor primary" },
        { number: "(617) 555-8830", status: "no_answer", meta: "mobile · vendor alt" },
        { number: "(781) 555-2291", status: "bad",       meta: "landline · disconnected" },
      ],
      emails: [
        { addr: "j.avery@example.com",  status: "untested" },
        { addr: "maplestreetstore@example.com", status: "emailed"  },
      ]},
    { name: "Casey Bell", title: "Needs Review", conf: "review",
      source: "Lead vendor · same-address hit, possible co-owner",
      phones: [
        { number: "(857) 555-1176", status: "untested",     meta: "mobile · unverified" },
        { number: "(781) 555-0033", status: "wrong_person", meta: "reached a C. Bell (realtor)" },
      ],
      emails: [{ addr: "cbell.realty@example.com", status: "untested" }]},
  ],
  timeline: [
    { type: "call", actor: "operator", ts: "Jul 5 · 8:12 PM", outcome: "Call — no answer",
      notes: "(617) 555-8830, rang out. Try primary next.", next: null },
    { type: "vm",   actor: "operator", ts: "Jul 5 · 8:14 PM", outcome: "Left voicemail",
      notes: "Short pitch VM on store line.", next: "Call Jordan Thu 7-10 PM" },
    { type: "note", actor: "helper",   ts: "Jul 4 · 5:40 PM", outcome: "Drive-by note",
      notes: "Busy at 5:30pm, lots of families.", next: null },
  ],
}];
```

## 4. Component hierarchy

```
PokemonCrmPage ("use client"; state: leads, query, filter, cats[], selectedId)
└─ ProjectPage title="Pokemon CRM" icon={<CircleDot/>}
   subtitle="Manual call and visit pipeline for Pokemon machine placements."
   statusDot={untested>0 ? "healthy" : "off"} statusLabel={`${n} leads · ${a} active`}
   actions={ <SearchInput/> + <Button variant="accent"><Upload/> Import CSV</Button> }
   hero={ 4× HeroStat: All leads (primary) · Active leads (accent) ·
          Untested numbers (healthy) · Follow ups due (warn|muted) }
   ├─ Section (no title, bodyClassName="py-3")
   │  └─ LeadFilterChips {filter, onFilter, cats, onToggleCat, counts}
   ├─ Section title="Leads" right={rowCountLabel}
   │  └─ PokemonLeadTable {leads: filtered, onOpen, onStageChange}
   │     └─ row* (grid, dense) — see §5
   └─ LeadDetailPage {lead, onBack, onMutate}   // FULL-SCREEN: when a lead is selected,
      // the page swaps the header band + filters + table for this view (same URL, local
      // state — or /pokemon-crm/[id] if routing is preferred). NOT a Dialog/overlay.
      ├─ back bar: Button(outline sm) "← back to leads" + mono breadcrumb `leads / {venue}`
      ├─ summary band (panel-hairline header like ProjectPage): venue h1 + score Badge +
      │   active Badge, address, category/cluster/visit-window chips; right side: venue
      │   phone box, website box, stage <select>
      └─ two-column grid `grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4 items-start`
         ├─ LEFT  01 contacts & phone selector  ContactPhoneSelector* (ALL numbers visible)
         └─ RIGHT 02 venue notes <textarea> · 03 next action · 04 TouchpointTimeline
```

Empty state (no CSV yet): replace filters+table with one `Section` →
`EmptyState title="no leads imported" hint="Leads start inactive until you log a call, visit, email, or follow-up." action={<Button variant="accent">Import lead CSV</Button>}`.

## 5. PokemonLeadTable

Dense grid rows (not `<table>` — matches vending page patterns), horizontal scroll wrapper `overflow-x-auto` + `min-w-[1380px]`:

```
grid-cols: 46px minmax(180px,1.5fr) 148px minmax(104px,0.9fr) minmax(150px,1.2fr)
           118px 46px 50px 38px 42px 84px minmax(140px,1fr) 32px
Score | Venue | Stage | Category | Address | Biz phone | Rtg | Revs | Web | Notes | Contacts | Next action | ›
```

- Column header row: `bg-panel-2/40 px-5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-txt-faint`
- Row: `px-5 py-2 border-b border-border/50 cursor-pointer hover:bg-white/[0.03]`, `onClick={() => onOpen(lead.id)}`
- **Score**: `Badge` tone by priority — `score>=80 → healthy`, `>=60 → accent`, `>=45 → warn`, else `off`; `font-bold min-w-[26px] justify-center`
- **Venue**: `text-[13px] font-medium text-txt-primary truncate` + inline active chip (`Badge tone={active?"accent":"off"}` text `active`/`not active`, `text-[8.5px]`) + second line cluster `font-mono text-[9.5px] uppercase tracking-wider text-txt-faint`
- **Stage**: native `<select>` (stopPropagation) `rounded-[6px] border border-border bg-base px-2 py-1 font-mono text-[10.5px] uppercase appearance-none`, text color by stage: new→txt-muted, call/visit_queue→accent, contacted→txt-primary, interested/placed→healthy, follow_up→warn, no→error, hold→off
- **Category**: `Badge tone="muted"` with short label (`Franchise`, `Arcade / FEC`, …)
- **Address** `text-[11.5px] text-txt-faint truncate`; **Biz phone** `font-mono text-[11px] text-txt-muted`
- **Rtg/Revs** `font-mono tabular`; rating ≥4.3 healthy, ≥4.0 muted, else warn
- **Web**: `yes ↗` accent / `—` faint; **Notes**: `1n` / `—`
- **Contacts**: `"2c"` muted + `"3#"` — green+bold when untested>0, faint when 0
- **Next action**: label `text-[11.5px] text-txt-primary truncate` + due line `font-mono text-[9px] uppercase` (overdue→error, due→warn, else faint)
- Trailing `ChevronRight size={14} className="text-txt-faint"`

## 6. LeadFilterChips

Row 1 — mutually exclusive filter tabs (TabsTrigger styling):
`All · Not Active · Active · Call Queue · Visit Queue · Has Untested #s · Weekend Route · 7-10 PM · 7-9 AM`
`font-mono text-[11px] uppercase px-2.5 py-1 rounded-[6px]`, active = `bg-accent/15 text-accent border border-accent/40`, idle = `text-txt-muted`. Each shows its live count in `text-[9.5px]`.

Row 2 — multi-select category chips prefixed by mono micro-label `category`:
Convenience · Franchise C-store · Gas + Convenience · Grocery / Specialty Market · Arcade / Bowling / Family Entertainment · Toy / Card / Hobby · Dessert / Bubble Tea / Pizza · Smoke / Vape / Liquor.
`rounded-full border px-2.5 py-0.5 text-[11px]`; selected = `border-accent/50 bg-accent/10 text-accent`.

Filter predicates: `not_active !active` · `active` · stage equals for queues · `untested` = any phone with status `untested` · `weekend` = tags includes weekend · `7-10 PM` / `7-9 AM` = `lead.window`.

## 7. ContactPhoneSelector (the core component)

Card per contact: `rounded-inner border border-border/80 bg-panel-2/30 p-3`.
Header: name (`text-[13px] font-semibold`) + title `Badge` (`accent`, or `warn` when "Needs Review") + confidence `Badge` (high→healthy, medium→muted, review→warn) + source line `font-mono text-[10px] text-txt-faint`.

PhoneRow (per number):

- Container `rounded-inner border px-2.5 py-2`; **CALL NEXT** row (first usable+untested across all contacts): `border-accent-glow/45 bg-accent/5 shadow-glow-sm` + chip `CALL NEXT` (`text-[8.5px] font-bold text-accent-glow border-accent-glow/50 bg-accent/15 rounded px-1`)
- Number `font-mono text-[13.5px] font-semibold`: usable → `text-healthy`; reached_owner → healthy; reached_manager → txt-primary; dead (`wrong_person|bad|dnc`) → `text-txt-faint line-through` and row `opacity-55`. **Dead rows stay rendered — never delete.**
- Status `Badge`: untested/reached_owner→healthy, no_answer/left_vm→warn, reached_manager→accent, wrong_person→off, bad/dnc→error
- Meta inline `font-mono text-[9px] text-txt-faint`
- **✓ / ✕ quick-mark buttons** right-aligned on every phone row: 24px round icon buttons.
  ✓ = `border-healthy/45 text-healthy hover:bg-healthy/25`, sets status `good` (stays green, counts as usable).
  ✕ = `border-error/45 text-error hover:bg-error/25`, sets status `bad` → number gets `line-through decoration-error` + row dims to `opacity-55`. **Never deletes the number.** Active state fills the button bg (`bg-healthy/20` / `bg-error/20`).
- Outcome buttons row (always visible, wrap): `No answer · Left VM · Reached owner · Reached mgr · Wrong person · Bad number · Do not call` — `rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-txt-faint hover:border-accent/50 hover:text-txt-primary`; current status button shown in accent. Clicking sets the phone status, **prepends a Touchpoint** (type call/vm/note as appropriate) and sets `lead.active = true`.

Emails block (below phones, visually secondary): separated by `border-t border-dashed border-border`, micro-label `emails · secondary channel` (`text-[8.5px] uppercase tracking-[0.18em] text-txt-faint/70`). Each row: address `font-mono text-[11.5px]` (replied→healthy, dead statuses→faint + line-through) + status `<select>` (untested/emailed/replied/bounced/wrong person/do not email). `emailed`/`replied` also log a touchpoint → activates lead.

## 8. TouchpointTimeline

Header row has quick-log ghost buttons `+ visit · + note · + follow-up` (each prepends a touchpoint, activates lead). Items newest-first with a vertical hairline (`absolute left-[26px] w-px bg-border/90`):

- Type chip 40px wide, mono `text-[8.5px] font-bold`: CALL→accent, VM→warn, NOTE/MAIL→muted, VISIT→healthy, FLW→warn
- Line 1: outcome `text-xs font-semibold text-txt-primary` + actor `font-mono text-[9.5px]` (operator→accent, helper→accent-glow) + timestamp faint
- Notes `text-[11.5px] text-txt-muted`
- Optional next-action pill: `border-warn/35 bg-warn/[0.08] text-warn font-mono text-[10px]` → `→ {next}`
- Empty: "no touchpoints yet — lead stays not active until one is logged"

## 9. LeadDetailPage

Full-screen view inside the shell (nav rail + top bar + ticker stay). Selecting a row swaps the list UI for this view; "back to leads" restores it. No overlay, no backdrop, no Dialog. Sections use mono micro-headers `01 · contacts & phone selector` … `04 · touchpoint timeline`; next-action section uses accent-tinted container (`border-accent/30 bg-accent/[0.04]`). Esc / back button returns to the list.

## 10. Behavior rules (front-end state only)

1. Imported leads start `active: false`. Any logged touchpoint (phone outcome, email logged/replied, quick-log visit/note/follow-up) flips `active: true`, permanently.
2. Phone statuses are per-number and independent; dead numbers dim + strike through but persist.
3. "CALL NEXT" = first usable number with status `good` or `untested`, scanning contacts in order.
4. Table default sort: score desc. Search matches venue + address + category.
5. Hero stats derive live from lead state: All / Active / Σ untested phones / count(stage=follow_up or overdue).
6. Import CSV button: prototype-only (in empty state it loads MOCK_LEADS; on the full page it can no-op with a toast/`title="prototype"`).
