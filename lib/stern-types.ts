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
export const AUDIT_ENTITY_TYPES = ["person", "affiliation", "touchpoint", "coffee_chat", "program", "club", "checklist_item", "assignment", "task", "calendar_event", "draft", "course", "suggestion", "process", "interview_prep", "course_meeting", "grade_category", "email_message", "reminder", "notification_setting"] as const;
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
    scanState: unknown[];
    recentMessages: unknown[];
    suggestions: unknown[];
    drafts: unknown[];
    audit: unknown[];
    reminders: SternReminder[];
    notificationSettings: SternNotificationSettings;
    llmMode: string;           // STERN_LLM_MODE or 'live'
  };
  recruiting: RecruitingSnapshot;
  network: NetworkSnapshot;
  tasks: TasksSnapshot;
  classes: ClassesSnapshot;
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

// WP1 recruiting data shared by first paint and the Stern live channel.
export const CLUB_TRANSITIONS: Record<ClubStatus, readonly ClubStatus[]> = {
  considering: ["applying", "declined"], applying: ["interviewing", "accepted", "rejected", "declined"],
  interviewing: ["accepted", "rejected", "declined"], accepted: ["declined"], rejected: [], declined: [], archived: [],
};
export const PROGRAM_TRANSITIONS: Record<ProgramStatus, readonly ProgramStatus[]> = {
  not_open: ["open"], open: ["drafting", "declined", "withdrawn"], drafting: ["submitted", "declined", "withdrawn"],
  submitted: ["interview_invited", "declined", "withdrawn"], interview_invited: ["interview_done", "declined", "withdrawn"],
  interview_done: ["accepted", "rejected", "declined", "withdrawn"], accepted: ["declined", "withdrawn"], rejected: ["declined", "withdrawn"],
  declined: [], withdrawn: [], missed: ["submitted", "declined", "withdrawn"],
};
export const CHAT_TRANSITIONS: Record<CoffeeChatState, readonly CoffeeChatState[]> = {
  to_request: ["requested"], requested: ["reply_received", "no_reply", "declined"],
  reply_received: ["scheduled", "no_reply", "declined"], scheduled: ["done"], done: ["thank_you_sent"],
  thank_you_sent: [], no_reply: ["requested"], declined: [],
};
export type RecruitingProcess = { id: number; slug: string; name: string; kind: string; season: string; status: "active" | "archived"; notes: string; archived_at: string };
export type RecruitingClub = {
  id: number; process_id: number; name: string; short_name: string; slug: string; category: ClubCategory | "";
  website: string; instagram: string; coffee_chat_form_url: string; email_domains: string;
  priority: number; interested: number; status: ClubStatus; target_chats: number; notes: string;
};
export type RecruitingProgram = {
  id: number; club_id: number; name: string; track: ProgramTrack; status: ProgramStatus;
  app_opens_at: string; app_deadline_at: string; interview_start: string; interview_end: string; decision_at: string;
  application_url: string; requirements: string; dress_code: string; interview_at: string; interview_location: string; notes: string;
};
export type RecruitingChecklistItem = { id: number; club_id: number; program_id: number; key: ChecklistKey; label: string; sort: number; done_at: string; source: string };
export type CoffeeChat = {
  id: number; person_id: number; club_id: number; program_id: number; state: CoffeeChatState;
  requested_at: string; reply_at: string; reply_needs_me: number; scheduled_at: string; location: string;
  calendar_event_id: string; occurred_at: string; thank_you_sent_at: string; last_follow_up_at: string;
  follow_up_count: number; gmail_thread_id: string; prep_notes: string; takeaways: string;
};
export type RecruitingPerson = { id: number; display_name: string; email: string; year: string; title: string; role: string; chat: CoffeeChat | null };
export type InterviewPrep = { id: number; program_id: number; question: string; answer: string; sort: number; updated_at: string };
export type RecruitingActivity = { key: string; id: number; at: string; source: string; summary: string; batch_id: string; undone_at: string; undoSummary?: string };
export type RecruitingDeadline = { id: number; clubId: number; club: string; name: string; deadlineAt: string; days: number; status: ProgramStatus; track: ProgramTrack };
export type RecruitingClubDetail = RecruitingClub & {
  programs: RecruitingProgram[]; checklist: RecruitingChecklistItem[]; checklistDone: number; checklistTotal: number;
  chatsDone: number; chats: CoffeeChat[]; people: RecruitingPerson[]; nextDeadline: RecruitingDeadline | null;
  prep: InterviewPrep[]; timeline: RecruitingActivity[];
};
export type RecruitingWindow = { track: ProgramTrack; applications_open: string; applications_close: string; interviews_start: string; interviews_end: string; decisions: string };
export type RecruitingSnapshot = {
  updatedAt: string; today: string; process: RecruitingProcess | null; clubs: RecruitingClubDetail[]; catalog: RecruitingClub[];
  deadlines: RecruitingDeadline[]; windows: RecruitingWindow[];
  counts: { coffeeChatsOwed: number; deadlines14d: number; archived: number; interested: number; applying: number; interviewing: number };
};

// WP4 task and classroom read models (client-safe).
export type SternTask = {
  id: number; title: string; domain: TaskDomain; course_id: number; club_id: number; program_id: number;
  person_id: number; assignment_id: number; due_at: string; priority: number; status: TaskStatus;
  source: TaskSource; dedupe_key: string; notes: string; completed_at: string; created_at: string; updated_at: string;
  course_code: string; club_name: string; person_name: string;
};
export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
export type TaskFilters = { domain?: TaskDomain[]; status?: TaskStatus | 'all'; due?: TaskBucket; linked?: { type: 'course' | 'club' | 'person' | 'program' | 'assignment'; id: number } };
export type TaskGroup = { key: string; title: string; rows: SternTask[] };
export type TasksSnapshot = {
  updatedAt: string; tasks: SternTask[]; dueToday: SternTask[]; overdue: SternTask[]; doneToday: SternTask[];
  groups: TaskGroup[]; counts: { open: number; dueToday: number; overdue: number; perDomain: Record<TaskDomain, number> };
  links: { type: 'course' | 'club' | 'person'; id: number; label: string }[];
};
export type Course = { id: number; code: string; title: string; section: string; professor: string; professor_email: string; term: string; credits: number; room: string; syllabus_url: string; brightspace_url: string; grading_notes: string; color: string; archived: number; created_at: string; updated_at: string };
export type CourseMeeting = { id: number; course_id: number; weekday: number; start_time: string; end_time: string; room: string; kind: MeetingKind };
export type ScheduledMeeting = CourseMeeting & { code: string; title: string; date: string; start_at: string };
export type GradeCategory = { id: number; course_id: number; name: string; weight_pct: number; sort: number };
export type Assignment = { id: number; course_id: number; title: string; kind: AssignmentKind; due_at: string; status: AssignmentStatus; points_earned: number | null; points_possible: number | null; category_id: number; source: AssignmentSource; dedupe_key: string; gmail_message_id: string; notes: string; created_at: string; updated_at: string };
export type Standing = { percentage: number | null; method: 'weighted' | 'unweighted' | 'none'; gradedWeight: number; earned: number; possible: number; categories: (GradeCategory & { earned: number; possible: number; percentage: number | null })[] };
export type CourseDetailData = Course & { meetings: CourseMeeting[]; assignments: Assignment[]; categories: GradeCategory[]; standing: Standing; nextDue: Assignment | null };
export type ClassesSnapshot = { updatedAt: string; courses: CourseDetailData[]; schedule: ScheduledMeeting[]; nextMeeting: ScheduledMeeting | null; dueSoon: (Assignment & { course_code: string })[]; standings: { courseId: number; standing: Standing }[]; credits: number };

export type EmailClassification = {
  category: ClassifierCategory; confidence: number; direction: "inbound" | "outbound";
  people: { name: string; email: string; role?: string; club_or_org?: string; is_eboard?: boolean | null }[];
  club?: string | null; program_track?: "exploratory" | "teams" | null; course_code?: string | null;
  proposed_times?: string[]; confirmed_time?: string | null; location?: string | null;
  assignment?: { title?: string; kind?: AssignmentKind; due_at?: string | null; points_possible?: number | null } | null;
  deadline_mentions?: { label: string; date: string }[]; requires_reply_from_me: boolean;
  summary: string; evidence_excerpt: string;
};
export type SternEmailMessage = {
  id: number; gmail_account: string; gmail_message_id: string; gmail_thread_id: string;
  direction: "inbound" | "outbound"; from_addr: string; to_addrs: string; subject: string;
  internal_date: number; snippet: string; content_hash: string; classification: string;
  category: string; confidence: number; applied: string; error: string;
};

// WP5 delivery read model. message contains a version-independent JSON envelope; body is display text.
export const STERN_NOTIFICATION_KEYS = ["stern.hermes_alias", "stern.imessage_target", "stern.memo_email", "stern.quiet_hours_start", "stern.quiet_hours_end", "stern.memo_last_date"] as const;
export type SternNotificationSettings = Record<Exclude<(typeof STERN_NOTIFICATION_KEYS)[number], "stern.memo_last_date">, string>;
export type ReminderMessage = { key: string; subject: string; body: string; urgent: boolean; scheduledAt: string; validUntil?: string; fingerprint?: string };
export type SternReminder = { id: number; rule_key: string; entity_type: string; entity_id: number; fire_at: string; channel: ReminderChannel; message: string; delivery_status: (typeof REMINDER_DELIVERY_STATUSES)[number]; sent_at: string; error: string; created_at: string };
export type SternMemo = { date: string; subject: string; imessage: string; email: string };
