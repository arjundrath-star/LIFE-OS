export const CATEGORIES = ["work", "klade", "community"] as const;
export const KINDS = ["application", "engagement"] as const;
export const APPLICATION_STATUSES = ["researching", "drafting", "submitted", "interviewing", "offer", "accepted", "rejected", "withdrawn", "missed_deadline"] as const;
export const ENGAGEMENT_STATUSES = ["active", "paused", "ended"] as const;
export type CareerCategory = typeof CATEGORIES[number];
export type EndeavorKind = typeof KINDS[number];
