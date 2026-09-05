import { redirect } from "next/navigation";
// Career lives inside the Stern tab now (docs/plans/stern/PLAN.md).
export default function CareerRedirect() { redirect("/stern/career"); }
