import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("pipeline import preserves researched visit windows and CRM-owned follow-up state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-visit-window-"));
  const dbPath = path.join(dir, "test.db");
  const csvPath = path.join(dir, "leads.csv");
  let db: Database.Database | undefined;
  try {
    const header = "Lead ID,Venue,Address,Category,Best visit window,Walk-in ease,Notes\n";
    const rows = [
      "window-researched,Research Market,1 Test St,market,Weekdays 2-4 PM; owner presence unverified,,Initial research",
      "window-fallback,Legacy Market,2 Test St,market,,Easy walk-in,Initial research",
      "window-other,Other Venue,3 Test St,other,,Tuesday afternoon,Initial research",
    ];
    fs.writeFileSync(csvPath, header + rows.join("\n") + "\n");
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-pokemon-pipeline-crm.ts", ...args, csvPath], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, RATHWORKSPACE_DB: dbPath },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    run("--dry-run");
    db = new Database(dbPath);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM pokemon_leads").get() as { n: number }).n, 0);
    run();
    const windows = db.prepare("SELECT external_key, best_visit_window FROM pokemon_leads ORDER BY external_key").all();
    assert.deepEqual(windows, [
      { external_key: "window-fallback", best_visit_window: "weekend or 7-10 PM" },
      { external_key: "window-other", best_visit_window: "Tuesday afternoon" },
      { external_key: "window-researched", best_visit_window: "Weekdays 2-4 PM; owner presence unverified" },
    ]);
    db.prepare("UPDATE pokemon_leads SET best_visit_window='Owner confirmed Friday noon' WHERE external_key='window-researched'").run();
    fs.writeFileSync(csvPath, header + rows.join("\n").replaceAll("Initial research", "Updated source notes") + "\n");
    run();
    assert.equal((db.prepare("SELECT best_visit_window FROM pokemon_leads WHERE external_key='window-researched'").get() as { best_visit_window: string }).best_visit_window, "Owner confirmed Friday noon");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM pokemon_touchpoints").get() as { n: number }).n, 0);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
