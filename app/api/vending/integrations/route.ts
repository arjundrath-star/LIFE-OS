import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { vendingIntegrationsSnapshot } from "@/lib/vending-integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(vendingIntegrationsSnapshot(), { headers: { "cache-control": "no-store" } });
}
