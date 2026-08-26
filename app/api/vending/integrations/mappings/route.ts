import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import {
  setManualMachineMapping,
  vendingIntegrationsSnapshot,
  VendingIntegrationError,
} from "@/lib/vending-integrations";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "INVALID_JSON", message: "A JSON mapping request is required" }, { status: 400 });
  }
  try {
    setManualMachineMapping({
      provider: body.provider,
      providerMachineExternalId: body.providerMachineExternalId,
      localMachineId: body.localMachineId,
    });
    return NextResponse.json(vendingIntegrationsSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof VendingIntegrationError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "MAPPING_UPDATE_FAILED", message: "Machine mapping could not be updated" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
