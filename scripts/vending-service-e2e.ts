import {spawn,spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root=path.resolve(__dirname,"..");
const port=Number(process.env.E2E_PORT||3212);
const base=`http://127.0.0.1:${port}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"vending-service-e2e."));
const dbPath=path.join(tmp,"e2e.db");
const env={...process.env,RATHWORKSPACE_DB:dbPath};
let server:ReturnType<typeof spawn>|null=null;
let browser:import("puppeteer-core").Browser|null=null;
const run=(cmd:string,args:string[],runEnv:NodeJS.ProcessEnv=env)=>{const r=spawnSync(cmd,args,{cwd:root,env:runEnv,encoding:"utf8",stdio:"pipe"});if(r.status)throw new Error(`${cmd} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);return r.stdout.trim()};
const wait=async(fn:()=>Promise<boolean>,ms=90000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,200))}throw new Error("timed out waiting for condition")};
async function clickNavigate(page:import("puppeteer-core").Page,selector:string,url:string){await Promise.all([page.waitForNavigation({waitUntil:"networkidle0"}),page.click(selector)]);if(page.url()!==url)throw new Error(`expected URL ${url}, got ${page.url()}`)}
async function fill(page:import("puppeteer-core").Page,selector:string,value:string){await page.click(selector,{count:3});await page.type(selector,value)}
async function submitMachine(page:import("puppeteer-core").Page,name:string,location:string,asset:string,notes:string){await fill(page,"[data-testid='add-machine-name']",name);await fill(page,"[data-testid='add-machine-location']",location);await fill(page,"[data-testid='add-machine-asset-code']",asset);await fill(page,"[data-testid='add-machine-access-notes']",notes);await page.click("[data-testid='add-machine-submit']")}
async function machineIdFor(page:import("puppeteer-core").Page,name:string){return page.$$eval(".fleet-row",(rows,target)=>{const row=rows.find(r=>r.querySelector("strong")?.textContent?.startsWith(String(target)));const href=row?.querySelector<HTMLAnchorElement>("a[href^='/business/locations/']")?.getAttribute("href");return href?Number(href.split("/").at(-1)):null},name)}

async function main(){
  if(port===3000)throw new Error("refusing live port");
  if(process.env.E2E_SKIP_BUILD!=="1"){console.log("Building current checkout for vending-service E2E…");run("npm",["run","build"])}
  run("npm",["run","migrate"]);
  const db=new Database(dbPath);
  const product=Number(db.prepare("INSERT INTO pk_products(set_name,display_name) VALUES('E2E Set','E2E Pack')").run().lastInsertRowid);
  const lot=Number(db.prepare("INSERT INTO pk_purchase_lots(purchase_date,source,product_id,pack_count,total_cost_cents,landed_cost_per_pack_cents,status) VALUES('2026-07-20','other',?,20,4000,200,'received')").run(product).lastInsertRowid);
  db.close();
  server=spawn("node_modules/.bin/tsx",["server.ts"],{cwd:root,env:{...env,NODE_ENV:"production",PORT:String(port)},stdio:"ignore"});
  await wait(async()=>{try{return(await fetch(`${base}/api/auth/providers`)).ok}catch{return false}});
  const cookie=run("node_modules/.bin/tsx",["scripts/pokemon-ops-mint-session.ts"],env);
  const puppeteer=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.E2E_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.setExtraHTTPHeaders({Cookie:`__Secure-next-auth.session-token=${cookie}`});

  let failVending=true,failService=true;
  await page.setRequestInterception(true);
  page.on("request",req=>{const url=new URL(req.url());if(req.method()==="GET"&&url.pathname==="/api/vending"&&failVending){failVending=false;setTimeout(()=>req.respond({status:503,contentType:"application/json",body:'{"error":"test vending outage"}'}),250)}else if(req.method()==="GET"&&url.pathname==="/api/business/service"&&failService){failService=false;setTimeout(()=>req.respond({status:503,contentType:"application/json",body:'{"error":"test service outage"}'}),250)}else req.continue()});
  await page.goto(`${base}/business/locations`,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.body.textContent?.includes("Loading locations"));
  await page.waitForSelector("[data-testid='vending-load-error']");
  await page.click("[data-testid='vending-load-error'] button");
  await page.waitForSelector("[data-testid='add-machine-name']");
  await page.waitForSelector("[data-testid='service-load-error']");
  await page.click("[data-testid='service-load-error'] button");
  await page.waitForFunction(()=>document.body.textContent?.includes("No machines recorded yet."));

  await submitMachine(page,"Duplicate Anchor","Anchor Venue","DUP-001","Anchor access");
  await wait(async()=>await machineIdFor(page,"Duplicate Anchor")!==null);
  await submitMachine(page,"Duplicate Anchor","Preserved Venue","NEW-002","Preserve these notes");
  await page.waitForSelector("[data-testid='add-machine-error']");
  const preserved=await page.$eval("[data-testid='add-machine-name']",e=>(e as HTMLInputElement).value==="Duplicate Anchor")&&await page.$eval("[data-testid='add-machine-location']",e=>(e as HTMLInputElement).value==="Preserved Venue")&&await page.$eval("[data-testid='add-machine-access-notes']",e=>(e as HTMLInputElement).value==="Preserve these notes");
  if(!preserved)throw new Error("duplicate submission did not preserve fields");
  if((await page.$$eval(".fleet-row strong",els=>els.filter(e=>e.textContent?.startsWith("Duplicate Anchor")).length))!==1)throw new Error("duplicate submission added a row");
  await fill(page,"[data-testid='add-machine-name']","E2E Service Machine");
  await fill(page,"[data-testid='add-machine-asset-code']","E2E-001");
  await page.click("[data-testid='add-machine-submit']");
  await page.waitForFunction(()=>!(document.querySelector("[data-testid='add-machine-error']"))&&(document.querySelector("[data-testid='add-machine-name']") as HTMLInputElement)?.value==="");
  await wait(async()=>await machineIdFor(page,"E2E Service Machine")!==null);
  const machine=await machineIdFor(page,"E2E Service Machine");if(!machine)throw new Error("exact created machine row/link missing");
  await clickNavigate(page,`[data-testid='machine-link-${machine}']`,`${base}/business/locations/${machine}`);
  await page.waitForSelector("[data-testid='setup-slot-product']");
  await fill(page,"[data-testid='machine-name']","E2E Service Machine");
  await page.$$eval(".service-form-grid label",labels=>{const label=labels.find(x=>x.textContent?.includes("Operational status")),select=label?.querySelector("select");if(!select)throw new Error("status control missing");select.value="live";select.dispatchEvent(new Event("change",{bubbles:true}))});
  await page.click("[data-testid='save-machine-metadata']");
  await page.waitForFunction(()=>document.body.textContent?.includes("Saved"));
  await page.waitForSelector("[data-testid='setup-slot-product']");
  await page.select("[data-testid='setup-slot-product']",String(product));
  await page.click("[data-testid='assign-slot']");
  await page.waitForFunction(()=>document.body.textContent?.includes("E2E Pack")&&document.querySelector("[data-testid='start-service']"));
  await clickNavigate(page,"[data-testid='start-service']",`${base}/business/locations/${machine}/service`);
  await page.waitForFunction(()=>document.querySelector("h1")?.textContent?.trim()==="Service · E2E Service Machine");
  await page.type("[data-testid='slot-1-remaining']","5");
  await page.click("[data-testid='slot-1-refill']",{count:3});await page.type("[data-testid='slot-1-refill']","3");
  await page.waitForSelector("[data-testid='slot-1-lot']");await page.select("[data-testid='slot-1-lot']",String(lot));
  await page.waitForFunction(()=>!(document.querySelector("[data-testid='complete-service']") as HTMLButtonElement)?.disabled);
  await page.click("[data-testid='complete-service']");
  await page.waitForFunction(()=>document.querySelector("h1")?.textContent?.trim()==="Physical count verified");
  await clickNavigate(page,`a[href='/business/locations/${machine}']`,`${base}/business/locations/${machine}`);
  await page.waitForFunction(()=>document.body.textContent?.includes("Service visit history")&&document.body.textContent?.includes("Physical remaining: 5")&&document.body.textContent?.includes("lot 1"));
  await page.goto(`${base}/business/inventory`,{waitUntil:"networkidle0"});
  await page.click("#inventory-tab-1");
  await page.waitForFunction(()=>document.body.textContent?.includes("E2E Service Machine")&&document.body.textContent?.includes("8 verified units"));
  console.log("OK: retry states, duplicate preservation, UI machine creation, service detail, and Inventory history");
}
async function cleanup(){await browser?.close();if(server?.pid){spawnSync("pkill",["-TERM","-P",String(server.pid)]);try{process.kill(server.pid,"SIGTERM")}catch{}await new Promise(r=>setTimeout(r,200));try{process.kill(server.pid,"SIGKILL")}catch{}}fs.rmSync(tmp,{recursive:true,force:true})}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
