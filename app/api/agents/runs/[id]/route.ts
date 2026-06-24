import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { runDetail } from "@/lib/agents";

export const dynamic = "force-dynamic";

// Full timeline + artifacts for one run (older runs not embedded in the live snapshot).
// Gated like every other API route.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const detail = runDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
