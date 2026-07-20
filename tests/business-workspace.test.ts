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

test("CRM CSV normalization keeps operator fields and truncates giant notes", async () => {
  const { normalizeCrmCsv } = await import("../lib/business/crm-sheets");
  const rows = normalizeCrmCsv('Venue,Category,City,Region,Phone,Email,Status,Last touch at,Next action,Notes\n"Example, Hall",Arcade,Boston,Greater Boston,617-555-0100,owner@example.com,Warm,2026-07-19,Call owner,"' + "x".repeat(400) + '"');
  assert.equal(rows.length, 1); assert.equal(rows[0].venue, "Example, Hall");
  assert.match(rows[0].contact, /617-555-0100/); assert.equal(rows[0].nextAction, "Call owner");
  assert.equal(rows[0].notesSummary.length, 240);
});

test("Miscellaneous Leads inbox columns normalize into operator fields", async () => {
  const { normalizeCrmCsv } = await import("../lib/business/crm-sheets");
  const csv = "Capture ID,Captured Date,Captured By / Source,Raw Venue Name,Normalized Venue Name,Business Type,Product Lane Guess,Neighborhood / Area,City,State,Why It Caught Attention,Fit Hypothesis,Owner / Contact Known?,Verification Needed,Next Tiny Action,Inbox Status,Route Decision,Processing Notes\n" +
    "misc-1,2026-07-18,drive-by,Raw Market,University Market,Convenience Store,Both,Harvard Square,Cambridge,MA,Large busy store,Strong dwell time,Staff contact only,Owner name,Ask for owner,Needs verification,Hold,Keep rough";
  const [row] = normalizeCrmCsv(csv);
  assert.equal(row.id, "misc-1");
  assert.equal(row.venue, "University Market");
  assert.equal(row.category, "Convenience Store");
  assert.match(row.cityRegion, /Cambridge.*MA.*Harvard Square/);
  assert.match(row.contact, /Staff contact only/);
  assert.equal(row.status, "Needs verification");
  assert.match(row.lastTouch, /drive-by.*2026-07-18/);
  assert.equal(row.nextAction, "Ask for owner");
  assert.match(row.notesSummary, /Strong dwell time.*Large busy store.*Keep rough/);
});

test("CRM server filtering covers the full source before deterministic pagination", async () => {
  const { normalizeCrmCsv, filterCrmRows } = await import("../lib/business/crm-sheets");
  const csv = ["Venue,Status", ...Array.from({length:470},(_,i)=>`Venue ${i+1},${i===469?"Needle status":"New"}`)].join("\n");
  const rows=normalizeCrmCsv(csv); assert.equal(rows.length,470);
  assert.equal(rows.slice(0,100).length,100); const filtered=filterCrmRows(rows,"needle");
  assert.equal(filtered.length,1); assert.equal(filtered.slice(0,100)[0].venue,"Venue 470");
});

test("Misc Sheets token helper keeps fresh tokens and refreshes expired installed credentials", async () => {
  const { freshGoogleAccessToken } = await import("../lib/business/crm-sheets");
  assert.equal(await freshGoogleAccessToken({access_token:"fresh",expiry_date:200000},{installed:{}},1000),"fresh");
  let requestBody=""; const mocked=async (_url:any,init:any)=>{requestBody=String(init.body);return new Response(JSON.stringify({access_token:"renewed"}),{status:200,headers:{"content-type":"application/json"}})};
  const token=await freshGoogleAccessToken({access_token:"old",expiry_date:1,refresh_token:"fixture-refresh",token_uri:"https://example.test/token",client_id:"fixture-id"},{installed:{client_secret:"fixture-secret"}},1000,mocked as typeof fetch);
  assert.equal(token,"renewed"); assert.match(requestBody,/grant_type=refresh_token/); assert.match(requestBody,/client_secret=fixture-secret/);
});

test("Discord validation checks bot identity and each watched channel without returning credentials", async () => {
  const {validateDiscordBot}=await import("../lib/connections/discord"); const urls:string[]=[];
  const mocked=async(url:any)=>{urls.push(String(url));return new Response(JSON.stringify(urls.length===1?{bot:true,username:"FixtureBot"}:{id:"channel"}),{status:200,headers:{"content-type":"application/json"}})};
  assert.deepEqual(await validateDiscordBot("fixture-token",["111111111111111","222222222222222"],mocked as typeof fetch),{botName:"FixtureBot",channelCount:2});
  assert.deepEqual(urls.map(u=>new URL(u).pathname),["/api/v10/users/@me","/api/v10/channels/111111111111111","/api/v10/channels/222222222222222"]);
});

test("multi-source CRM page does not have a page-wide Pokemon boundary", () => {
  const source=fs.readFileSync(path.join(ROOT,"app/business/crm/page.tsx"),"utf8"); assert.doesNotMatch(source,/PokemonDataBoundary/);
  const workspace=fs.readFileSync(path.join(ROOT,"components/business/CrmWorkspace.tsx"),"utf8"); assert.match(workspace,/<PokemonDataBoundary><PokemonCrmWorkspace/);
});

test("Total Invested numeric text has an explicit high-contrast semantic class", () => {
  const source = fs.readFileSync(path.join(ROOT, "components/pokemon-ops/KpiBand.tsx"), "utf8");
  assert.match(source, /text-slate-950 dark:text-white text-txt-primary/);
  assert.match(source, /testId="kpi-total-invested"/);
});
