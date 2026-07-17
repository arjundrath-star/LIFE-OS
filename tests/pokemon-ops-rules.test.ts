// Phase 3 golden-fixture tests: metrics + rules engine. Each case runs in its
// own child process against its own fresh temp DB (RATHWORKSPACE_DB pattern —
// db/index.ts reads the env var at module load, so per-case isolation needs a
// process boundary, same as the seed-idempotency test). The runner loads
// <case>/inputs.json, executes the case's queries / rules runs at the fixture
// asOf, and writes normalized JSON; we assert EXACT equality against
// <case>/expected.json (every expected value hand-computed in DERIVATION.md).
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.join(__dirname, "..");
const fixturesDir = path.join(__dirname, "pokemon-ops", "fixtures");
const runner = path.join(__dirname, "pokemon-ops", "run-fixture.ts");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

// Scoped to this suite's own golden-fixture contract (expected.json). Other
// fixture directories under fixtures/ (e.g. alerts-digest, Phase 5's
// expected-immediate.txt/expected-digest.txt pair, owned by
// tests/pokemon-ops-alerts.test.ts) are a different shape and are skipped here.
const cases = fs
  .readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(fixturesDir, d.name, "expected.json")))
  .map((d) => d.name)
  .sort();

test("fixture suite is complete", () => {
  const required = [
    "fifo-margin-basic",
    "kpi-margin-slot-day",
    "velocity-and-days-of-supply",
    "refill-sync-trigger",
    "refill-sync-no-trigger",
    "price-raise-trigger",
    "price-raise-no-trigger",
    "dead-stock-trigger",
    "dead-stock-no-trigger",
    "refill-order-full",
    "dedupe-no-reopen",
  ];
  for (const name of required) {
    assert.ok(cases.includes(name), `missing fixture case: ${name}`);
    for (const file of ["inputs.json", "expected.json", "DERIVATION.md"]) {
      assert.ok(
        fs.existsSync(path.join(fixturesDir, name, file)),
        `missing ${name}/${file}`
      );
    }
  }
  assert.ok(fs.existsSync(path.join(fixturesDir, "CONVENTIONS.md")), "missing CONVENTIONS.md");
});

for (const name of cases) {
  test(`golden fixture: ${name}`, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pk-rules-${name}-`));
    const outFile = path.join(tmpDir, "actual.json");
    const res = spawnSync(tsxBin, [runner, path.join(fixturesDir, name), outFile], {
      cwd: repoRoot,
      env: { ...process.env, RATHWORKSPACE_DB: path.join(tmpDir, "fixture.db") },
      encoding: "utf8",
    });
    assert.equal(res.status, 0, `runner failed for ${name}:\n${res.stderr}`);
    const actual = JSON.parse(fs.readFileSync(outFile, "utf8"));
    const expected = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, name, "expected.json"), "utf8")
    );
    assert.deepStrictEqual(actual, expected);
  });
}
