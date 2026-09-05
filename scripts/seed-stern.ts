// Trusted local SQLite-only public catalog import. Never imports personal data.
import { seedClubCatalog } from "@/lib/stern/recruiting";
console.log(JSON.stringify(seedClubCatalog()));
