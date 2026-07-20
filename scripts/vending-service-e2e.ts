import { spawn, spawnSync } from "node:child_process";
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
const run=(cmd:string,args:string[],runEnv:NodeJS.ProcessEnv=env)=>{const r=spawnSync(cmd,args,{cwd:root,env:runEnv,encoding:"utf8"});if(r.status)throw new Error(r.stderr||`${cmd} failed`);return r.stdout.trim()};
const wait=async(fn:()=>Promise<boolean>,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,200))}throw new Error("timed out waiting for server")};
async function clickNavigate(page:import("puppeteer-core").Page,selector:string,url:string){await Promise.all([page.waitForNavigation({waitUntil:"networkidle0"}),page.click(selector)]);if(page.url()!==url)throw new Error(`expected URL ${url}, got ${page.url()}`)}

async function main(){
  if(port===3000)throw new Error("refusing live port");
  run("npm",["run","migrate"]);
  const db=new Database(dbPath);
  const machine=Number(db.prepare("INSERT INTO machines(name,location,status,access_notes,position_notes) VALUES('E2E Service Machine','E2E Venue','live','Ask front desk for key','North wall')").run().lastInsertRowid);
  const product=Number(db.prepare("INSERT INTO pk_products(set_name,display_name) VALUES('E2E Set','E2E Pack')").run().lastInsertRowid);
  const lot=Number(db.prepare("INSERT INTO pk_purchase_lots(purchase_date,source,product_id,pack_count,total_cost_cents,landed_cost_per_pack_cents,status) VALUES('2026-07-20','other',?,20,4000,200,'received')").run(product).lastInsertRowid);
  db.close();
  server=spawn("node_modules/.bin/tsx",["server.ts"],{cwd:root,env:{...env,NODE_ENV:"production",PORT:String(port)},stdio:"ignore"});
  await wait(async()=>{try{return(await fetch(`${base}/api/auth/providers`)).ok}catch{return false}});
  const cookie=run("node_modules/.bin/tsx",["scripts/pokemon-ops-mint-session.ts"],env);
  const puppeteer=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.E2E_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.setExtraHTTPHeaders({Cookie:`__Secure-next-auth.session-token=${cookie}`});
  await page.goto(`${base}/business/locations`,{waitUntil:"networkidle0"});
  if(!(await page.$eval("h1",e=>e.textContent?.trim()==="Locations")))throw new Error("Locations heading missing");
  await clickNavigate(page,`a[href='/business/locations/${machine}']`,`${base}/business/locations/${machine}`);
  await page.waitForSelector("[data-testid='setup-slot-product']");
  if(!(await page.$eval("h1",e=>e.textContent?.trim()==="E2E Service Machine")))throw new Error("machine heading missing");
  await page.select("[data-testid='setup-slot-product']",String(product));
  await page.waitForFunction(()=>!(document.querySelector("[data-testid='assign-slot']") as HTMLButtonElement)?.disabled);
  await page.click("[data-testid='assign-slot']");
  await page.waitForFunction(()=>document.body.textContent?.includes("E2E Pack")&&document.querySelector("[data-testid='start-service']"));
  await clickNavigate(page,"[data-testid='start-service']",`${base}/business/locations/${machine}/service`);
  await page.waitForFunction(()=>document.querySelector("h1")?.textContent?.trim()==="Service · E2E Service Machine");
  if(!(await page.$eval("h1",e=>e.textContent?.trim()==="Service · E2E Service Machine")))throw new Error("service heading missing");
  await page.type("[data-testid='slot-1-remaining']","5");
  await page.click("[data-testid='slot-1-refill']",{count:3});await page.type("[data-testid='slot-1-refill']","3");
  await page.waitForSelector("[data-testid='slot-1-lot']");await page.select("[data-testid='slot-1-lot']",String(lot));
  await page.waitForFunction(()=>!(document.querySelector("[data-testid='complete-service']") as HTMLButtonElement)?.disabled);
  await page.click("[data-testid='complete-service']");
  await page.waitForFunction(()=>document.querySelector("h1")?.textContent?.trim()==="Physical count verified");
  await clickNavigate(page,`a[href='/business/locations/${machine}']`,`${base}/business/locations/${machine}`);
  await page.waitForFunction(()=>document.body.textContent?.includes("Service visit history")&&document.body.textContent?.includes("Visit 1"));
  await page.goto(`${base}/business/inventory`,{waitUntil:"networkidle0"});
  if(!(await page.$eval("h1",e=>e.textContent?.trim()==="Inventory")))throw new Error("Inventory heading missing");
  await page.click("#inventory-tab-1");
  await page.waitForFunction(()=>document.body.textContent?.includes("E2E Service Machine")&&document.body.textContent?.includes("8 verified units"));
  console.log("OK: configured arbitrary machine, serviced sourced refill, verified detail and Inventory Service History");
}
async function cleanup(){await browser?.close();if(server?.pid){spawnSync("pkill",["-TERM","-P",String(server.pid)]);try{process.kill(server.pid,"SIGTERM")}catch{}await new Promise(r=>setTimeout(r,200));try{process.kill(server.pid,"SIGKILL")}catch{}}fs.rmSync(tmp,{recursive:true,force:true})}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
