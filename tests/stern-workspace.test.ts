import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { STERN_ROUTES, LEGACY_STERN_REDIRECTS, activeSternRoute, sternPageTitle, isSternPath } from "../lib/stern-workspace";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("all seven Stern routes have the brief's labels and a page file", () => {
  assert.deepEqual(STERN_ROUTES.map(({ label }) => label), ["Overview", "Club Recruiting", "Network", "Tasks", "Classes", "Career", "Automation"]);
  for (const { href } of STERN_ROUTES) {
    const relative = href === "/stern" ? "app/stern/page.tsx" : `app${href}/page.tsx`;
    assert.equal(fs.existsSync(path.join(ROOT, relative)), true, `${href} should have a page`);
  }
});

test("legacy School and Career routes redirect into the Stern tab", () => {
  assert.deepEqual(LEGACY_STERN_REDIRECTS, { "/school": "/stern", "/career": "/stern/career" });
  assert.match(read("app/(dash)/school/page.tsx"), /redirect\("\/stern"\)/);
  assert.match(read("app/(dash)/career/page.tsx"), /redirect\("\/stern\/career"\)/);
  assert.equal(fs.existsSync(path.join(ROOT, "lib/school.ts")), false, "lib/school.ts is deleted");
  assert.equal(fs.existsSync(path.join(ROOT, "app/api/school/route.ts")), false, "school API is deleted");
});

test("primary nav shows Stern and no longer shows School or Career", () => {
  const nav = read("components/shell/nav.tsx");
  assert.match(nav, /href: "\/stern"/);
  assert.doesNotMatch(nav, /href: "\/school"/);
  assert.doesNotMatch(nav, /href: "\/career"/);
  for (const file of ["components/shell/NavRail.tsx", "components/home/Home.tsx"]) {
    assert.doesNotMatch(read(file), /lib\/school/, `${file} must not import the deleted school lib`);
  }
});

test("active route resolution is exact for Overview and segment-prefixed for sub-routes", () => {
  assert.equal(activeSternRoute("/stern")?.label, "Overview");
  assert.equal(activeSternRoute("/stern/recruiting/12")?.href, "/stern/recruiting");
  assert.equal(activeSternRoute("/stern/networking"), undefined);
  assert.equal(sternPageTitle("/stern/classes/4"), "Classes");
  assert.equal(isSternPath("/sternx"), false);
  assert.equal(isSternPath("/stern/tasks"), true);
});

test("Stern layout is gated by the allowlist and every page has honest copy", () => {
  const layout = read("app/stern/layout.tsx");
  assert.match(layout, /allowedEmails/);
  assert.match(layout, /redirect\("\/signin"\)/);
  assert.match(layout, /SternShell/);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : []);
  for (const file of walk(path.join(ROOT, "app/stern"))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Built in WP/, `${file} must not promise future packages`);
  }
});

test("shell dispatches the quick-add event and reads the stern live channel", () => {
  const shell = read("components/stern/SternShell.tsx");
  assert.match(shell, /new CustomEvent\("stern:quick-add"\)/);
  assert.match(shell, /useLiveData<SternSnapshot>\("stern"\)/);
  assert.match(shell, /stern_rail_collapsed/);
  assert.match(shell, /Back to dashboard/);
  assert.match(shell, /Search people, clubs, tasks/);
});
