import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { careerSnapshot, createEndeavor, updateEndeavor, addEndeavorEvent, reviewSuggestion, CareerError } from "@/lib/career";
import { getHub } from "@/server/live";

export const dynamic = "force-dynamic";

function unauthorized() { return NextResponse.json({ error:"unauthorized" }, { status:401 }); }
function respond(result: any) {
  if (result?.snapshot) getHub().broadcast("career", result.snapshot);
  return NextResponse.json(result);
}
function errorResponse(error: unknown) {
  const known = error instanceof CareerError ? error : new CareerError(error instanceof Error ? error.message : "Career update failed", 500);
  return NextResponse.json({ error:known.message }, { status:known.status });
}

export async function GET() {
  if (!(await requireUser())) return unauthorized();
  return NextResponse.json(careerSnapshot());
}

export async function POST(req: Request) {
  if (!(await requireUser())) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "create") return respond(createEndeavor(body.endeavor || body));
    if (body.action === "update") return respond(updateEndeavor(Number(body.id), body.patch));
    if (body.action === "event") return respond(addEndeavorEvent(Number(body.id), body));
    if (body.action === "suggestion") {
      if (body.decision !== "accept" && body.decision !== "dismiss") throw new CareerError("decision must be accept or dismiss");
      return respond(reviewSuggestion(Number(body.id), body.decision));
    }
    throw new CareerError("unknown career action");
  } catch (error) { return errorResponse(error); }
}
