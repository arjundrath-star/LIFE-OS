import MachineServiceWorkspace from "@/components/business/MachineServiceWorkspace";
export default async function Page({params}:{params:Promise<{machineId:string}>}){return <MachineServiceWorkspace machineId={(await params).machineId}/>;}
