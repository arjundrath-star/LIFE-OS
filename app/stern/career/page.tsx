import { CareerWorkspace } from '@/components/career/CareerWorkspace';
import { SternPage, StatusChip } from '@/components/stern/Page';
export default function SternCareerPage(){return <SternPage title="Career" testId="stern-career-view" actions={<StatusChip value="dormant" label="Dormant until club season ends"/>}><CareerWorkspace/></SternPage>;}
