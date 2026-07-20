import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { fleetServiceSummary, serviceHistory } from "@/lib/vending-service";
export const dynamic="force-dynamic";
export async function GET(){if(!(await requireUser()))return NextResponse.json({error:"unauthorized"},{status:401});const machines=fleetServiceSummary();return NextResponse.json({machines,history:serviceHistory(),kpis:{total:machines.length,live:machines.filter(m=>m.status==="live"&&m.condition!=="retired").length,needsService:machines.filter(m=>m.condition==="service_required"||m.condition==="out_of_order").length,openIssues:machines.reduce((n,m)=>n+m.open_issues.length,0),verified:machines.filter(m=>m.complete_verified_at).length,partial:machines.filter(m=>m.verified_slot_count>0&&!m.complete_verified_at).length,unknown:machines.filter(m=>m.verified_slot_count===0).length}});}
