import { NextResponse } from "next/server";
import { getStates, ensureSeeded } from "@/lib/connections";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeeded();
  return NextResponse.json({ connections: getStates() });
}
