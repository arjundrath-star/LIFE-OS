import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const states = await refreshAll();
  getHub().broadcast("connections", states);
  return NextResponse.json({ connections: states });
}
