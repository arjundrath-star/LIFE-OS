// Standing phase gate for pokemon-ops: migrate (apply), migrate again (idempotency),
// unit tests, production build. Fail-fast, binary exit code.
import { spawnSync } from "node:child_process";

function run(label: string, args: string[], capture = false): string {
  console.log(`\n[verify:pokemon-ops] ${label}: npm ${args.join(" ")}`);
  const res = spawnSync("npm", args, {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(`[verify:pokemon-ops] FAIL: ${label} (exit ${res.status ?? "signal"})`);
    process.exit(res.status ?? 1);
  }
  return res.stdout ?? "";
}

run("migrate (apply)", ["run", "migrate"]);

const out = run("migrate (idempotency)", ["run", "migrate"], true);
process.stdout.write(out);
if (!out.includes("up to date") || out.includes("applied migration")) {
  console.error("[verify:pokemon-ops] FAIL: second migrate run was not a no-op");
  process.exit(1);
}

run("tests", ["run", "test:pokemon-ops"]);
run("ingest tests", ["run", "test:pokemon-ops-ingest"]);
run("build", ["run", "build"]);

console.log("\n[verify:pokemon-ops] PASS");
