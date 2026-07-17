// Golden-fixture runner (child process). Usage:
//   RATHWORKSPACE_DB=/tmp/x.db tsx tests/pokemon-ops/run-fixture.ts <fixtureDir> <outFile>
// Loads <fixtureDir>/inputs.json into the fresh temp DB (migrations run on
// first getDb()), executes the case's metric queries and/or rules runs at the
// fixture's asOf, and writes the NORMALIZED result JSON to <outFile> (stdout
// is polluted by "[db] applied migration" lines, hence the file).
//
// Normalization (so expected.json is independent of autoincrement ids):
// numeric id fields are replaced by the human refs/names declared in
// inputs.json — machine_id → machine name, product_id → set_name,
// lot_id → lot ref, sale_id → sale ref, observation_id → observation ref.
// Renamed keys keep their names; only the values change type (number → string).
// Infinity values serialize to null (JSON.stringify semantics).
import fs from "node:fs";
import path from "node:path";

export interface LoadedFixture {
  machineIds: Map<string, number>;
  machineNames: Map<number, string>;
  productIds: Map<string, number>;
  productNames: Map<number, string>;
  obsRefs: Map<number, string>;
  lotRefs: Map<number, string>;
  saleRefs: Map<number, string>;
}

export function mustGet<K, V>(map: Map<K, V>, key: K, label: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`unknown ${label}: ${String(key)}`);
  return v;
}

/**
 * Loads the common inputs.json sections (machines/products/observations/lots/
 * assignments/stock_events/sales/config) into whatever DB `getDb()` currently
 * points at (RATHWORKSPACE_DB must already be set before this runs — same
 * process-boundary-per-DB rule as everywhere else in this test suite).
 * Extracted from run-fixture.ts's main() so other fixture-driven tests (e.g.
 * tests/pokemon-ops-alerts.test.ts) can seed the same base shape without
 * duplicating this loop. Behavior is unchanged from the original inline code.
 */
export async function loadInputs(inputs: any): Promise<LoadedFixture> {
  const ops = await import("../../lib/pokemon-ops/db");

  const machineIds = new Map<string, number>();
  const machineNames = new Map<number, string>();
  for (const m of inputs.machines ?? []) {
    const id = ops.ensureMachine({
      name: m.name,
      location: m.location ?? "Fixtureville",
      status: m.status ?? "live",
      note: m.note ?? "golden fixture",
    });
    machineIds.set(m.name, id);
    machineNames.set(id, m.name);
  }

  const productIds = new Map<string, number>();
  const productNames = new Map<number, string>();
  for (const p of inputs.products ?? []) {
    const id = ops.insertProduct({
      set_name: p.set_name,
      form: p.form ?? "booster",
      tier: p.tier ?? "mid",
    });
    productIds.set(p.set_name, id);
    productNames.set(id, p.set_name);
  }

  const obsRefs = new Map<number, string>();
  for (const o of inputs.observations ?? []) {
    const res = ops.insertPriceObservation({
      observed_date: o.observed_date,
      source: o.source,
      product_id: mustGet(productIds, o.product, "product"),
      price_per_pack_cents: o.price_per_pack_cents,
      listing_ref: o.ref, // unique per fixture row → no dedupe collisions
      notes: o.notes ?? null,
    });
    if (!res.inserted || res.id === null) throw new Error(`observation not inserted: ${o.ref}`);
    obsRefs.set(res.id, o.ref);
  }

  const lotRefs = new Map<number, string>();
  for (const l of inputs.lots ?? []) {
    const id = ops.insertPurchaseLot({
      purchase_date: l.purchase_date,
      source: l.source,
      product_id: mustGet(productIds, l.product, "product"),
      pack_count: l.pack_count,
      total_cost_cents: l.total_cost_cents,
      status: l.status,
      notes: l.notes ?? null,
    });
    lotRefs.set(id, l.ref);
  }

  for (const a of inputs.assignments ?? []) {
    ops.insertSkuAssignment({
      machine_id: mustGet(machineIds, a.machine, "machine"),
      slot_number: a.slot_number,
      product_id: mustGet(productIds, a.product, "product"),
      price_cents: a.price_cents,
      capacity: a.capacity,
      assigned_at: a.assigned_at,
      note: a.note ?? null,
    });
  }

  for (const e of inputs.stock_events ?? []) {
    ops.insertStockEvent({
      machine_id: mustGet(machineIds, e.machine, "machine"),
      slot_number: e.slot_number,
      event: e.event,
      qty_delta: e.qty_delta,
      at: e.at,
      note: e.note ?? null,
    });
  }

  const saleRefs = new Map<number, string>();
  for (const s of inputs.sales ?? []) {
    const res = ops.insertSale({
      machine_id: mustGet(machineIds, s.machine, "machine"),
      slot_number: s.slot_number,
      product_id: mustGet(productIds, s.product, "product"),
      qty: s.qty,
      unit_price_cents: s.unit_price_cents,
      sold_at: s.sold_at,
      source: "manual",
    });
    if (!res.inserted || res.id === null) throw new Error(`sale not inserted: ${s.ref}`);
    saleRefs.set(res.id, s.ref);
  }

  for (const [k, v] of Object.entries(inputs.config ?? {})) {
    ops.setConfig(k, v as string | number);
  }

  return { machineIds, machineNames, productIds, productNames, obsRefs, lotRefs, saleRefs };
}

async function main() {
  const fixtureDir = process.argv[2];
  const outFile = process.argv[3];
  if (!fixtureDir || !outFile) {
    throw new Error("usage: run-fixture.ts <fixtureDir> <outFile>");
  }
  if (!process.env.RATHWORKSPACE_DB) {
    throw new Error("RATHWORKSPACE_DB must point at a fresh temp DB");
  }

  const inputs = JSON.parse(fs.readFileSync(path.join(fixtureDir, "inputs.json"), "utf8"));

  const metrics = await import("../../lib/pokemon-ops/metrics");
  const rules = await import("../../lib/pokemon-ops/rules");
  const db = await import("../../db");

  const { machineIds, machineNames, productIds, productNames, obsRefs, lotRefs, saleRefs } =
    await loadInputs(inputs);

  // ---- normalization ----
  const idMaps: Record<string, Map<number, string>> = {
    machine_id: machineNames,
    product_id: productNames,
    lot_id: lotRefs,
    sale_id: saleRefs,
    observation_id: obsRefs,
  };
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "number" && idMaps[k]) {
          const mapped = idMaps[k].get(v);
          out[k] = mapped !== undefined ? mapped : v;
        } else {
          out[k] = normalize(v);
        }
      }
      return out;
    }
    return value;
  }

  // ---- queries ----
  const asOf: string = inputs.asOf;
  const result: Record<string, unknown> = {};
  const queries: Record<string, unknown> = {};
  for (const q of inputs.queries ?? []) {
    const machineId = q.machine ? mustGet(machineIds, q.machine, "machine") : undefined;
    const productId = q.product ? mustGet(productIds, q.product, "product") : undefined;
    let value: unknown;
    switch (q.fn) {
      case "fifoAllocation":
        value = metrics.fifoAllocation(productId!);
        break;
      case "marginPerSlotDay":
        value = metrics.marginPerSlotDay(machineId!, q.slot, q.windowDays, asOf);
        break;
      case "velocity":
        value = metrics.velocity(machineId!, q.slot, asOf, q.windowDays ?? undefined);
        break;
      case "daysOfSupply":
        value = metrics.daysOfSupply(machineId!, q.slot, asOf, q.windowDays ?? undefined);
        break;
      case "projectedSelloutDate":
        value = metrics.projectedSelloutDate(machineId!, q.slot, asOf, q.windowDays ?? undefined);
        break;
      case "refillSyncSpread":
        value = metrics.refillSyncSpread(machineId!, asOf, q.windowDays ?? undefined);
        break;
      case "totalInvested":
        value = metrics.totalInvested();
        break;
      case "benchmarkDeltaSeries":
        value = metrics.benchmarkDeltaSeries(productId!);
        break;
      default:
        throw new Error(`unknown query fn: ${q.fn}`);
    }
    queries[q.name] = normalize(value);
  }
  if (inputs.queries) result.queries = queries;

  // ---- rules ----
  if (inputs.rules && inputs.rules.runs > 0) {
    const runs = [];
    for (let i = 0; i < inputs.rules.runs; i++) runs.push(rules.runRules(asOf));
    result.runs = runs;
    const recs = db.all<any>(
      `SELECT * FROM pk_recommendations
       ORDER BY rule, COALESCE(slot_number, 0), id`
    );
    result.recommendations = recs.map((r) =>
      normalize({
        rule: r.rule,
        machine_id: r.machine_id,
        slot_number: r.slot_number,
        severity: r.severity,
        status: r.status,
        payload: JSON.parse(r.payload_json),
      })
    );
  }

  // JSON round-trip turns Infinity into null (documented representation).
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
}

// Guarded: tests/pokemon-ops-alerts.test.ts imports loadInputs/mustGet from
// this module via a separate entry script — that import must not trigger a
// run of this file's own CLI main().
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
