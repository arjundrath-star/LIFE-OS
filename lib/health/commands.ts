import { getDb, nowIso } from "@/db";
import type { BodyMeasurementInput, CheckinInput, MealInput, RecommendationInput, SubstanceInput } from "@/lib/health/types";
import {
  HealthValidationError, assertRange, boolInt, boundedId, dayInTimeZone, dayKey, isoDateTime,
  nullableNumber, optionalText, requiredText, stableKey, triState,
} from "@/lib/health/validation";

const MEAL_TYPES = new Set(["breakfast","lunch","dinner","snack","drink","pre_workout","post_workout","unknown"]);
const CONFIDENCE = new Set(["low","medium","high","unknown"]);
const RECOMMENDATION_CATEGORIES = new Set(["training","nutrition","recovery","checkin","general"]);
const RECOMMENDATION_STATUSES = new Set(["active","accepted","dismissed","expired","completed","review_needed"]);
type CommandTable="health_meals"|"health_checkins"|"health_substance_events"|"health_body_measurements"|"health_recommendations";

function key(value:unknown):string{
  if(typeof value!=="string"||!value.trim())throw new HealthValidationError("idempotencyKey is required");
  const normalized=value.trim();if(normalized.length>240)throw new HealthValidationError("idempotencyKey must be 240 characters or fewer");return normalized;
}
function source(value:unknown,fallback="cli"){return optionalText(value,80)||fallback}
function result(id:number,created:boolean){return {id,created}}
function commandHash(payload:unknown){return stableKey("health-command-v1",payload)}
function replay(table:CommandTable,idempotencyKey:string,payloadHash:string){
  const row=getDb().prepare(`SELECT id,payload_hash payloadHash FROM ${table} WHERE idempotency_key=?`).get(idempotencyKey) as any;
  if(!row)return null;
  if(row.payloadHash!==payloadHash)throw new HealthValidationError("idempotencyKey was already used with a different payload",409);
  return result(Number(row.id),false);
}
function withReplay(table:CommandTable,idempotencyKey:string,payloadHash:string,write:()=>number){
  const existing=replay(table,idempotencyKey,payloadHash);if(existing)return existing;
  try{return result(write(),true)}catch(error:any){
    if(String(error?.code||"").startsWith("SQLITE_CONSTRAINT")){const raced=replay(table,idempotencyKey,payloadHash);if(raced)return raced}
    throw error;
  }
}
function correctionTarget(table:"health_meals"|"health_checkins"|"health_substance_events"|"health_body_measurements",id:number|null,label:string){
  if(!id)return;
  const previous=getDb().prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as any;
  if(!previous)throw new HealthValidationError(`superseded ${label} not found`,404);
  if(previous.status!=="active")throw new HealthValidationError(`superseded ${label} is not active`,409);
}

export function logMeal(input:MealInput){
  const idempotencyKey=key(input.idempotencyKey);const mealAt=isoDateTime(input.mealAt,"mealAt");const mealType=input.mealType??"unknown";
  if(!MEAL_TYPES.has(mealType))throw new HealthValidationError("invalid mealType");const confidence=input.confidence??"unknown";if(!CONFIDENCE.has(confidence))throw new HealthValidationError("invalid confidence");
  const caloriesLow=nullableNumber(input.caloriesLow,"caloriesLow",{min:0,integer:true}),caloriesHigh=nullableNumber(input.caloriesHigh,"caloriesHigh",{min:0,integer:true}),caloriesSelected=nullableNumber(input.caloriesSelected,"caloriesSelected",{min:0,integer:true});
  const proteinLowG=nullableNumber(input.proteinLowG,"proteinLowG",{min:0}),proteinHighG=nullableNumber(input.proteinHighG,"proteinHighG",{min:0}),proteinSelectedG=nullableNumber(input.proteinSelectedG,"proteinSelectedG",{min:0});
  assertRange(caloriesLow,caloriesHigh,caloriesSelected,"calories");assertRange(proteinLowG,proteinHighG,proteinSelectedG,"protein");
  const payload={mealAt,mealType,description:requiredText(input.description,"description",4000),caloriesLow,caloriesHigh,caloriesSelected,proteinLowG,proteinHighG,proteinSelectedG,confidence,assumptions:optionalText(input.assumptions,4000),source:source(input.source),sourceRef:input.sourceRef?optionalText(input.sourceRef,500):null,supersedesId:boundedId(input.supersedesId,"supersedesId")};
  const hash=commandHash(payload);
  return withReplay("health_meals",idempotencyKey,hash,()=>{
    const db=getDb();return db.transaction(()=>{correctionTarget("health_meals",payload.supersedesId,"meal");const ts=nowIso();
      const inserted=db.prepare(`INSERT INTO health_meals (idempotency_key,payload_hash,meal_at,meal_type,description,calories_low,calories_high,calories_selected,protein_low_g,protein_high_g,protein_selected_g,confidence,assumptions,source,source_ref,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(idempotencyKey,hash,payload.mealAt,payload.mealType,payload.description,payload.caloriesLow,payload.caloriesHigh,payload.caloriesSelected,payload.proteinLowG,payload.proteinHighG,payload.proteinSelectedG,payload.confidence,payload.assumptions,payload.source,payload.sourceRef,payload.supersedesId,ts,ts);
      if(payload.supersedesId)db.prepare("UPDATE health_meals SET status='superseded',updated_at=? WHERE id=?").run(ts,payload.supersedesId);return Number(inserted.lastInsertRowid);
    }).immediate();
  });
}

export function logCheckin(input:CheckinInput){
  const idempotencyKey=key(input.idempotencyKey),effectiveAt=isoDateTime(input.effectiveAt,"effectiveAt"),effectiveDay=input.effectiveDay?dayKey(input.effectiveDay,"effectiveDay"):dayInTimeZone(effectiveAt);
  const payload={effectiveAt,effectiveDay,weightMeasurementId:boundedId(input.weightMeasurementId,"weightMeasurementId"),energy:nullableNumber(input.energy,"energy",{min:1,max:5,integer:true}),hunger:nullableNumber(input.hunger,"hunger",{min:1,max:5,integer:true}),soreness:nullableNumber(input.soreness,"soreness",{min:1,max:5,integer:true}),stress:nullableNumber(input.stress,"stress",{min:1,max:5,integer:true}),trainingIntent:input.trainingIntent?optionalText(input.trainingIntent,1000):null,trainingCompleted:boolInt(triState(input.trainingCompleted,"trainingCompleted")),nutritionAdherent:boolInt(triState(input.nutritionAdherent,"nutritionAdherent")),proteinTargetMet:boolInt(triState(input.proteinTargetMet,"proteinTargetMet")),stepsTargetMet:boolInt(triState(input.stepsTargetMet,"stepsTargetMet")),notes:optionalText(input.notes,4000),nextCheckpointAt:input.nextCheckpointAt?isoDateTime(input.nextCheckpointAt,"nextCheckpointAt"):null,source:source(input.source),sourceRef:input.sourceRef?optionalText(input.sourceRef,500):null,supersedesId:boundedId(input.supersedesId,"supersedesId")};
  const hash=commandHash(payload);
  return withReplay("health_checkins",idempotencyKey,hash,()=>{const db=getDb();return db.transaction(()=>{correctionTarget("health_checkins",payload.supersedesId,"check-in");const ts=nowIso();
    const inserted=db.prepare(`INSERT INTO health_checkins (idempotency_key,payload_hash,effective_at,effective_day,weight_measurement_id,energy,hunger,soreness,stress,training_intent,training_completed,nutrition_adherent,protein_target_met,steps_target_met,notes,next_checkpoint_at,source,source_ref,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(idempotencyKey,hash,payload.effectiveAt,payload.effectiveDay,payload.weightMeasurementId,payload.energy,payload.hunger,payload.soreness,payload.stress,payload.trainingIntent,payload.trainingCompleted,payload.nutritionAdherent,payload.proteinTargetMet,payload.stepsTargetMet,payload.notes,payload.nextCheckpointAt,payload.source,payload.sourceRef,payload.supersedesId,ts,ts);
    if(payload.supersedesId)db.prepare("UPDATE health_checkins SET status='superseded',updated_at=? WHERE id=?").run(ts,payload.supersedesId);return Number(inserted.lastInsertRowid);
  }).immediate()});
}

export function logSubstance(input:SubstanceInput){
  const idempotencyKey=key(input.idempotencyKey);if(input.substance!=="alcohol"&&input.substance!=="cannabis")throw new HealthValidationError("substance must be alcohol or cannabis");
  const payload={occurredAt:isoDateTime(input.occurredAt,"occurredAt"),substance:input.substance,amount:nullableNumber(input.amount,"amount",{min:0}),unit:input.unit?optionalText(input.unit,80):null,standardDrinks:nullableNumber(input.standardDrinks,"standardDrinks",{min:0}),thcMg:nullableNumber(input.thcMg,"thcMg",{min:0}),cbdMg:nullableNumber(input.cbdMg,"cbdMg",{min:0}),timingContext:input.timingContext?optionalText(input.timingContext,300):null,context:optionalText(input.context,2000),estimated:!!input.estimated,source:source(input.source),sourceRef:input.sourceRef?optionalText(input.sourceRef,500):null,supersedesId:boundedId(input.supersedesId,"supersedesId")};
  const hash=commandHash(payload);
  return withReplay("health_substance_events",idempotencyKey,hash,()=>{const db=getDb();return db.transaction(()=>{correctionTarget("health_substance_events",payload.supersedesId,"substance event");const ts=nowIso();
    const inserted=db.prepare(`INSERT INTO health_substance_events (idempotency_key,payload_hash,occurred_at,substance,amount,unit,standard_drinks,thc_mg,cbd_mg,timing_context,context,estimated,source,source_ref,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(idempotencyKey,hash,payload.occurredAt,payload.substance,payload.amount,payload.unit,payload.standardDrinks,payload.thcMg,payload.cbdMg,payload.timingContext,payload.context,payload.estimated?1:0,payload.source,payload.sourceRef,payload.supersedesId,ts,ts);
    if(payload.supersedesId)db.prepare("UPDATE health_substance_events SET status='superseded',updated_at=? WHERE id=?").run(ts,payload.supersedesId);return Number(inserted.lastInsertRowid);
  }).immediate()});
}

export function logBodyMeasurement(input:BodyMeasurementInput){
  const idempotencyKey=key(input.idempotencyKey),weightKg=nullableNumber(input.weightKg,"weightKg",{min:0.01}),bodyFatPct=nullableNumber(input.bodyFatPct,"bodyFatPct",{min:0,max:100}),leanMassKg=nullableNumber(input.leanMassKg,"leanMassKg",{min:0.01}),waistCm=nullableNumber(input.waistCm,"waistCm",{min:0.01});
  if([weightKg,bodyFatPct,leanMassKg,waistCm].every(v=>v==null))throw new HealthValidationError("at least one body measurement is required");
  const payload={measuredAt:isoDateTime(input.measuredAt,"measuredAt"),weightKg,bodyFatPct,leanMassKg,waistCm,context:optionalText(input.context,2000),estimated:!!input.estimated,source:source(input.source),externalId:input.externalId?optionalText(input.externalId,240):null,sourcePayload:input.sourcePayload===undefined?null:input.sourcePayload,supersedesId:boundedId(input.supersedesId,"supersedesId")};const hash=commandHash(payload);
  return withReplay("health_body_measurements",idempotencyKey,hash,()=>{const db=getDb();return db.transaction(()=>{correctionTarget("health_body_measurements",payload.supersedesId,"body measurement");const ts=nowIso();
    const inserted=db.prepare(`INSERT INTO health_body_measurements (idempotency_key,payload_hash,measured_at,weight_kg,body_fat_pct,lean_mass_kg,waist_cm,context,estimated,source,external_id,source_payload,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(idempotencyKey,hash,payload.measuredAt,payload.weightKg,payload.bodyFatPct,payload.leanMassKg,payload.waistCm,payload.context,payload.estimated?1:0,payload.source,payload.externalId,payload.sourcePayload==null?null:JSON.stringify(payload.sourcePayload),payload.supersedesId,ts,ts);
    if(payload.supersedesId)db.prepare("UPDATE health_body_measurements SET status='superseded',updated_at=? WHERE id=?").run(ts,payload.supersedesId);return Number(inserted.lastInsertRowid);
  }).immediate()});
}

export function logRecommendation(input:RecommendationInput){
  const idempotencyKey=key(input.idempotencyKey);if(!RECOMMENDATION_CATEGORIES.has(input.category))throw new HealthValidationError("invalid recommendation category");const status=input.status??"active";if(!RECOMMENDATION_STATUSES.has(status))throw new HealthValidationError("invalid recommendation status");
  const payload={category:input.category,action:requiredText(input.action,"action",2000),rationale:requiredText(input.rationale,"rationale",4000),inputsAsOf:isoDateTime(input.inputsAsOf,"inputsAsOf"),provenance:input.provenance??[],status,expiresAt:input.expiresAt?isoDateTime(input.expiresAt,"expiresAt"):null,source:source(input.source,"trainer")};const hash=commandHash(payload);
  return withReplay("health_recommendations",idempotencyKey,hash,()=>Number(getDb().prepare(`INSERT INTO health_recommendations (idempotency_key,payload_hash,category,action,rationale,inputs_as_of,provenance_json,status,expires_at,source) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(idempotencyKey,hash,payload.category,payload.action,payload.rationale,payload.inputsAsOf,JSON.stringify(payload.provenance),payload.status,payload.expiresAt,payload.source).lastInsertRowid));
}

export function updateRecommendationStatus(id:number,status:RecommendationInput["status"]){const recommendationId=boundedId(id,"id");if(!recommendationId||!status||!RECOMMENDATION_STATUSES.has(status))throw new HealthValidationError("invalid recommendation id or status");const changed=getDb().prepare("UPDATE health_recommendations SET status=?,updated_at=? WHERE id=?").run(status,nowIso(),recommendationId);if(!changed.changes)throw new HealthValidationError("recommendation not found",404);return {id:recommendationId,status}}
