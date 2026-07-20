import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { sourcingOperations } from "@/lib/pokemon-ops/operator";
export const dynamic = "force-dynamic";
export async function GET(){ if(!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401}); return NextResponse.json(sourcingOperations()); }
