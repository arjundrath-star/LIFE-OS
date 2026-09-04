"use client";
import { SternPage, EmptyState } from "@/components/stern/Page";

export default function SternAutomationPage() {
  return (
    <SternPage title="Automation" testId="stern-automation">
      <EmptyState title="No accounts connected" hint="Connect the Stern Google account to start scanning email and calendar. Suggestions and the audit log appear here." testId="stern-automation-empty" />
    </SternPage>
  );
}
