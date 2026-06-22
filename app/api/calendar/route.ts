import { NextResponse } from "next/server";
import { todaysEvents } from "@/lib/sources/google";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await todaysEvents());
  } catch {
    return NextResponse.json({ connected: 0, events: [] });
  }
}
