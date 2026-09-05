import fs from "node:fs";
import path from "node:path";
import { getDb, kvGet } from "@/db";
import { gmailFetchFull, gmailListSince, calendarCreateEvent, calendarEventsBetween, gmailCreateDraft, type GmailFullMessage } from "@/lib/sources/google";
export const NYU_ACCOUNT = /@(?:[^@]+\.)?nyu\.edu$/i;
export function accountsToScan(): string[] {
  const extra = kvGet<unknown>("stern.extra_accounts");
  const extras = Array.isArray(extra) ? extra.filter((v): v is string => typeof v === "string").map(v => v.toLowerCase()) : [];
  return (getDb().prepare("SELECT email FROM google_accounts WHERE enabled=1 ORDER BY email").all() as { email: string }[]).map(a => a.email.toLowerCase()).filter(email => NYU_ACCOUNT.test(email) || extras.includes(email));
}
export function sternAccount(): string {
  return accountsToScan().find(email => /@stern\.nyu\.edu$/i.test(email)) || "";
}
export type AutomationSource = {
  list: typeof gmailListSince; full: typeof gmailFetchFull;
  calendar: typeof calendarEventsBetween; createEvent: typeof calendarCreateEvent; createDraft: typeof gmailCreateDraft;
};
export type EmailFixture = { id: string; threadId: string; account: string; from: string; to: string; cc: string; subject: string; text: string; labelIds: string[]; date: string };
export function fixtureMessage(f: EmailFixture): GmailFullMessage {
  return { ...f, internalDate: Date.parse(f.date), headers: [{ name: "From", value: f.from }, { name: "To", value: f.to }] };
}
export function automationSource(): AutomationSource {
  if (process.env.STERN_LLM_MODE === "fixture") {
    const fixtures = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/stern/emails.json"), "utf8")) as EmailFixture[];
    return { list: async (email, since) => fixtures.filter(f => f.account === email && Date.parse(f.date) >= since).map(f => f.id),
      full: async (email, id) => { const f = fixtures.find(f => f.account === email && f.id === id); if (!f) throw new Error("Missing fixture"); return fixtureMessage(f); },
      calendar: async () => [], createEvent: async (_, input) => ({ id: `dry-run:${input.id}` }), createDraft: async () => ({ id: "dry-run:draft" }) };
  }
  return { list: gmailListSince, full: gmailFetchFull, calendar: calendarEventsBetween, createEvent: calendarCreateEvent, createDraft: gmailCreateDraft };
}
const g = globalThis as typeof globalThis & { __sternAutomationQueue?: Promise<unknown> };
/** One process-wide writer lane, including manual jobs and scheduled jobs. */
export function automationJob<T>(fn: () => Promise<T>): Promise<T> {
  const next = (g.__sternAutomationQueue || Promise.resolve()).catch(() => {}).then(fn);
  g.__sternAutomationQueue = next.catch(() => {});
  return next;
}
export function dryRunDefault(value?: boolean) { return value ?? process.env.STERN_LLM_MODE !== "live"; }
