import { NextResponse } from "next/server";
import { getStates, ensureSeeded } from "@/lib/connections";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  ensureSeeded();
  return NextResponse.json({ connections: getStates() });
}
