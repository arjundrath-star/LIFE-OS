// Client-safe Stern tab contracts: every enum from db/migrations/0029_stern.sql as a const
// tuple, the display labels the design brief mandates, and the route table. No server
// imports here (mirrors lib/career-types.ts). Server logic lives in lib/stern/*.ts.

// ---------- routes ----------
export const STERN_ROUTES = [
  { href: "/stern", label: "Overview", key: "overview" },
  { href: "/stern/recruiting", label: "Club Recruiting", key: "recruiting" },
  { href: "/stern/network", label: "Network", key: "network" },
  { href: "/stern/tasks", label: "Tasks", key: "tasks" },
  { href: "/stern/classes", label: "Classes", key: "classes" },
  { href: "/stern/career", label: "Career", key: "career" },
  { href: "/stern/automation", label: "Automation", key: "automation" },
] as const;
export type SternRouteKey = (typeof STERN_ROUTES)[number]["key"];

// ---------- recruiting ----------
export const PROCESS_KINDS = ["club_recruiting", "job_recruiting", "other"] as const;
export const PROCESS_STATUSES = ["active", "archived"] as const;
export const CLUB_CATEGORIES = ["finance", "consulting", "entrepreneurship", "tech", "marketing", "social_impact", "identity", "industry", "accounting", "law"] as const;
export const CLUB_STATUSES = ["considering", "applying", "interviewing", "accepted", "rejected", "declined", "archived"] as const;
export const PROGRAM_TRACKS = ["exploratory", "teams", "other"] as const;
export const PROGRAM_STATUSES = ["not_open", "open", "drafting", "submitted", "interview_invited", "interview_done", "accepted", "rejected", "declined", "withdrawn", "missed"] as const;
export const CHECKLIST_KEYS = ["general_meeting", "coffee_chat_1", "coffee_chat_2", "draft", "submit", "thank_yous", "interview_prep"] as const;
export const CHECKLIST_SOURCES = ["manual", "auto", "seed"] as const;

// ---------- network ----------
export const SPHERES = ["stern", "professional", "personal"] as const;
export const RELATIONSHIP_TYPES = ["friend", "general_connect", "club_connect", "mentor", "professional", "professor"] as const;
export const PERSON_STATUSES = ["met", "need_to_reach_out", "reached_out", "replied", "chatted", "follow_up_owed", "dormant"] as const;
export const HOW_MET = ["club_event", "coffee_chat", "class", "intro", "social", "dorm", "email", "other"] as const;
export const PERSON_SOURCES = ["manual", "seed", "auto_email", "auto_calendar", "imessage", "import"] as const;
export const TOUCHPOINT_KINDS = ["met", "email_sent", "email_received", "coffee_chat", "thank_you_sent", "follow_up_sent", "text", "dm", "call", "calendar", "note"] as const;
export const TOUCHPOINT_SOURCES = ["manual", "gmail", "calendar", "imessage", "seed"] as const;
export const COFFEE_CHAT_STATES = ["to_request", "requested", "reply_received", "scheduled", "done", "thank_you_sent", "no_reply", "declined"] as const;
export const DRAFT_KINDS = ["request", "thank_you", "follow_up", "reply_scheduling", "other"] as const;
export const DRAFT_STATES = ["generated", "copied", "gmail_draft_created", "sent_detected", "discarded"] as const;

// ---------- tasks ----------
export const TASK_DOMAINS = ["academic", "professional", "campus"] as const;
export const TASK_STATUSES = ["open", "done", "dropped"] as const;
export const TASK_SOURCES = ["manual", "auto", "seed", "imessage", "agent"] as const;

// ---------- classes ----------
export const MEETING_KINDS = ["lecture", "recitation", "lab", "office_hours"] as const;
export const ASSIGNMENT_KINDS = ["homework", "quiz", "exam", "project", "reading", "other"] as const;
export const ASSIGNMENT_STATUSES = ["upcoming", "in_progress", "submitted", "graded"] as const;
export const ASSIGNMENT_SOURCES = ["manual", "auto_email", "seed", "imessage"] as const;

// ---------- automation ----------
export const EMAIL_DIRECTIONS = ["inbound", "outbound"] as const;
export const EMAIL_APPLIED_STATES = ["pending", "auto_applied", "suggested", "ignored", "duplicate", "error"] as const;
export const CALENDAR_EVENT_KINDS = ["coffee_chat", "interview", "class", "club_meeting", "other"] as const;
export const EVIDENCE_TYPES = ["gmail", "calendar", "imessage", "web", "manual"] as const;
export const SUGGESTION_STATES = ["pending", "accepted", "dismissed"] as const;
export const AUDIT_ACTIONS = ["create", "update", "delete", "undo"] as const;
export const AUDIT_SOURCES = ["manual", "auto_email", "auto_calendar", "imessage", "suggestion_accept", "seed", "agent", "undo"] as const;
export const AUDIT_ENTITY_TYPES = ["person", "affiliation", "touchpoint", "coffee_chat", "program", "club", "checklist_item", "assignment", "task", "calendar_event", "draft", "course", "suggestion"] as const;
export const REMINDER_RULES = ["deadline_t7", "deadline_t3", "deadline_t1", "deadline_day", "reply_owed", "thank_you_due", "no_reply_3d", "interview_eve", "task_due", "suggestions_pending", "memo"] as const;
export const REMINDER_CHANNELS = ["imessage", "email", "both", "dashboard"] as const;
export const REMINDER_DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped", "snoozed"] as const;

export const CLASSIFIER_CATEGORIES = [
  "coffee_chat_request_sent", "coffee_chat_reply_positive", "coffee_chat_reply_negative",
  "scheduling_proposal", "scheduling_confirmed", "thank_you_sent", "follow_up_sent",
  "club_application_confirmation", "club_interview_invite", "club_result_accepted", "club_result_rejected",
  "icc_newsletter", "club_general_meeting", "club_other",
  "brightspace_assignment", "brightspace_grade", "course_announcement", "exam_reminder",
  "calendar_invite", "other_nyu", "irrelevant",
] as const;

// Autonomy thresholds (PLAN.md): auto-apply at or above AUTO, suggest between SUGGEST and AUTO, ignore below.
export const STERN_THRESHOLDS = { auto: 0.85, suggest: 0.6 } as const;
export const STERN_QUIET_HOURS = { start: "23:00", end: "07:00" } as const;
export const STERN_TIMEZONE = "America/New_York";
export const STERN_SETTINGS_DEFAULTS = {
  memoEmail: "arjundrath@gmail.com",
  imessageTarget: "",
  hermesAlias: "stern",
  hermesAliasFallback: "personal-trainer",
  quietHoursStart: STERN_QUIET_HOURS.start,
  quietHoursEnd: STERN_QUIET_HOURS.end,
  thresholdAuto: STERN_THRESHOLDS.auto,
  thresholdSuggest: STERN_THRESHOLDS.suggest,
  llmModel: "gpt-6-astra",
} as const;

// ---------- types ----------
export type ClubCategory = (typeof CLUB_CATEGORIES)[number];
export type ClubStatus = (typeof CLUB_STATUSES)[number];
export type ProgramTrack = (typeof PROGRAM_TRACKS)[number];
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export type Sphere = (typeof SPHERES)[number];
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export type HowMet = (typeof HOW_MET)[number];
export type PersonSource = (typeof PERSON_SOURCES)[number];
export type TouchpointKind = (typeof TOUCHPOINT_KINDS)[number];
export type TouchpointSource = (typeof TOUCHPOINT_SOURCES)[number];
export type CoffeeChatState = (typeof COFFEE_CHAT_STATES)[number];
export type DraftKind = (typeof DRAFT_KINDS)[number];
export type DraftState = (typeof DRAFT_STATES)[number];
export type TaskDomain = (typeof TASK_DOMAINS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type MeetingKind = (typeof MEETING_KINDS)[number];
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];
export type EmailAppliedState = (typeof EMAIL_APPLIED_STATES)[number];
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type SuggestionState = (typeof SUGGESTION_STATES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditSource = (typeof AUDIT_SOURCES)[number];
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
export type ReminderRule = (typeof REMINDER_RULES)[number];
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number];

// ---------- display labels (exact strings from the design brief) ----------
export const CLUB_STATUS_LABELS: Record<ClubStatus, string> = {
  considering: "Considering", applying: "Applying", interviewing: "Interviewing", accepted: "Accepted", rejected: "Rejected", declined: "Declined", archived: "Archived",
};
export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = {
  not_open: "Not open", open: "Open", drafting: "Drafting", submitted: "Submitted", interview_invited: "Interview invited", interview_done: "Interview done", accepted: "Accepted", rejected: "Rejected", declined: "Declined", withdrawn: "Withdrawn", missed: "Missed",
};
export const PROGRAM_TRACK_LABELS: Record<ProgramTrack, string> = { exploratory: "Exploratory", teams: "Teams", other: "Other" };
export const CLUB_CATEGORY_LABELS: Record<ClubCategory, string> = {
  finance: "Finance", consulting: "Consulting", entrepreneurship: "Entrepreneurship", tech: "Tech", marketing: "Marketing", social_impact: "Social impact", identity: "Identity", industry: "Industry", accounting: "Accounting", law: "Law",
};
export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  general_meeting: "Attend a general meeting", coffee_chat_1: "Coffee chat 1", coffee_chat_2: "Coffee chat 2", draft: "Draft application", submit: "Submit", thank_yous: "Thank-you emails sent", interview_prep: "Interview prep",
};
export const COFFEE_CHAT_LABELS: Record<CoffeeChatState, string> = {
  to_request: "To request", requested: "Requested", reply_received: "Reply received", scheduled: "Scheduled", done: "Done", thank_you_sent: "Thank-you sent", no_reply: "No reply", declined: "Declined",
};
export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  friend: "Friend", general_connect: "General connect", club_connect: "Club connect", mentor: "Mentor", professional: "Professional", professor: "Professor",
};
export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  met: "Met", need_to_reach_out: "Need to reach out", reached_out: "Reached out", replied: "Replied", chatted: "Chatted", follow_up_owed: "Follow-up owed", dormant: "Dormant",
};
export const HOW_MET_LABELS: Record<HowMet, string> = {
  club_event: "Club event", coffee_chat: "Coffee chat", class: "Class", intro: "Intro", social: "Social", dorm: "Dorm", email: "Email", other: "Other",
};
export const SPHERE_LABELS: Record<Sphere, string> = { stern: "Stern", professional: "Professional", personal: "Personal" };
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", done: "Done", dropped: "Dropped" };
export const TASK_DOMAIN_LABELS: Record<TaskDomain, string> = { academic: "Academic", professional: "Professional", campus: "Campus" };
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = { upcoming: "Upcoming", in_progress: "In progress", submitted: "Submitted", graded: "Graded" };
export const ASSIGNMENT_KIND_LABELS: Record<AssignmentKind, string> = { homework: "Homework", quiz: "Quiz", exam: "Exam", project: "Project", reading: "Reading", other: "Other" };
export const MEETING_KIND_LABELS: Record<MeetingKind, string> = { lecture: "Lecture", recitation: "Recitation", lab: "Lab", office_hours: "Office hours" };
export const TOUCHPOINT_KIND_LABELS: Record<TouchpointKind, string> = {
  met: "Met", email_sent: "Email sent", email_received: "Email received", coffee_chat: "Coffee chat", thank_you_sent: "Thank-you sent", follow_up_sent: "Follow-up sent", text: "Text", dm: "DM", call: "Call", calendar: "Calendar", note: "Note",
};
export const DRAFT_KIND_LABELS: Record<DraftKind, string> = { request: "Request", thank_you: "Thank-you", follow_up: "Follow-up", reply_scheduling: "Scheduling reply", other: "Other" };
export const DRAFT_STATE_LABELS: Record<DraftState, string> = { generated: "Generated", copied: "Copied", gmail_draft_created: "Gmail draft created", sent_detected: "Sent", discarded: "Discarded" };
export const CALENDAR_EVENT_KIND_LABELS: Record<CalendarEventKind, string> = { coffee_chat: "Coffee chat", interview: "Interview", class: "Class", club_meeting: "Club meeting", other: "Other" };
export const SUGGESTION_STATE_LABELS: Record<SuggestionState, string> = { pending: "Pending", accepted: "Accepted", dismissed: "Dismissed" };
export const EMAIL_APPLIED_LABELS: Record<EmailAppliedState, string> = { pending: "Pending", auto_applied: "Auto-applied", suggested: "Suggested", ignored: "Ignored", duplicate: "Duplicate", error: "Error" };
export const REMINDER_DELIVERY_LABELS: Record<(typeof REMINDER_DELIVERY_STATUSES)[number], string> = { pending: "Pending", sent: "Sent", failed: "Failed", skipped: "Skipped", snoozed: "Snoozed" };

// Change-source badge vocabulary (brief: Manual, Auto (email), Auto (calendar), Auto (iMessage), Suggested).
export const SOURCE_BADGE_KINDS = ["manual", "auto_email", "auto_calendar", "auto_imessage", "suggested"] as const;
export type SourceBadgeKind = (typeof SOURCE_BADGE_KINDS)[number];
export const SOURCE_BADGE_LABELS: Record<SourceBadgeKind, string> = {
  manual: "Manual", auto_email: "Auto (email)", auto_calendar: "Auto (calendar)", auto_imessage: "Auto (iMessage)", suggested: "Suggested",
};
/** Map any schema source value (audit, person, touchpoint, task, checklist) onto the five badge kinds. */
export function sourceBadgeKind(source: string | null | undefined): SourceBadgeKind {
  switch (source) {
    case "auto_email": case "gmail": return "auto_email";
    case "auto_calendar": case "calendar": return "auto_calendar";
    case "imessage": case "agent": return "auto_imessage";
    case "suggestion_accept": case "suggested": return "suggested";
    case "auto": return "auto_email";
    default: return "manual";
  }
}

// ---------- live snapshot contract (GET /api/stern and the "stern" WebSocket channel) ----------
// WP0 fills the counts and automation block from SQL; later packages fill the per-area
// pieces (empty arrays until then, never fake data).
export type SternSnapshot = {
  updatedAt: string;
  counts: {
    people: number;
    clubsInterested: number;
    coffeeChatsOwed: number;   // to_request chats + reply_received chats where the reply needs Arjun
    replyOwed: number;         // coffee_chats.reply_needs_me = 1
    deadlines14d: number;      // open program deadlines within 14 days (America/New_York)
    tasksDueToday: number;
    tasksOverdue: number;
    followUpsOwed: number;     // people in follow_up_owed
    suggestionsPending: number;
    assignmentsDueSoon: number; // within 7 days
  };
  automation: {
    lastScanAt: string;        // '' until the first Gmail scan
    lastCalendarSyncAt: string;
    accountsScanned: number;
    lastError: string;
    llmMode: string;           // STERN_LLM_MODE or 'live'
  };
  recruiting: { process: Record<string, unknown> | null; clubs: unknown[]; deadlines: unknown[] };
  network: NetworkSnapshot;
  tasks: { dueToday: unknown[]; overdue: unknown[] };
  classes: { nextMeeting: Record<string, unknown> | null; dueSoon: unknown[] };
  needsYou: unknown[];
  autoAppliedToday: unknown[];
  reminders: { lastMemoAt: string };
};

// ---------- status tone (color carries meaning; mirrors the design bundle TONE map) ----------
export type StatusTone = "ok" | "warn" | "error" | "info" | "off" | "accent" | "neutral";
export const STATUS_TONES: Record<string, StatusTone> = {
  // club
  considering: "off", applying: "accent", interviewing: "info", accepted: "ok", rejected: "error", declined: "off", archived: "off",
  // program
  not_open: "off", open: "info", drafting: "accent", submitted: "info", interview_invited: "warn", interview_done: "info", withdrawn: "off", missed: "error",
  // coffee chat
  to_request: "warn", requested: "info", reply_received: "accent", scheduled: "info", done: "ok", thank_you_sent: "ok", no_reply: "warn",
  // person status
  met: "neutral", need_to_reach_out: "warn", reached_out: "info", replied: "accent", chatted: "ok", follow_up_owed: "warn", dormant: "off",
  // task / assignment
  dropped: "off", upcoming: "neutral", in_progress: "accent", graded: "ok",
  // domains and misc
  academic: "neutral", professional: "neutral", campus: "neutral",
  pending: "warn", dismissed: "off", auto_applied: "ok", suggested: "warn", ignored: "off", duplicate: "off", error: "error",
  sent: "ok", failed: "error", skipped: "off", snoozed: "warn",
};

/** Single lookup for any enum value across the Stern vocabularies. */
const ALL_LABELS: Record<string, string> = {
  ...CLUB_STATUS_LABELS, ...PROGRAM_STATUS_LABELS, ...COFFEE_CHAT_LABELS, ...PERSON_STATUS_LABELS, ...RELATIONSHIP_LABELS,
  ...TASK_STATUS_LABELS, ...TASK_DOMAIN_LABELS, ...ASSIGNMENT_STATUS_LABELS, ...ASSIGNMENT_KIND_LABELS, ...SUGGESTION_STATE_LABELS,
  ...EMAIL_APPLIED_LABELS, ...REMINDER_DELIVERY_LABELS, ...CLUB_CATEGORY_LABELS, ...MEETING_KIND_LABELS, ...DRAFT_STATE_LABELS,
  ...CALENDAR_EVENT_KIND_LABELS, ...PROGRAM_TRACK_LABELS,
};
export function statusLabel(value: string | null | undefined): string {
  if (!value) return "";
  return ALL_LABELS[value] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
export function statusTone(value: string | null | undefined): StatusTone {
  return (value && STATUS_TONES[value]) || "neutral";
}

// Network rows shared by API responses and client components.
export type Person = {
  id: number; dedupe_key: string; first_name: string; last_name: string; display_name: string;
  year: string; major: string; org: string; title: string; sphere: Sphere;
  relationship_type: RelationshipType; strength: number; status: PersonStatus; how_met: HowMet | "";
  met_at: string; met_event: string; email: string; email_alt: string; phone: string;
  instagram: string; linkedin: string; hometown: string; dorm: string; last_contact_at: string;
  next_action: string; next_action_at: string; notes: string; source: PersonSource; archived: number;
  created_at: string; updated_at: string;
};
export type Affiliation = { id: number; person_id: number; club_id: number; org: string; role: string; is_eboard: number; relevant_for_recruiting: number; created_at: string; club_name?: string };
export type Touchpoint = { id: number; person_id: number; kind: TouchpointKind; occurred_at: string; source: TouchpointSource; gmail_account: string; gmail_message_id: string; summary: string; detail: string };
export type PersonDetail = Person & {
  affiliations: Affiliation[]; touchpoints: Touchpoint[];
  coffeeChats: { id: number; state: CoffeeChatState; requested_at: string; scheduled_at: string; occurred_at: string; thank_you_sent_at: string; location: string; takeaways: string }[];
  drafts: { id: number; kind: DraftKind; subject: string; body: string; state: DraftState; gmail_account: string; gmail_draft_id: string }[];
};
export type PeopleFilters = { q?: string; relationshipType?: string[]; strengthMin?: number; status?: string[]; clubId?: number; sphere?: string; followUpOwed?: boolean; archived?: boolean; sort?: "name" | "recent" | "strength" | "last_contact"; page?: number };
export type NetworkSnapshot = { counts: { total: number; byRelationshipType: Record<RelationshipType, number>; followUpsOwed: number; needToReachOut: number }; recent: Person[] };
export type NetworkResponse = NetworkSnapshot & { people: (Person & { affiliations: Affiliation[] })[]; total: number; page: number; pageSize: number; clubs: { id: number; name: string; short_name: string }[] };
