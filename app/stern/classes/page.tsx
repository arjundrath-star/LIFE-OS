"use client";
import { SternPage, EmptyState } from "@/components/stern/Page";

export default function SternClassesPage() {
  return (
    <SternPage title="Classes," subtitle="Fall 2026" testId="stern-classes">
      <EmptyState title="No courses entered yet" hint="Add the four Fall 2026 courses to see the weekly schedule, assignments, and the grade book." testId="stern-classes-empty" />
    </SternPage>
  );
}
