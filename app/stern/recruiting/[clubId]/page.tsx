import { notFound } from "next/navigation";
import { ClubDetail } from "@/components/stern/recruiting/ClubDetail";
import fs from "node:fs";
import path from "node:path";
export default async function SternClubPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  if (!/^\d+$/.test(clubId) || !Number.isSafeInteger(Number(clubId)) || Number(clubId) < 1) notFound();
  // WP2/WP3 integration is optional: no shared network-domain imports and no blind POST to a missing route.
  const draftsAvailable = fs.existsSync(path.join(process.cwd(), "app/api/stern/network/route.ts"));
  return <ClubDetail clubId={Number(clubId)} draftsAvailable={draftsAvailable}/>;
}
