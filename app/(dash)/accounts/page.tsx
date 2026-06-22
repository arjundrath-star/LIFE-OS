"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { AccountsPanel } from "@/components/panels/AccountsPanel";
import { useApi } from "@/hooks/useApi";
import { Link2 } from "lucide-react";

export default function AccountsPage() {
  const { data } = useApi<any>("/api/accounts");
  const accounts = data?.accounts ?? [];
  const google = accounts.filter((a: any) => a.kind === "google").length;
  const services = accounts.filter((a: any) => a.kind === "service").length;
  return (
    <ProjectPage
      title="Accounts & Links"
      icon={<Link2 size={18} />}
      subtitle="Every account, integration, and link in the system — catalogued and editable."
      statusLabel={`${accounts.length} catalogued`}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Catalogued" value={accounts.length} tone="accent" sub="accounts + links" />
          <HeroStat label="Google" value={google} tone="primary" sub="mailboxes" />
          <HeroStat label="Services" value={services} tone="primary" sub="integrations" />
        </div>
      }
    >
      <AccountsPanel expanded />
    </ProjectPage>
  );
}
