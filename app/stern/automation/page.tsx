import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/guard';
import { AutomationView } from '@/components/stern/automation/AutomationView';
import { ComponentSheet } from '@/components/stern/automation/ComponentSheet';
export default async function SternAutomationPage({searchParams}:{searchParams:Promise<{components?:string}>}) {
  if (!(await requireUser())) notFound();
  const params=await searchParams;
  if(params.components==='1') {
    if(process.env.NODE_ENV==='production') notFound();
    return <ComponentSheet/>;
  }
  return <AutomationView/>;
}
