import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_ROUTES, LEGACY_BUSINESS_REDIRECTS, resolveBusinessUnit } from "../lib/business-workspace";

const ROOT = path.resolve(import.meta.dirname, "..");

test("all eight Business routes have direct labels and page files", () => {
  assert.deepEqual(BUSINESS_ROUTES.map(({ label }) => label), ["Overview", "CRM", "Locations", "Inventory", "Sourcing", "Finance", "Agents", "Integrations"]);
  for (const { href } of BUSINESS_ROUTES) {
    const relative = href === "/business" ? "app/business/page.tsx" : `app${href}/page.tsx`;
    assert.equal(fs.existsSync(path.join(ROOT, relative)), true, `${href} should have a page`);
  }
});

test("legacy Pokemon routes preserve explicit Pokemon scope", () => {
  assert.deepEqual(LEGACY_BUSINESS_REDIRECTS, {
    "/pokemon-crm": "/business/crm?unit=pokemon",
    "/pokemon-ops": "/business/inventory?unit=pokemon",
    "/vending": "/business/locations?unit=pokemon",
  });
});

test("validated query selection takes precedence over storage", () => {
  assert.equal(resolveBusinessUnit("?unit=pokemon", "subtap"), "pokemon");
  assert.equal(resolveBusinessUnit("?unit=portable-charging", "pokemon"), "portable-charging");
  assert.equal(resolveBusinessUnit("?unit=invalid", "subtap"), "subtap");
  assert.equal(resolveBusinessUnit("?unit=invalid", "invalid"), "all");
});

test("Sourcing is a dedicated route backed by sourcing mode", () => {
  const source = fs.readFileSync(path.join(ROOT, "app/business/sourcing/page.tsx"), "utf8");
  assert.match(source, /OpsWorkspace mode="sourcing"/);
  assert.notEqual(BUSINESS_ROUTES.find(({ label }) => label === "Sourcing")?.href, "/business/inventory");
});
