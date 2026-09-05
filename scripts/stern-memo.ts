import { buildMemo, sendMemo } from "@/lib/stern/memo";
import { broadcastStern } from "@/lib/stern/snapshot";
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--dry-run")) throw new Error("Usage: npm run stern:memo -- [--dry-run]");
  if (args.includes("--dry-run")) {
    const memo = buildMemo();
    console.log(`iMessage\n${memo.imessage}\n\nEmail\n${memo.subject}\n${memo.email}`);
    return;
  }
  const result = await sendMemo();
  broadcastStern();
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Memo failed"); process.exitCode = 1; });
