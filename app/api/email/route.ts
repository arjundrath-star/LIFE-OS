import { NextResponse } from "next/server";
import { emailSnapshots } from "@/lib/sources/google";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(emailSnapshots());
}
