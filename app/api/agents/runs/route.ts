import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { agentsOrchestrationSnapshot } from "@/lib/agents";

export const dynamic = "force-dynamic";

// Read model for named-agent orchestration. Behind the auth gate (middleware + this check).
export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(agentsOrchestrationSnapshot());
}
