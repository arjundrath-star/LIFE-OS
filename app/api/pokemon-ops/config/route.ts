import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { listConfig, setConfig } from "@/lib/pokemon-ops/db";
import { CONFIG_KEYS } from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ config: listConfig() });
}

export async function PATCH(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    if (body[key] === undefined) continue;
    const raw = String(body[key]);
    if (!/^-?\d+$/.test(raw)) {
      return NextResponse.json({ error: `${key} must be an integer string` }, { status: 400 });
    }
    updates[key] = raw;
  }
  const unknownKeys = Object.keys(body).filter((k) => !(CONFIG_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length) {
    return NextResponse.json({ error: `unknown config key(s): ${unknownKeys.join(", ")}` }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no known config keys in body" }, { status: 400 });
  }

  for (const [k, v] of Object.entries(updates)) setConfig(k, v);
  return NextResponse.json({ ok: true, config: listConfig() });
}
