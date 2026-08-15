#!/usr/bin/env tsx
import { syncHevy } from "@/lib/sources/hevy";

const forceFull=process.argv.includes("--full");
syncHevy({forceFull}).then((result)=>{
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if(result.status==="broken")process.exitCode=1;
}).catch((error)=>{
  process.stderr.write(`${JSON.stringify({status:"broken",detail:error instanceof Error?error.message:"Hevy sync failed"})}\n`);
  process.exitCode=1;
});
