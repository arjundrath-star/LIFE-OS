"use client";
import { SternPage, EmptyState } from "@/components/stern/Page";

export default function SternTasksPage() {
  return (
    <SternPage title="Tasks" testId="stern-tasks">
      <EmptyState title="No tasks yet" hint="Academic, professional, and campus tasks land here from email, calendar, iMessage, and Quick add." testId="stern-tasks-empty" />
    </SternPage>
  );
}
