import { NextResponse } from "next/server";
import { emailSnapshots } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(emailSnapshots());
}
