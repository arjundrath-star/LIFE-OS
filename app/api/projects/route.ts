import { NextResponse } from "next/server";
import { listProjects } from "@/lib/sources/vault";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}
