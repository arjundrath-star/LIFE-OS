import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import {
  getProduct,
  getPurchaseLot,
  insertPurchaseLot,
  listPurchaseLotsFiltered,
  updateLotStatus,
} from "@/lib/pokemon-ops/db";
import { LOT_STATUSES, OBSERVATION_SOURCES } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const productId = url.searchParams.get("product_id");
  const rows = listPurchaseLotsFiltered({
    status: url.searchParams.get("status") ?? undefined,
    productId: productId ? (asId(productId) ?? undefined) : undefined,
  });
  return NextResponse.json({ lots: rows });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const productId = asId(body.product_id);
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  if (!getProduct(productId)) return NextResponse.json({ error: "product not found" }, { status: 404 });

  if (typeof body.source !== "string" || !(OBSERVATION_SOURCES as readonly string[]).includes(body.source)) {
    return NextResponse.json({ error: "bad source" }, { status: 400 });
  }
  if (typeof body.purchase_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.purchase_date)) {
    return NextResponse.json({ error: "purchase_date must be YYYY-MM-DD" }, { status: 400 });
  }
  const packCount = Number(body.pack_count);
  const totalCostCents = Number(body.total_cost_cents);
  if (!Number.isInteger(packCount) || packCount <= 0) {
    return NextResponse.json({ error: "pack_count must be a positive integer" }, { status: 400 });
  }
  if (!Number.isInteger(totalCostCents)) {
    return NextResponse.json({ error: "total_cost_cents must be an integer" }, { status: 400 });
  }
  const observationId = body.observation_id != null ? asId(body.observation_id) : null;
  if (body.observation_id != null && !observationId) {
    return NextResponse.json({ error: "bad observation_id" }, { status: 400 });
  }
  if (body.status !== undefined && !(LOT_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }

  try {
    const id = insertPurchaseLot({
      purchase_date: body.purchase_date,
      source: body.source,
      product_id: productId,
      pack_count: packCount,
      total_cost_cents: totalCostCents,
      observation_id: observationId,
      status: body.status,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, lot: getPurchaseLot(id) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = asId(body.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (typeof body.status !== "string") {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }
  try {
    const lot = updateLotStatus(id, body.status);
    return NextResponse.json({ ok: true, lot });
  } catch (e: any) {
    const notFound = /not found/.test(e?.message || "");
    return NextResponse.json({ error: e?.message || "write failed" }, { status: notFound ? 404 : 400 });
  }
}
