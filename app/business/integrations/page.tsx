import { BusinessPage, SourceStamp } from "@/components/business/Page";
import { ConnectionsPanel } from "@/components/panels/ConnectionsPanel";
import { AccountsPanel } from "@/components/panels/AccountsPanel";
export default function IntegrationsPage() { return <BusinessPage title="Integrations" description="Real connection health and account provenance. Secret values are never displayed." actions={<SourceStamp>connections + accounts APIs</SourceStamp>}><div className="business-grid-2"><ConnectionsPanel expanded /><AccountsPanel expanded /></div></BusinessPage>; }
