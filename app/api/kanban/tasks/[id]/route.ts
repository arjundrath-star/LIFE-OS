import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { kanbanTaskDetail } from "@/lib/kanban";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const board = req.nextUrl.searchParams.get("board") || undefined;
  const task = kanbanTaskDetail(id, board);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task });
}
