import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { currentStockForSlot, insertStockEvent, listStockEvents } from "@/lib/pokemon-ops/db";
import { STOCK_EVENT_TYPES } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const machineId = asId(url.searchParams.get("machine_id"));
  const slotNumber = asId(url.searchParams.get("slot_number"));
  if (!machineId || !slotNumber) {
    return NextResponse.json({ error: "machine_id and slot_number required" }, { status: 400 });
  }
  return NextResponse.json({
    events: listStockEvents(machineId, slotNumber),
    current_stock: currentStockForSlot(machineId, slotNumber),
  });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const machineId = asId(body.machine_id);
  const slotNumber = asId(body.slot_number);
  if (!machineId) return NextResponse.json({ error: "machine_id required" }, { status: 400 });
  if (!slotNumber) return NextResponse.json({ error: "slot_number required" }, { status: 400 });
  if (typeof body.event !== "string" || !(STOCK_EVENT_TYPES as readonly string[]).includes(body.event)) {
    return NextResponse.json({ error: "bad event" }, { status: 400 });
  }
  const qtyDelta = Number(body.qty_delta);
  if (!Number.isInteger(qtyDelta)) {
    return NextResponse.json({ error: "qty_delta must be an integer" }, { status: 400 });
  }
  if (body.event === "audit_count" && qtyDelta < 0) {
    return NextResponse.json({ error: "audit_count qty_delta (absolute count) must be >= 0" }, { status: 400 });
  }

  try {
    const id = insertStockEvent({
      machine_id: machineId,
      slot_number: slotNumber,
      event: body.event,
      qty_delta: qtyDelta,
      lot_id: body.lot_id != null ? asId(body.lot_id) : null,
      at: typeof body.at === "string" ? body.at : undefined,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(
      {
        ok: true,
        id,
        current_stock: currentStockForSlot(machineId, slotNumber),
      },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }
}
