import { Suspense } from "react";
import { SkeletonRows } from "@/components/stern/Page";
import { NetworkTable } from "@/components/stern/network/NetworkTable";
export default function SternNetworkPage() {
  return <Suspense fallback={<SkeletonRows rows={8} />}><NetworkTable /></Suspense>;
}
