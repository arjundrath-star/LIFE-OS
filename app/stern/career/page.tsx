"use client";
import { SternPage } from "@/components/stern/Page";
import { CareerWorkspace } from "@/components/career/CareerWorkspace";

export default function SternCareerPage() {
  return (
    <SternPage title="Career" actions={<span className="stern-note-chip" data-testid="stern-career-note">Dormant until club season ends</span>} testId="stern-career">
      <CareerWorkspace />
    </SternPage>
  );
}
