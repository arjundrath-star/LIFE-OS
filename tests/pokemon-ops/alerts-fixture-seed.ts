// Seeds a fixture DB for tests/pokemon-ops-alerts.test.ts. Reuses run-fixture's
// loadInputs() for the common sections (machines/products/observations/lots/
// assignments/stock_events/sales/config), then layers on a `recommendations`
// section (this fixture's own extension: direct pk_recommendations seeding
// with an optional pre-set `alerted_at`, used to test that already-alerted
// rows never re-alert). Run as its own tsx process (RATHWORKSPACE_DB set by
// the caller) — same process-boundary-per-DB rule as run-fixture.ts.
//
// Usage: RATHWORKSPACE_DB=/tmp/x.db tsx tests/pokemon-ops/alerts-fixture-seed.ts <fixtureDir>
import fs from "node:fs";
import path from "node:path";
import { loadInputs, mustGet } from "./run-fixture";

async function main() {
  const fixtureDir = process.argv[2];
  if (!fixtureDir) throw new Error("usage: alerts-fixture-seed.ts <fixtureDir>");
  if (!process.env.RATHWORKSPACE_DB) {
    throw new Error("RATHWORKSPACE_DB must point at a fresh temp DB");
  }

  const inputs = JSON.parse(fs.readFileSync(path.join(fixtureDir, "inputs.json"), "utf8"));
  const ops = await import("../../lib/pokemon-ops/db");

  const { machineIds, productIds } = await loadInputs(inputs);

  for (const r of inputs.recommendations ?? []) {
    const id = ops.insertRecommendation({
      rule: r.rule,
      machine_id: r.machine ? mustGet(machineIds, r.machine, "machine") : null,
      slot_number: r.slot_number ?? null,
      severity: r.severity ?? "info",
      payload: {
        ...r.payload,
        // product_id is a real column in the engine's own payloads; resolve it
        // from the fixture's product name if the row references one.
        ...(r.payload?.set_name ? { product_id: mustGet(productIds, r.payload.set_name, "product") } : {}),
      },
    });
    if (r.alerted_at) {
      ops.markRecommendationAlerted(id, r.alerted_at);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
