import { redirect } from "next/navigation";
import { LEGACY_BUSINESS_REDIRECTS } from "@/lib/business-workspace";
export default function LegacyPokemonOpsRoute() { redirect(LEGACY_BUSINESS_REDIRECTS["/pokemon-ops"]); }
