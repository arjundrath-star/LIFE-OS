import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { automationSnapshot } from "@/lib/stern/automation-snapshot";
import { runSternEmailScan } from "@/lib/stern/gmail-scan";
import { runSternCalendarSync } from "@/lib/stern/calendar-sync";
import { acceptSuggestion, dismissSuggestion } from "@/lib/stern/apply";
import { undoBatch } from "@/lib/stern/audit";
import { regenerateDraft, createGmailDraft, markDraftCopied } from "@/lib/stern/drafts";
import { broadcastStern } from "@/lib/stern/snapshot";
import { automationJob } from "@/lib/stern/automation-source";
import { SternError } from "@/lib/stern/errors";
import { ScopeMissing } from "@/lib/sources/google";
import { id } from "@/lib/stern/recruiting-write";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await automationSnapshot());
}
export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SternError(400, "Expected an action object");
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw new SternError(400, "dryRun must be boolean");
    const options = { dryRun: body.dryRun };
    let result: unknown;
    if (body.action === "scan.now") result = await runSternEmailScan(options);
    else if (body.action === "calendar.sync_now") result = await runSternCalendarSync(options);
    else result = await automationJob(async () => {
      if (body.action === "suggestion.accept") return acceptSuggestion(id(body.id), options);
      if (body.action === "suggestion.dismiss") return dismissSuggestion(id(body.id));
      if (body.action === "batch.undo") {
        if (typeof body.batchId !== "string") throw new SternError(400, "batchId is required");
        return undoBatch(body.batchId);
      }
      if (body.action === "draft.regenerate") return regenerateDraft(id(body.id));
      if (body.action === "draft.create_gmail_draft") return createGmailDraft(id(body.id), options);
      if (body.action === "draft.mark_copied") return markDraftCopied(id(body.id));
      throw new SternError(400, "Unknown automation action");
    });
    const snapshot = broadcastStern();
    return NextResponse.json({ result, snapshot, ...(await automationSnapshot()) });
  } catch (error) {
    const status = error instanceof SternError || error instanceof ScopeMissing ? error.status : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation action failed" }, { status });
  }
}
