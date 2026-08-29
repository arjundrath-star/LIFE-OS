import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import {
  createInventoryRound,
  inventoryRoundsSnapshot,
  replaceInventoryRoundLots,
  updateInventoryRound,
  type InventoryRoundInput,
} from "@/lib/pokemon-ops/inventory-rounds";

export const dynamic = "force-dynamic";

function positiveId(value:unknown):number|null {
  const id=typeof value==="number"?value:Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}
function inputFrom(body:any):InventoryRoundInput {
  return {
    name:typeof body.name==="string"?body.name:"",
    starts_on:typeof body.starts_on==="string"?body.starts_on:"",
    ends_on:typeof body.ends_on==="string"?body.ends_on:null,
    notes:typeof body.notes==="string"?body.notes:null,
  };
}
function errorResponse(error:unknown) {
  const message=error instanceof Error?error.message:"write failed";
  const status=/not found/.test(message)?404:/UNIQUE constraint failed/.test(message)?409:400;
  return NextResponse.json({error:message},{status});
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401});
  return NextResponse.json(inventoryRoundsSnapshot());
}

export async function POST(req:Request) {
  if (!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const body=await req.json();
    const id=createInventoryRound(inputFrom(body));
    return NextResponse.json({ok:true,id,...inventoryRoundsSnapshot()},{status:201});
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(req:Request) {
  if (!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const body=await req.json();
    const id=positiveId(body.id);
    if (!id) return NextResponse.json({error:"id required"},{status:400});
    if (body.lot_ids!==undefined) {
      if (!Array.isArray(body.lot_ids)) return NextResponse.json({error:"lot_ids must be an array"},{status:400});
      replaceInventoryRoundLots(id,body.lot_ids.map(Number));
    } else {
      updateInventoryRound(id,inputFrom(body));
    }
    return NextResponse.json({ok:true,...inventoryRoundsSnapshot()});
  } catch (error) { return errorResponse(error); }
}
