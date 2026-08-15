import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { allowedEmails, healthAllowedEmails } from "@/lib/secrets";

const root="/home/Arjun/rathworkspace";
const port=3101;
const base=`http://127.0.0.1:${port}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"health-visual-e2e."));
const dbPath=path.join(tmp,"health.db");
const output="/home/Arjun/command-center/Health/logs/verification";
fs.mkdirSync(output,{recursive:true});
let server:ReturnType<typeof spawn>|null=null;
let browser:import("puppeteer-core").Browser|null=null;
const wait=async(fn:()=>Promise<boolean>,ms=90000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error("server readiness timeout")};
async function main(){
  const source=new Database(path.join(root,"data/rathworkspace.db"),{readonly:true});
  await source.backup(dbPath);
  source.close();
  const env:NodeJS.ProcessEnv={...process.env,RATHWORKSPACE_DB:dbPath,NODE_ENV:"production",PORT:String(port)};
  const logs:string[]=[];
  const child=spawn("node_modules/.bin/tsx",["server.ts"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  server=child;
  child.stdout?.on("data",d=>logs.push(String(d)));
  child.stderr?.on("data",d=>logs.push(String(d)));
  await wait(async()=>{try{return (await fetch(`${base}/api/auth/providers`)).ok}catch{return false}});
  const owner=healthAllowedEmails()[0];
  const ordinary=allowedEmails().find(email=>!healthAllowedEmails().includes(email));
  if(!owner||!ordinary)throw new Error("Health E2E requires one Health owner and one ordinary app user");
  const mint=(email:string)=>{
    const result=spawnSync("node_modules/.bin/tsx",["scripts/pokemon-ops-mint-session.ts"],{cwd:root,env:{...env,E2E_SESSION_EMAIL:email},encoding:"utf8"});
    if(result.status!==0)throw new Error(`session mint failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const cookie=mint(owner);
  const ordinaryCookie=mint(ordinary);
  const unauth=await fetch(`${base}/api/health`);
  if(unauth.status!==401)throw new Error(`unauth /api/health expected 401, got ${unauth.status}`);
  const auth=await fetch(`${base}/api/health`,{headers:{Cookie:`__Secure-next-auth.session-token=${cookie}`}});
  if(auth.status!==200)throw new Error(`auth /api/health expected 200, got ${auth.status}: ${await auth.text()}`);
  const ordinaryApi=await fetch(`${base}/api/health`,{headers:{Cookie:`__Secure-next-auth.session-token=${ordinaryCookie}`}});
  if(ordinaryApi.status!==401)throw new Error(`ordinary-user /api/health expected 401, got ${ordinaryApi.status}`);
  const ordinaryPage=await fetch(`${base}/health`,{headers:{Cookie:`__Secure-next-auth.session-token=${ordinaryCookie}`},redirect:"manual"});
  if(ordinaryPage.status!==307||!ordinaryPage.headers.get("location")?.includes("/signin"))throw new Error(`ordinary-user /health expected signin redirect, got ${ordinaryPage.status}`);
  const snapshot:any=await auth.json();
  if(!snapshot.generatedAt||!snapshot.connections||snapshot.substances===undefined)throw new Error("private health snapshot shape missing expected fields");
  const puppeteer=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.E2E_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const results:any[]=[];
  for(const viewport of [{name:"mobile",width:390,height:844},{name:"desktop",width:1440,height:1000}]){
    const page=await browser.newPage();
    const consoleErrors:string[]=[];
    page.on("console",msg=>{if(msg.type()==="error"&&!msg.text().startsWith("Failed to load resource"))consoleErrors.push(msg.text())});
    page.on("pageerror",err=>consoleErrors.push(String(err)));
    page.on("response",response=>{if(response.status()>=400&&!response.url().endsWith("/favicon.ico"))consoleErrors.push(`${response.status()} ${response.url()}`)});
    await page.setViewport({width:viewport.width,height:viewport.height});
    await page.setCookie({name:"__Secure-next-auth.session-token",value:cookie,url:base,httpOnly:true,secure:true,sameSite:"Lax"});
    // The app keeps a live WebSocket open and reconnects during startup, so networkidle0
    // is not a meaningful readiness gate. Wait for the document, then the Health heading.
    const response=await page.goto(`${base}/health`,{waitUntil:"domcontentloaded",timeout:90000});
    if(!response||response.status()!==200)throw new Error(`${viewport.name} /health did not return 200`);
    await page.waitForFunction(()=>document.querySelector("h1")?.textContent?.includes("Health"),{timeout:30000});
    await page.waitForFunction(()=>{
      const text=document.body.innerText;
      return text.includes("WHOOP")&&text.includes("Hevy")&&text.includes("Readiness");
    },{timeout:30000});
    const ui=await page.evaluate(()=>{
      const main=document.querySelector("main");
      return {
        title:document.querySelector("h1")?.textContent?.trim(),
        text:main?.textContent ?? document.body.textContent ?? "",
        viewport:main?.clientWidth ?? document.documentElement.clientWidth,
        scrollWidth:main?.scrollWidth ?? document.documentElement.scrollWidth,
        scrollHeight:main?.scrollHeight ?? document.documentElement.scrollHeight,
        clientHeight:main?.clientHeight ?? document.documentElement.clientHeight,
        cards:document.querySelectorAll("section,article").length,
      };
    });
    if(ui.scrollWidth>ui.viewport+1)throw new Error(`${viewport.name} horizontal overflow ${ui.scrollWidth}>${ui.viewport}`);
    const required=["WHOOP","Hevy","Readiness","Weight and cut trend","Today's nutrition estimate","Training · strength sessions","Latest check-in and checkpoint","Private context"];
    const missing=required.filter(label=>!ui.text.includes(label));
    if(missing.length)throw new Error(`${viewport.name} missing Health sections: ${missing.join(", ")}`);
    const screenshot=path.join(output,`2026-08-15-health-${viewport.name}.png`);
    await page.screenshot({path:screenshot,fullPage:false});
    await page.evaluate(()=>{const main=document.querySelector("main");if(main)main.scrollTop=main.scrollHeight});
    await new Promise(resolve=>setTimeout(resolve,250));
    const bottomScreenshot=path.join(output,`2026-08-15-health-${viewport.name}-bottom.png`);
    await page.screenshot({path:bottomScreenshot,fullPage:false});
    results.push({...viewport,...ui,text:undefined,consoleErrors,screenshot,bottomScreenshot});
    await page.close();
  }
  if(results.some(r=>r.consoleErrors.length))throw new Error(`browser console errors: ${JSON.stringify(results)}`);
  console.log(JSON.stringify({api:{unauth:unauth.status,owner:auth.status,ordinary:ordinaryApi.status,ordinaryPage:ordinaryPage.status,generatedAt:snapshot.generatedAt,whoop:snapshot.connections.whoop?.status,hevy:snapshot.connections.hevy?.status},viewports:results},null,2));
  fs.writeFileSync(path.join(output,"2026-08-15-health-server.log"),logs.join(""));
}
async function cleanup(){await browser?.close();if(server?.pid){spawnSync("pkill",["-TERM","-P",String(server.pid)]);try{process.kill(server.pid,"SIGTERM")}catch{}await new Promise(r=>setTimeout(r,250));try{process.kill(server.pid,"SIGKILL")}catch{}}fs.rmSync(tmp,{recursive:true,force:true});}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
