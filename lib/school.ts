// School term clock. Single source of truth for the NYU start date so the rail
// countdown, the Home project glance, and the School page all agree.
export const TERM_START_ISO = "2026-09-02T00:00:00";
export const TERM_LABEL = "NYU · Sep 2, 2026";

export function daysUntilTerm(now: number = Date.now()): number {
  const start = new Date(TERM_START_ISO).getTime();
  return Math.max(0, Math.ceil((start - now) / 86400000));
}

export function termStarted(now: number = Date.now()): boolean {
  return new Date(TERM_START_ISO).getTime() <= now;
}
