// Phase 1 seed for pokemon-ops: Fixture Corner Store machine row, the 16 catalog products,
// and the carddistro 2026-07-17 mentor benchmark import. Idempotent — lookup-first
// / receipt-gated everywhere; safe to run twice.
import path from "node:path";
import { get, getDb } from "@/db";
import { ensureMachine, ensureProduct } from "@/lib/pokemon-ops/db";
import { importCarddistroCsv } from "@/lib/pokemon-ops/import-observations";
import type { NewProduct } from "@/lib/pokemon-ops/types";

const MACHINE_NOTE =
  "Machine 1: VTM Mini Wall, 8 selections, one slot each, 22mm coils, " +
  "~15 packs/slot (~120 total). One SKU can span multiple slots.";

const SEED_CSV = path.join(
  process.cwd(),
  "docs/plans/pokemon-ops/seeds/carddistro-2026-07-17.csv"
);

const PRODUCTS: NewProduct[] = [
  { set_name: "Mystery Slab", form: "slab", tier: "slab", reprint_status: "none" },
  { set_name: "Phantasmal Flames", form: "booster", tier: "premium", reprint_status: "none" },
  { set_name: "Mega Evolution", form: "booster", tier: "mid", reprint_status: "none" },
  { set_name: "Destined Rivals", form: "booster", tier: "mid", reprint_status: "active" },
  { set_name: "Journey Together", form: "booster", tier: "entry", reprint_status: "none" },
  { set_name: "Paldean Fates", form: "booster", tier: "premium", reprint_status: "none" },
  { set_name: "151", form: "booster", tier: "premium", reprint_status: "none" },
  { set_name: "Pitch Black", form: "booster", tier: "mid", reprint_status: "none", release_date: "2026-07-17" },
  { set_name: "Chaos Rising", form: "booster", tier: "entry", reprint_status: "none" },
  { set_name: "Perfect Order", form: "booster", tier: "entry", reprint_status: "none" },
  { set_name: "Ascended Heroes", form: "booster", tier: "premium", reprint_status: "announced" },
  { set_name: "White Flare", form: "booster", tier: "premium", reprint_status: "none" },
  { set_name: "Black Bolt", form: "booster", tier: "premium", reprint_status: "none" },
  { set_name: "Surging Sparks", form: "booster", tier: "mid", reprint_status: "none" },
  { set_name: "Prismatic Evolutions", form: "booster", tier: "premium", reprint_status: "active" },
  { set_name: "Storm Emerald", form: "booster", tier: "premium", reprint_status: "none", release_date: "2026-07-31" },
];

function count(table: string, where = "", ...params: unknown[]): number {
  return get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} ${where}`, ...params)!.c;
}

function main() {
  getDb();
  const machineId = ensureMachine({
    name: "Fixture Corner Store",
    location: "Lexington, MA",
    status: "placing",
    note: MACHINE_NOTE,
  });
  for (const product of PRODUCTS) ensureProduct(product);
  const result = importCarddistroCsv(SEED_CSV);
  console.log(
    JSON.stringify(
      {
        machine_id: machineId,
        machines_everest: count("machines", "WHERE name = ?", "Fixture Corner Store"),
        products: count("pk_products"),
        observations: count("pk_price_observations"),
        receipts: count("pk_import_receipts"),
        import: { imported: result.imported, skipped: result.skipped, sha256: result.receipt.sha256 },
      },
      null,
      2
    )
  );
}

main();
