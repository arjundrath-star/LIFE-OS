"use client";
import { SternPage, EmptyState } from "@/components/stern/Page";

export default function SternNetworkPage() {
  return (
    <SternPage title="Network" testId="stern-network">
      <EmptyState title="No people yet. Text the Stern bot or use Quick add." hint="People you meet at club events, classes, and coffee chats show up here with their affiliations and status." testId="stern-network-empty" />
    </SternPage>
  );
}
