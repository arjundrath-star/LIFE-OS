import { NextResponse } from "next/server";
import { getStates, ensureSeeded } from "@/lib/connections";
import { filterConnectionStates } from "@/lib/connections/access";
import { requireConnectionAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const access=await requireConnectionAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  ensureSeeded();
  return NextResponse.json({ connections: filterConnectionStates(getStates(),access) });
}
