import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getActiveAssignmentForSlot, insertSale, listSalesFiltered, quickBulkSale } from "@/lib/pokemon-ops/db";
import { SALE_SOURCES } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const machineIdParam = url.searchParams.get("machine_id");
  const limit = url.searchParams.get("limit");
  const rows = listSalesFiltered({
    machineId: machineIdParam ? (asId(machineIdParam) ?? undefined) : undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: limit ? Math.max(1, parseInt(limit, 10) || 50) : undefined,
  });
  return NextResponse.json({ sales: rows });
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

  if (body.action === "quick_bulk") {
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: "qty must be a positive integer" }, { status: 400 });
    }
    if (typeof body.since_ts !== "string") {
      return NextResponse.json({ error: "since_ts required" }, { status: 400 });
    }
    try {
      const result = quickBulkSale({ machine_id: machineId, slot_number: slotNumber, qty, since_ts: body.since_ts });
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
    }
  }

  const assignment = getActiveAssignmentForSlot(machineId, slotNumber);
  if (!assignment) {
    return NextResponse.json({ error: "no active sku assignment for that slot" }, { status: 400 });
  }
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be a positive integer" }, { status: 400 });
  }
  const unitPriceCents =
    body.unit_price_cents != null ? Number(body.unit_price_cents) : assignment.price_cents;
  if (!Number.isInteger(unitPriceCents)) {
    return NextResponse.json({ error: "unit_price_cents must be an integer" }, { status: 400 });
  }
  if (typeof body.sold_at !== "string") {
    return NextResponse.json({ error: "sold_at required" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source : "manual";
  if (!(SALE_SOURCES as readonly string[]).includes(source)) {
    return NextResponse.json({ error: "bad source" }, { status: 400 });
  }

  try {
    const res = insertSale({
      machine_id: machineId,
      slot_number: slotNumber,
      product_id: assignment.product_id,
      qty,
      unit_price_cents: unitPriceCents,
      sold_at: body.sold_at,
      source: source as any,
      external_txn_id: typeof body.external_txn_id === "string" ? body.external_txn_id : "",
    });
    return NextResponse.json({ ok: true, ...res }, { status: res.inserted ? 201 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }
}
