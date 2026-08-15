#!/usr/bin/env tsx
import fs from "node:fs";
import {
  HealthValidationError, healthSnapshot, privateHealthSnapshot, logBodyMeasurement, logCheckin, logMeal,
  logRecommendation, logSubstance, stableKey, updateRecommendationStatus,
} from "@/lib/health";

function parseArgs(argv: string[]) {
  const flags:Record<string,unknown>={};
  const positional:string[]=[];
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const [rawKey,inline]=arg.slice(2).split("=",2);
    if (rawKey.startsWith("no-") && inline === undefined) { flags[rawKey.slice(3).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=false; continue; }
    const key=rawKey.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    if (inline !== undefined) flags[key]=inline;
    else if (argv[i+1] !== undefined && !argv[i+1].startsWith("--")) flags[key]=argv[++i];
    else flags[key]=true;
  }
  return {command:positional[0],flags};
}
function payload(flags:Record<string,unknown>) {
  if (flags.json !== undefined) {
    const raw=flags.json === "-" ? fs.readFileSync(0,"utf8") : String(flags.json);
    return JSON.parse(raw);
  }
  if (flags.file !== undefined) return JSON.parse(fs.readFileSync(String(flags.file),"utf8"));
  return flags;
}
function withKey(prefix:string,input:any) {
  return {...input,idempotencyKey:input.idempotencyKey || stableKey(prefix,input)};
}
function bool(value:unknown) {
  if (value === true || value === false) return value;
  if (value == null || value === "unknown") return null;
  if (["true","yes","1"].includes(String(value).toLowerCase())) return true;
  if (["false","no","0"].includes(String(value).toLowerCase())) return false;
  return value;
}
function n(value:unknown) { return value == null || value === "unknown" || value === "" ? null : Number(value); }

async function main() {
  const {command:argCommand,flags}=parseArgs(process.argv.slice(2));
  const raw=payload(flags);
  const command=argCommand || raw.command;
  const now=new Date().toISOString();
  let output:unknown;
  switch(command) {
    case "snapshot": output=healthSnapshot(); break;
    case "private-snapshot": output=privateHealthSnapshot(); break;
    case "meal": {
      const input=withKey("meal",{
        mealAt:raw.mealAt || raw.time || now, mealType:raw.mealType || raw.type || "unknown", description:raw.description,
        caloriesLow:n(raw.caloriesLow), caloriesHigh:n(raw.caloriesHigh), caloriesSelected:n(raw.caloriesSelected),
        proteinLowG:n(raw.proteinLowG), proteinHighG:n(raw.proteinHighG), proteinSelectedG:n(raw.proteinSelectedG),
        confidence:raw.confidence || "unknown", assumptions:raw.assumptions || "", source:raw.source || "cli", sourceRef:raw.sourceRef || null,
        supersedesId:n(raw.supersedesId), idempotencyKey:raw.idempotencyKey,
      });
      output=logMeal(input); break;
    }
    case "checkin": {
      const input=withKey("checkin",{
        effectiveAt:raw.effectiveAt || raw.time || now,effectiveDay:raw.effectiveDay,weightMeasurementId:n(raw.weightMeasurementId),
        energy:n(raw.energy),hunger:n(raw.hunger),soreness:n(raw.soreness),stress:n(raw.stress),trainingIntent:raw.trainingIntent || null,
        trainingCompleted:bool(raw.trainingCompleted),nutritionAdherent:bool(raw.nutritionAdherent),proteinTargetMet:bool(raw.proteinTargetMet),stepsTargetMet:bool(raw.stepsTargetMet),
        notes:raw.notes || "",nextCheckpointAt:raw.nextCheckpointAt || null,source:raw.source || "cli",sourceRef:raw.sourceRef || null,
        supersedesId:n(raw.supersedesId),idempotencyKey:raw.idempotencyKey,
      });
      output=logCheckin(input); break;
    }
    case "bodyweight":
    case "body": {
      const pounds=n(raw.weightLb);
      const weightKg=n(raw.weightKg) ?? (pounds == null ? null : +(pounds * 0.45359237).toFixed(3));
      const input=withKey("body",{
        measuredAt:raw.measuredAt || raw.time || now,weightKg,bodyFatPct:n(raw.bodyFatPct),leanMassKg:n(raw.leanMassKg),waistCm:n(raw.waistCm),
        context:raw.context || "",estimated:bool(raw.estimated) === true,source:raw.source || "cli",externalId:raw.externalId || null,supersedesId:n(raw.supersedesId),idempotencyKey:raw.idempotencyKey,
      });
      output=logBodyMeasurement(input); break;
    }
    case "substance": {
      const input=withKey("substance",{
        occurredAt:raw.occurredAt || raw.time || now,substance:raw.substance,amount:n(raw.amount),unit:raw.unit || null,
        standardDrinks:n(raw.standardDrinks),thcMg:n(raw.thcMg),cbdMg:n(raw.cbdMg),timingContext:raw.timingContext || null,
        context:raw.context || "",estimated:bool(raw.estimated) === true,source:raw.source || "cli",sourceRef:raw.sourceRef || null,supersedesId:n(raw.supersedesId),idempotencyKey:raw.idempotencyKey,
      });
      output=logSubstance(input); break;
    }
    case "recommendation": {
      const input=withKey("recommendation",{
        category:raw.category,action:raw.action,rationale:raw.rationale,inputsAsOf:raw.inputsAsOf || now,
        provenance:Array.isArray(raw.provenance) ? raw.provenance : raw.provenance ? [raw.provenance] : [],status:raw.status || "active",
        expiresAt:raw.expiresAt || null,source:raw.source || "trainer",idempotencyKey:raw.idempotencyKey,
      });
      output=logRecommendation(input); break;
    }
    case "recommendation-status": output=updateRecommendationStatus(Number(raw.id),raw.status); break;
    default:
      throw new HealthValidationError("command must be snapshot, private-snapshot, meal, checkin, bodyweight, body, substance, recommendation, or recommendation-status");
  }
  process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
}

main().catch((error) => {
  const message=error instanceof Error ? error.message : "health command failed";
  process.stderr.write(`${JSON.stringify({error:message})}\n`);
  process.exitCode=error instanceof HealthValidationError ? 2 : 1;
});
