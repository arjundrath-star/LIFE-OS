import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { CRM_SOURCE_IDS, listCrmSources, readCrmSource, type CrmSourceId } from "@/lib/business/crm-sheets";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams; const source = q.get("source");
  if (!source) return NextResponse.json({ sources: await listCrmSources() });
  if (!CRM_SOURCE_IDS.includes(source as CrmSourceId)) return NextResponse.json({ error: "unknown source" }, { status: 400 });
  const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 100)); const offset = Math.max(0, Number(q.get("offset")) || 0);
  const query = (q.get("query") || "").slice(0, 200);
  return NextResponse.json(await readCrmSource(source as CrmSourceId, limit, offset, query));
}
