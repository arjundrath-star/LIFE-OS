import { redirect } from "next/navigation";
import { LEGACY_BUSINESS_REDIRECTS } from "@/lib/business-workspace";
export default function LegacyVendingRoute() { redirect(LEGACY_BUSINESS_REDIRECTS["/vending"]); }
