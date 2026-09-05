import { redirect } from "next/navigation";
// The School countdown tab was folded into the Stern tab (docs/plans/stern/PLAN.md).
export default function SchoolRedirect() { redirect("/stern"); }
