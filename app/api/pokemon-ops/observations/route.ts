import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getProduct, insertPriceObservation, listObservationsFiltered } from "@/lib/pokemon-ops/db";
import { OBSERVATION_SOURCES } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const productId = url.searchParams.get("product_id");
  const limit = url.searchParams.get("limit");
  const rows = listObservationsFiltered({
    productId: productId ? (asId(productId) ?? undefined) : undefined,
    source: url.searchParams.get("source") ?? undefined,
    dateFrom: url.searchParams.get("date_from") ?? undefined,
    dateTo: url.searchParams.get("date_to") ?? undefined,
    limit: limit ? Math.max(1, parseInt(limit, 10) || 50) : undefined,
  });
  return NextResponse.json({ observations: rows });
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
  if (typeof body.observed_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.observed_date)) {
    return NextResponse.json({ error: "observed_date must be YYYY-MM-DD" }, { status: 400 });
  }
  const priceCents = Number(body.price_per_pack_cents);
  if (!Number.isInteger(priceCents)) {
    return NextResponse.json({ error: "price_per_pack_cents must be an integer" }, { status: 400 });
  }

  try {
    const res = insertPriceObservation({
      observed_date: body.observed_date,
      source: body.source,
      product_id: productId,
      price_per_pack_cents: priceCents,
      lot_size: body.lot_size != null ? Number(body.lot_size) : null,
      total_cost_cents: body.total_cost_cents != null ? Number(body.total_cost_cents) : null,
      includes_shipping: body.includes_shipping ?? null,
      includes_tax: body.includes_tax ?? null,
      listing_ref: typeof body.listing_ref === "string" ? body.listing_ref : "",
      quantity_available: body.quantity_available != null ? Number(body.quantity_available) : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, ...res }, { status: res.inserted ? 201 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }
}
