import { NextResponse } from "next/server";
import { requireHealthUser } from "@/lib/guard";
import { dashboardHealthSnapshot } from "@/lib/health";

export const dynamic="force-dynamic";

export async function GET(){
  if(!(await requireHealthUser()))return NextResponse.json({error:"unauthorized"},{status:401});
  return NextResponse.json(dashboardHealthSnapshot());
}
