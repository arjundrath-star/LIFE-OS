import MachineDetailWorkspace from "@/components/business/MachineDetailWorkspace";
export default async function Page({params}:{params:Promise<{machineId:string}>}){return <MachineDetailWorkspace machineId={(await params).machineId}/>;}
