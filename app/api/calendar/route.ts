import { NextResponse } from "next/server";
import { todaysEvents } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await todaysEvents());
  } catch {
    return NextResponse.json({ connected: 0, events: [] });
  }
}
