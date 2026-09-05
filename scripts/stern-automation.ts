import { runSternEmailScan } from "@/lib/stern/gmail-scan";
import { runSternCalendarSync } from "@/lib/stern/calendar-sync";
import { broadcastStern } from "@/lib/stern/snapshot";
async function main() {
  const options = { dryRun: process.argv.includes("--dry-run") || process.env.STERN_LLM_MODE === "fixture" };
  const result = process.argv[2] === "calendar" ? await runSternCalendarSync(options) : await runSternEmailScan(options);
  broadcastStern();
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Automation failed"); process.exitCode = 1; });
