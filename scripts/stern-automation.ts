import { runSternEmailScan } from "@/lib/stern/gmail-scan";
import { runSternCalendarSync } from "@/lib/stern/calendar-sync";
import { broadcastStern } from "@/lib/stern/snapshot";
async function main() {
  const isCalendar = process.argv[2] === "calendar";
  // Fixture calendar sources are selected by mode; they still reconcile local records.
  // Only an explicit flag requests a calendar preview, which is unsupported and rejects.
  const options = { dryRun: process.argv.includes("--dry-run") || !isCalendar && process.env.STERN_LLM_MODE === "fixture" };
  const result = isCalendar ? await runSternCalendarSync(options) : await runSternEmailScan(options);
  broadcastStern();
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Automation failed"); process.exitCode = 1; });
