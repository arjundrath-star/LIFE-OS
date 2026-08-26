import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { syncNayax, VendingIntegrationError } from "@/lib/vending-integrations";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncNayax();
    return NextResponse.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof VendingIntegrationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "NAYAX_SYNC_FAILED", message: "Nayax sync failed" }, { status: 502 });
  }
}
