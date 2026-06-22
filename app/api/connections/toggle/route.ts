import { NextResponse } from "next/server";
import { setEnabled } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { service, surface, enabled } = await req.json();
  if (!service || !surface) return NextResponse.json({ error: "service+surface required" }, { status: 400 });
  const states = setEnabled(service, surface, !!enabled);
  getHub().broadcast("connections", states);
  return NextResponse.json({ connections: states });
}
