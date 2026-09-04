import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { sternSnapshot, broadcastStern } from "@/lib/stern/snapshot";
import { undoBatch } from "@/lib/stern/audit";
import { SternError, toErrorResponse } from "@/lib/stern/errors";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET() {
  if (!(await requireUser())) return unauthorized();
  return NextResponse.json(sternSnapshot());
}

// Action dispatch: { action, ...payload }. WP0 knows only audit.undo; later packages add
// their own routes under /api/stern/<area>. Unknown actions are a 400, never a silent no-op.
export async function POST(req: Request) {
  if (!(await requireUser())) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    if (action === "audit.undo") {
      const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
      if (!batchId) throw new SternError(400, "batchId is required");
      const result = undoBatch(batchId);
      return NextResponse.json({ ok: true, result, snapshot: broadcastStern() });
    }
    throw new SternError(400, "unknown stern action");
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
