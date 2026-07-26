// Phase 5 fixture tests: scripts/pokemon-ops-alerts.sh message assembly +
// mark idempotency. Each test seeds its own fresh temp DB (same
// process-boundary-per-DB rule as tests/pokemon-ops-rules.test.ts — db/index.ts
// reads RATHWORKSPACE_DB at module load, so isolation needs a process
// boundary) via tests/pokemon-ops/alerts-fixture-seed.ts, then drives the
// real bash script with --dry-run so nothing is ever sent or marked except in
// the dedicated mark test.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.join(__dirname, "..");
const fixtureDir = path.join(__dirname, "pokemon-ops", "fixtures", "alerts-digest");
const seedScript = path.join(__dirname, "pokemon-ops", "alerts-fixture-seed.ts");
const dataCli = path.join(repoRoot, "scripts", "pokemon-ops-alerts-data.ts");
const alertsSh = path.join(repoRoot, "scripts", "pokemon-ops-alerts.sh");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const tmpDirs: string[] = [];

const AS_OF = "2026-07-17T00:00:00.000Z";

after(() => {
  for (const tmpDir of tmpDirs) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function freshDbPath(label: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pk-alerts-${label}-`));
  tmpDirs.push(tmpDir);
  return path.join(tmpDir, "fixture.db");
}

function seed(dbPath: string): void {
  const res = spawnSync(tsxBin, [seedScript, fixtureDir], {
    cwd: repoRoot,
    env: { ...process.env, RATHWORKSPACE_DB: dbPath },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `seed failed:\n${res.stderr}`);
}

function runAlertsSh(dbPath: string, args: string[]): { stdout: string; status: number | null } {
  const res = spawnSync("bash", [alertsSh, ...args], {
    cwd: repoRoot,
    env: { ...process.env, RATHWORKSPACE_DB: dbPath },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `pokemon-ops-alerts.sh ${args.join(" ")} failed:\n${res.stderr}`);
  return { stdout: res.stdout, status: res.status };
}

function runMark(dbPath: string, kind: string, id: number, at: string): void {
  const res = spawnSync(tsxBin, [dataCli, "mark", "--kind", kind, "--id", String(id), "--at", at], {
    cwd: repoRoot,
    env: { ...process.env, RATHWORKSPACE_DB: dbPath },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `mark failed:\n${res.stderr}`);
}

test("immediate --dry-run matches golden fixture", () => {
  const dbPath = freshDbPath("immediate");
  seed(dbPath);
  const { stdout } = runAlertsSh(dbPath, ["--dry-run", "--as-of", AS_OF]);
  const expected = fs.readFileSync(path.join(fixtureDir, "expected-immediate.txt"), "utf8");
  assert.equal(stdout, expected);
});

test("--digest --dry-run matches golden fixture", () => {
  const dbPath = freshDbPath("digest");
  seed(dbPath);
  const { stdout } = runAlertsSh(dbPath, ["--dry-run", "--digest", "--as-of", AS_OF]);
  const expected = fs.readFileSync(path.join(fixtureDir, "expected-digest.txt"), "utf8");
  assert.equal(stdout, expected);
});

test("mark respects alerted_at: a marked recommendation drops out of the next dry-run", () => {
  const dbPath = freshDbPath("mark");
  seed(dbPath);

  const before = runAlertsSh(dbPath, ["--dry-run", "--as-of", AS_OF]).stdout;
  assert.match(before, /kind=rec id=1 ::/, "recA (id 1) should be pending before mark");

  runMark(dbPath, "rec", 1, AS_OF);

  const after = runAlertsSh(dbPath, ["--dry-run", "--as-of", AS_OF]).stdout;
  assert.doesNotMatch(after, /kind=rec id=1 ::/, "recA (id 1) must not reappear after being marked alerted");
  // The sourcing observation alert is untouched by marking the recommendation.
  assert.match(after, /kind=obs id=2 ::/, "the sourcing alert should still be pending");

  const afterLines = after.trim().length > 0 ? after.trim().split("\n") : [];
  assert.equal(afterLines.length, 1, `expected exactly 1 remaining alert, got:\n${after}`);
});
