import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { kanbanSnapshot } from "@/lib/kanban";

export const dynamic = "force-dynamic";

// Read-only Hermes Kanban snapshot. Writes stay in the real Hermes Kanban CLI/tooling
// so Rathworkspace observes truth instead of becoming a second task system.
export async function GET(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const board = req.nextUrl.searchParams.get("board") || undefined;
  return NextResponse.json(kanbanSnapshot(board));
}
