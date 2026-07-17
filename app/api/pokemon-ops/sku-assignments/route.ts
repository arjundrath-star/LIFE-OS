import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getProduct, listActiveAssignments, listAssignmentHistory, reassignSku } from "@/lib/pokemon-ops/db";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const machineIdParam = url.searchParams.get("machine_id");
  const machineId = machineIdParam ? (asId(machineIdParam) ?? undefined) : undefined;
  const history = url.searchParams.get("history") === "1";
  const rows = history ? listAssignmentHistory(machineId) : listActiveAssignments(machineId);
  return NextResponse.json({ assignments: rows });
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
  const productId = asId(body.product_id);
  if (!machineId) return NextResponse.json({ error: "machine_id required" }, { status: 400 });
  if (!slotNumber) return NextResponse.json({ error: "slot_number required" }, { status: 400 });
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  if (!getProduct(productId)) return NextResponse.json({ error: "product not found" }, { status: 404 });

  const priceCents = Number(body.price_cents);
  const capacity = Number(body.capacity);
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return NextResponse.json({ error: "price_cents must be a positive integer" }, { status: 400 });
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
  }

  try {
    const id = reassignSku({
      machine_id: machineId,
      slot_number: slotNumber,
      product_id: productId,
      price_cents: priceCents,
      capacity,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json({ ok: true, assignments: listActiveAssignments(machineId), id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }
}
