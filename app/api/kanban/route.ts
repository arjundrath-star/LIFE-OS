import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { kanbanSnapshot } from "@/lib/kanban";
import { performKanbanAction } from "@/lib/kanban-actions";
import { getHub } from "@/server/live";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const board = req.nextUrl.searchParams.get("board") || undefined;
  const showArchived = req.nextUrl.searchParams.get("archived") === "1";
  return NextResponse.json(kanbanSnapshot({ board, showArchived }));
}

export async function POST(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = performKanbanAction(body);
  if (!result.ok) return NextResponse.json({ error: result.error, output: result.output }, { status: 400 });
  try {
    if (result.snapshot) getHub().broadcast("kanban", result.snapshot);
  } catch {
    // The scheduler will refresh shortly even if no hub is available in this process.
  }
  return NextResponse.json(result);
}
