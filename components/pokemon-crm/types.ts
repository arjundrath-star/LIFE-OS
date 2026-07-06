// Shared types + display maps for the Pokemon CRM UI. Shapes mirror /api/pokemon-crm.
// Class maps use full literal Tailwind strings so the JIT scanner picks them up.

export type Stage =
  | "new"
  | "call_queue"
  | "visit_queue"
  | "contacted"
  | "interested"
  | "follow_up"
  | "no"
  | "placed"
  | "hold";

export type PhoneStatus =
  | "untested"
  | "good"
  | "no_answer"
  | "left_vm"
  | "reached_owner"
  | "reached_manager"
  | "wrong_person"
  | "bad"
  | "dnc";

export type EmailStatus =
  | "untested"
  | "emailed"
  | "replied"
  | "bounced"
  | "wrong_person"
  | "do_not_email";

export interface LeadRow {
  id: number;
  venue_name: string;
  category: string | null;
  stage: Stage;
  active: 0 | 1;
  address: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  venue_phone: string | null;
  rating: number | null;
  reviews: number | null;
  vending_score: number | null;
  pokemon_fit_score: number | null;
  owner_access_score: number | null;
  route_cluster: string | null;
  best_visit_window: string | null;
  priority: string;
  next_action: string | null;
  next_action_due: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  contact_count: number;
  untested_count: number;
  touchpoint_count: number;
  last_touch_at: string | null;
}

export interface Phone {
  id: number;
  lead_id: number;
  contact_id: number | null;
  phone: string;
  phone_type: string;
  priority_order: number;
  status: PhoneStatus;
  call_count: number;
  last_called_at: string | null;
  last_result: string | null;
  notes: string | null;
}

export interface EmailAddr {
  id: number;
  lead_id: number;
  contact_id: number | null;
  email: string;
  source: string;
  status: EmailStatus;
  last_emailed_at: string | null;
}

export interface Contact {
  id: number;
  lead_id: number;
  name: string;
  title: string | null;
  source_note: string | null;
  confidence: string;
  phones: Phone[];
  emails: EmailAddr[];
}

export interface Touchpoint {
  id: number;
  lead_id: number;
  contact_id: number | null;
  phone_id: number | null;
  email_id: number | null;
  type: "call" | "vm" | "visit" | "note" | "email" | "followup";
  outcome: string;
  occurred_at: string;
  actor: string;
  next_action_at: string | null;
  raw_notes: string | null;
  phone_number: string | null;
  contact_name: string | null;
}

export interface LeadDetail {
  lead: LeadRow & { source: string; raw_json: string | null };
  contacts: Contact[];
  leadPhones: Phone[];
  leadEmails: EmailAddr[];
  touchpoints: Touchpoint[];
}

export interface Snapshot {
  summary: {
    leads: number;
    active_leads: number;
    contacts: number;
    phones: number;
    untested_phones: number;
    emails: number;
    touchpoints: number;
    follow_ups: number;
  };
  leads: LeadRow[];
}

// ---- display maps ----

export const STAGES: { key: Stage; label: string; selectClass: string }[] = [
  { key: "new", label: "New", selectClass: "text-txt-muted" },
  { key: "call_queue", label: "Call Queue", selectClass: "text-accent" },
  { key: "visit_queue", label: "Visit Queue", selectClass: "text-accent" },
  { key: "contacted", label: "Contacted", selectClass: "text-txt-primary" },
  { key: "interested", label: "Interested", selectClass: "text-healthy" },
  { key: "follow_up", label: "Follow Up", selectClass: "text-warn" },
  { key: "no", label: "No", selectClass: "text-error" },
  { key: "placed", label: "Placed", selectClass: "text-healthy" },
  { key: "hold", label: "Hold", selectClass: "text-off" },
];

export const STAGE_CLASS: Record<Stage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.selectClass])
) as Record<Stage, string>;

export type BadgeTone = "muted" | "accent" | "healthy" | "warn" | "error" | "off";

// usable = still dialable (green); dead numbers stay rendered, struck out, never deleted.
export const PHONE_STATUS_META: Record<
  PhoneStatus,
  { label: string; tone: BadgeTone; usable: boolean; dead: boolean }
> = {
  untested: { label: "untested", tone: "healthy", usable: true, dead: false },
  good: { label: "good number", tone: "healthy", usable: true, dead: false },
  no_answer: { label: "no answer", tone: "warn", usable: false, dead: false },
  left_vm: { label: "left VM", tone: "warn", usable: false, dead: false },
  reached_owner: { label: "reached owner", tone: "healthy", usable: false, dead: false },
  reached_manager: { label: "reached mgr", tone: "accent", usable: false, dead: false },
  wrong_person: { label: "wrong person", tone: "off", usable: false, dead: true },
  bad: { label: "bad number", tone: "error", usable: false, dead: true },
  dnc: { label: "do not call", tone: "error", usable: false, dead: true },
};

export const PHONE_OUTCOME_BUTTONS: { key: PhoneStatus; label: string }[] = [
  { key: "no_answer", label: "No answer" },
  { key: "left_vm", label: "Left VM" },
  { key: "reached_owner", label: "Reached owner" },
  { key: "reached_manager", label: "Reached mgr" },
  { key: "wrong_person", label: "Wrong person" },
  { key: "bad", label: "Bad number" },
  { key: "dnc", label: "Do not call" },
];

export const EMAIL_STATUSES: { key: EmailStatus; label: string }[] = [
  { key: "untested", label: "untested" },
  { key: "emailed", label: "emailed" },
  { key: "replied", label: "replied" },
  { key: "bounced", label: "bounced" },
  { key: "wrong_person", label: "wrong person" },
  { key: "do_not_email", label: "do not email" },
];

export const DEAD_EMAIL_STATUSES: EmailStatus[] = ["bounced", "wrong_person", "do_not_email"];

export const TIMELINE_ICON: Record<string, { label: string; tone: BadgeTone }> = {
  call: { label: "CALL", tone: "accent" },
  vm: { label: "VM", tone: "warn" },
  note: { label: "NOTE", tone: "muted" },
  email: { label: "MAIL", tone: "muted" },
  visit: { label: "VISIT", tone: "healthy" },
  followup: { label: "FLW", tone: "warn" },
};

export function scoreTone(score: number | null): BadgeTone {
  if (score == null) return "off";
  return score >= 80 ? "healthy" : score >= 60 ? "accent" : score >= 45 ? "warn" : "off";
}

/** Count of numbers still worth dialing (untested or confirmed-good). */
export function usableCount(phones: Phone[]): number {
  return phones.filter((p) => p.status === "untested" || p.status === "good").length;
}

/** "Jul 5 · 8:12 PM" from an ISO timestamp, in the viewer's timezone. */
export function fmtTs(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Second line under the venue name: route cluster when set, else city/state. */
export function clusterLabel(l: {
  route_cluster: string | null;
  city: string | null;
  state: string | null;
}): string {
  if (l.route_cluster) return l.route_cluster;
  if (l.city) return l.state ? `${l.city} · ${l.state}` : l.city;
  return "—";
}
