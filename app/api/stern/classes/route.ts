import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import * as classes from '@/lib/stern/classes';
import { newBatchId } from '@/lib/stern/audit';
import { broadcastStern } from '@/lib/stern/snapshot';
import { SternError, toErrorResponse } from '@/lib/stern/errors';
import { object } from '@/lib/stern/records';
export const dynamic='force-dynamic';
function failure(e:unknown){const error=toErrorResponse(e);return NextResponse.json({error:error.message},{status:error.status});}
export async function GET(req:Request){
  if(!(await requireUser()))return NextResponse.json({error:'unauthorized'},{status:401});
  try{const p=new URL(req.url).searchParams;return NextResponse.json(p.has('course')?classes.getCourse(Number(p.get('course'))):classes.classesSnapshot());}catch(e){return failure(e);}
}
export async function POST(req:Request){
  if(!(await requireUser()))return NextResponse.json({error:'unauthorized'},{status:401});
  try{const body=object(await req.json().catch(()=>{throw new SternError(400,'Invalid JSON');}));const m={source:'manual',batchId:newBatchId('classes')},id=Number(body.id);let result;
    const {action:_,...flat}=body;
    switch(body.action){
      case 'course.upsert':result=classes.upsertCourse(body.course??flat,m);break;
      case 'course.remove':result=classes.deleteCourse(id,m);break;
      case 'meeting.upsert':result=classes.upsertMeeting(body.meeting??flat,m);break;
      case 'meeting.remove':result=classes.removeMeeting(id,m);break;
      case 'category.upsert':result=classes.upsertCategory(body.category??flat,m);break;
      case 'category.remove':result=classes.removeCategory(id,m);break;
      case 'assignment.create':{const {gmail_message_id:_message,...assignment}=object(body.assignment??flat);result=classes.createAssignment({...assignment,source:'manual'},m);break;}
      case 'assignment.update':result=classes.updateAssignment(id,body.patch,m);break;
      case 'assignment.set_status':result=classes.setAssignmentStatus(id,body.status,m);break;
      case 'assignment.grade':result=classes.gradeAssignment(id,body.points_earned,body.points_possible,m);break;
      case 'assignment.remove':result=classes.deleteAssignment(id,m);break;
      default:throw new SternError(400,'Unknown classes action');
    }
    const snapshot=broadcastStern();return NextResponse.json({result:result??{removed:true},batchId:m.batchId,snapshot:snapshot.classes});
  }catch(e){return failure(e);}
}
