import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import {
  agentMemorySearchRateLimit,
  fetchAgentMemorySnapshot,
  searchAgentMemory,
  validateSearchInput,
} from "@/lib/agentmemory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

export async function GET() {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    return NextResponse.json(await fetchAgentMemorySnapshot(), { headers: NO_STORE });
  } catch (error) {
    console.error("[agentmemory] snapshot fetch failed:", (error as Error).message);
    return NextResponse.json(
      { error: "AgentMemory is temporarily unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: "request body is too large" }, { status: 413, headers: NO_STORE });
  }

  const body = await req.json().catch(() => null);
  const validation = validateSearchInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400, headers: NO_STORE });
  }

  const rate = agentMemorySearchRateLimit(user.email);
  const rateHeaders = {
    ...NO_STORE,
    "x-ratelimit-remaining": String(rate.remaining),
    "x-ratelimit-reset": String(Math.ceil(rate.resetAt / 1_000)),
  };
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many searches; try again shortly" },
      { status: 429, headers: { ...rateHeaders, "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000))) } }
    );
  }

  try {
    const { query, limit } = validation.value;
    return NextResponse.json(await searchAgentMemory(query, limit), { headers: rateHeaders });
  } catch (error) {
    console.error("[agentmemory] search failed:", (error as Error).message);
    return NextResponse.json(
      { error: "AgentMemory search is temporarily unavailable" },
      { status: 503, headers: rateHeaders }
    );
  }
}
