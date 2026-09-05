import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { broadcastStern } from "@/lib/stern/snapshot";
import { SternError, toErrorResponse } from "@/lib/stern/errors";
import { recruitingSnapshot, seedClubCatalog, setInterested, updateClub, setClubStatus, archiveClub, archiveProcess, upsertProgram, setProgramStatus, toggleChecklist, upsertPrep } from "@/lib/stern/recruiting";
import { createCoffeeChat, transition, updateCoffeeChat, type ChatTransitionMeta } from "@/lib/stern/coffee";
import { newBatchId } from "@/lib/stern/audit";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(recruitingSnapshot());
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SternError(400, "Expected an object payload");
  return value as Record<string, unknown>;
}
export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = object(await req.json().catch(() => null));
    // Sources, confidence, evidence and batch IDs are never trusted from the browser.
    const audit = { source: "manual", batchId: newBatchId("recruiting") };
    let result: unknown;
    switch (body.action) {
      case "seed_catalog": result = seedClubCatalog(); break;
      case "club.set_interested": result = setInterested(body.clubId as number, body.interested as boolean, audit); break;
      case "club.update": result = updateClub(body.clubId as number, object(body.patch), audit); break;
      case "club.set_status": result = setClubStatus(body.clubId as number, body.status as Parameters<typeof setClubStatus>[1], audit); break;
      case "club.archive": result = archiveClub(body.clubId as number, audit); break;
      case "process.archive": result = archiveProcess(body.processId as number, audit); break;
      case "program.upsert": result = upsertProgram(object(body.program), audit); break;
      case "program.set_status": result = setProgramStatus(body.programId as number, body.status as Parameters<typeof setProgramStatus>[1], audit); break;
      case "checklist.toggle": result = toggleChecklist(body.itemId as number, body.done as boolean, audit); break;
      case "chat.create": result = createCoffeeChat(body.personId as number, body.clubId as number, body.programId as number | undefined, audit); break;
      case "chat.transition": {
        const supplied = body.meta === undefined ? {} : object(body.meta);
        const allowed = ["at", "scheduled_at", "location", "reply_needs_me", "calendar_event_id", "gmail_thread_id"];
        if (Object.keys(supplied).some(key => !allowed.includes(key))) throw new SternError(400, "Unknown chat transition metadata");
        result = transition(body.chatId as number, body.state as Parameters<typeof transition>[1], { ...supplied, ...audit } as ChatTransitionMeta); break;
      }
      case "chat.update": result = updateCoffeeChat(body.chatId as number, object(body.patch), audit); break;
      case "prep.upsert": result = upsertPrep(object(body.prep), audit); break;
      default: throw new SternError(400, "Unknown recruiting action");
    }
    return NextResponse.json({ ok: true, result, batchId: audit.batchId, snapshot: broadcastStern() });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
