"use client";
import { SternPage, EmptyState } from "@/components/stern/Page";

export default function SternRecruitingPage() {
  return (
    <SternPage title="Club Recruiting," subtitle="Fall 2026" testId="stern-recruiting">
      <EmptyState
        title="No clubs tracked yet"
        hint="Mark clubs you are interested in to see programs, deadlines, checklists, and coffee chats."
        testId="stern-recruiting-empty"
      />
    </SternPage>
  );
}
