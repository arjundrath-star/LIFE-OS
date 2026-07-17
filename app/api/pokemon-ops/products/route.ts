import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getProductBySetName, insertProduct, listProducts, updateProductFields } from "@/lib/pokemon-ops/db";
import { PRODUCT_FORMS, PRODUCT_TIERS, REPRINT_STATUSES } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ products: listProducts() });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (typeof body.set_name !== "string" || !body.set_name.trim()) {
    return NextResponse.json({ error: "set_name required" }, { status: 400 });
  }
  if (typeof body.form !== "string" || !(PRODUCT_FORMS as readonly string[]).includes(body.form)) {
    return NextResponse.json({ error: "bad form" }, { status: 400 });
  }
  if (typeof body.tier !== "string" || !(PRODUCT_TIERS as readonly string[]).includes(body.tier)) {
    return NextResponse.json({ error: "bad tier" }, { status: 400 });
  }
  if (body.reprint_status !== undefined && !(REPRINT_STATUSES as readonly string[]).includes(body.reprint_status)) {
    return NextResponse.json({ error: "bad reprint_status" }, { status: 400 });
  }
  if (getProductBySetName(body.set_name)) {
    return NextResponse.json({ error: `product "${body.set_name}" already exists` }, { status: 409 });
  }

  try {
    const id = insertProduct({
      set_name: body.set_name,
      form: body.form,
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
      release_date: typeof body.release_date === "string" ? body.release_date : null,
      tier: body.tier,
      reprint_status: body.reprint_status,
      active: body.active === 0 ? 0 : 1,
    });
    return NextResponse.json({ ok: true, product: getProductBySetName(body.set_name), id }, { status: 201 });
  } catch (e: any) {
    // Canonical-name unique index race (concurrent create); surface as a clean 409.
    if (/UNIQUE constraint failed/.test(e?.message || "")) {
      return NextResponse.json({ error: `product "${body.set_name}" already exists` }, { status: 409 });
    }
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

  try {
    const product = updateProductFields(id, {
      tier: body.tier,
      reprint_status: body.reprint_status,
      active: body.active,
      display_name: body.display_name,
    });
    return NextResponse.json({ ok: true, product });
  } catch (e: any) {
    const notFound = /not found/.test(e?.message || "");
    return NextResponse.json({ error: e?.message || "write failed" }, { status: notFound ? 404 : 400 });
  }
}
