import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import * as tasks from '@/lib/stern/tasks';
import { newBatchId } from '@/lib/stern/audit';
import { broadcastStern } from '@/lib/stern/snapshot';
import { SternError, toErrorResponse } from '@/lib/stern/errors';
import { object } from '@/lib/stern/records';
import type { TaskFilters } from '@/lib/stern-types';
export const dynamic='force-dynamic';
function failure(e:unknown){const error=toErrorResponse(e);return NextResponse.json({error:error.message},{status:error.status});}
export async function GET(req:Request){
  if(!(await requireUser()))return NextResponse.json({error:'unauthorized'},{status:401});
  try {const p=new URL(req.url).searchParams;const filters:TaskFilters={domain:p.getAll('domain').flatMap(v=>v.split(',')) as TaskFilters['domain'],status:(p.get('status')||'open') as TaskFilters['status'],due:(p.get('due')||undefined) as TaskFilters['due']};
    if(p.has('linkedType'))filters.linked={type:p.get('linkedType') as NonNullable<TaskFilters['linked']>['type'],id:Number(p.get('linkedId'))};
    return NextResponse.json({...tasks.tasksSnapshot(),list:tasks.listTasks(filters)});
  }catch(e){return failure(e);}
}
export async function POST(req:Request){
  if(!(await requireUser()))return NextResponse.json({error:'unauthorized'},{status:401});
  try{const body=object(await req.json().catch(()=>{throw new SternError(400,'Invalid JSON');}));const m={source:'manual',batchId:newBatchId('tasks')},id=Number(body.id);let result;
    switch(body.action){
      case 'task.create': {const {action:_,...flat}=body;const {dedupe_key:_key,...task}=object(body.task??flat);result=tasks.createTask({...task,source:'manual'},m);break;}
      case 'task.update':result=tasks.updateTask(id,body.patch,m);break;
      case 'task.complete':result=tasks.complete(id,m);break;
      case 'task.reopen':result=tasks.reopen(id,m);break;
      case 'task.drop':result=tasks.drop(id,m);break;
      default:throw new SternError(400,'Unknown task action');
    }
    const snapshot=broadcastStern();return NextResponse.json({result,batchId:m.batchId,snapshot:snapshot.tasks});
  }catch(e){return failure(e);}
}
