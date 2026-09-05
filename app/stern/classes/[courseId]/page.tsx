import { CourseDetail } from '@/components/stern/classes/CourseDetail';
export default async function CoursePage({params}:{params:Promise<{courseId:string}>}){const {courseId}=await params;return <CourseDetail courseId={Number(courseId)}/>;}
