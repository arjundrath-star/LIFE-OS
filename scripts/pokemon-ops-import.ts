// CLI: tsx scripts/pokemon-ops-import.ts <kind> <path>
// kind: carddistro | observations | lots | sales
// "observations" is an alias for "carddistro" — Phase 1's import-observations.ts
// only implements the carddistro-format observation drop; a distinct "full
// observation format" importer is out of scope here (see PHASE-2 deviations).
import path from "node:path";
import { getDb } from "@/db";
import { importCarddistroCsv } from "@/lib/pokemon-ops/import-observations";
import { importBulkLotsCsv, importBulkSalesCsv } from "@/lib/pokemon-ops/importers";

const KINDS = ["carddistro", "observations", "lots", "sales"] as const;

function main() {
  const [kind, file] = process.argv.slice(2);
  if (!kind || !file || !(KINDS as readonly string[]).includes(kind)) {
    console.error(`usage: tsx scripts/pokemon-ops-import.ts <${KINDS.join("|")}> <path>`);
    process.exit(1);
  }
  const abs = path.resolve(file);
  getDb(); // ensure migrations applied before any import runs

  let result: unknown;
  switch (kind) {
    case "carddistro":
    case "observations":
      result = importCarddistroCsv(abs);
      break;
    case "lots":
      result = importBulkLotsCsv(abs);
      break;
    case "sales":
      result = importBulkSalesCsv(abs);
      break;
  }
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
