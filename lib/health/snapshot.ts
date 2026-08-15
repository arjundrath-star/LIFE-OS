import { all, get, nowIso } from "@/db";
import { isConnectionEnabled } from "@/lib/connections/enabled";
import { hasSecret } from "@/lib/secrets";
import { estimatedOneRepMax, progressionDecision } from "@/lib/health/progression";
import { publicRecommendation } from "@/lib/health/public";
import { dayInTimeZone } from "@/lib/health/validation";
import { hevyConnectionDetail, sanitizeHevyError } from "@/lib/health/hevy-errors";
import {
  sanitizeWhoopAuthError,
  sanitizeWhoopDataError,
  whoopConnectionDetail,
} from "@/lib/health/whoop-errors";
import type { ConnectionHealth, FreshnessState, Metric, ProgressionSession, ProjectedBodyMeasurement } from "@/lib/health/types";

const HOUR=3_600_000;const DAY=24*HOUR;
function ageHours(value:string|null,asOf:string){if(!value)return null;const age=(Date.parse(asOf)-Date.parse(value))/HOUR;return Number.isFinite(age)?Math.max(0,+age.toFixed(1)):null}
function freshness(value:string|null,asOf:string,freshHours:number,broken=false):FreshnessState{if(broken)return "broken";const age=ageHours(value,asOf);if(age==null)return "missing";return age<=freshHours?"fresh":"stale"}
function metric<T>(value:T|null,metricAt:string|null,asOf:string,freshHours:number,broken=false,estimated=false):Metric<T>{return {value,asOf:metricAt,freshness:value==null?"missing":freshness(metricAt,asOf,freshHours,broken),ageHours:ageHours(metricAt,asOf),...(estimated?{estimated:true}:{})}}
function latestWhoop(column:string,timestampColumn:string){return get<any>(`SELECT day,${column} value,COALESCE(${timestampColumn},ts) updatedAt FROM whoop_daily WHERE ${column} IS NOT NULL ORDER BY day DESC LIMIT 1`)??null}
function boolOrNull(value:unknown):boolean|null{return value==null?null:!!value}
function safeJson(value:string|null,fallback:unknown){try{return value?JSON.parse(value):fallback}catch{return fallback}}

function connectionStatus(source:"whoop"|"hevy",asOf:string){
  const enabled=isConnectionEnabled(source);const configured=source==="whoop"?hasSecret("WHOOP_CLIENT_ID")&&hasSecret("WHOOP_CLIENT_SECRET"):hasSecret("HEVY_API_KEY");
  if(!enabled)return {status:"disconnected" as ConnectionHealth,enabled:false,configured,detail:"Disabled in Connections",lastSuccessAt:null,lastError:null};
  if(source==="whoop"){
    const row=get<any>("SELECT first_name,email,refresh_token_enc,last_sync,last_error,auth_error FROM whoop_tokens WHERE enabled=1 ORDER BY connected_at DESC,user_id DESC LIMIT 1");
    if(!row?.refresh_token_enc)return {status:"disconnected" as ConnectionHealth,enabled:true,configured,detail:"Not authorized",lastSuccessAt:null,lastError:null,athlete:null};
    const authError=sanitizeWhoopAuthError(row.auth_error),dataSyncError=sanitizeWhoopDataError(row.last_error),error=authError||dataSyncError;
    const status:ConnectionHealth=error?"broken":!row.last_sync||(ageHours(row.last_sync,asOf)??Infinity)>36?"stale":"healthy";
    return {status,enabled:true,configured:true,detail:whoopConnectionDetail(authError,dataSyncError)||(status==="stale"?"Authorized, but fresh WHOOP data is unavailable":"WHOOP API data is current"),lastSuccessAt:row.last_sync??null,lastError:error,authError,dataSyncError,athlete:row.first_name||row.email||null};
  }
  const sync=get<any>("SELECT account_identity,last_success_at,last_attempt_at,last_error,records_seen,records_changed FROM health_sync_state WHERE source='hevy'");
  if(!configured)return {status:"disconnected" as ConnectionHealth,enabled:true,configured:false,detail:"HEVY_API_KEY is not configured",lastSuccessAt:null,lastError:null};
  if(!sync?.account_identity)return {status:"disconnected" as ConnectionHealth,enabled:true,configured:true,detail:"Credential configured, awaiting account verification and initial sync",lastSuccessAt:null,lastAttemptAt:sync?.last_attempt_at??null,lastError:null,recordsSeen:0,recordsChanged:0};
  const error=sanitizeHevyError(sync?.last_error);const status:ConnectionHealth=error?"broken":!sync?.last_success_at||(ageHours(sync.last_success_at,asOf)??Infinity)>6?"stale":"healthy";
  return {status,enabled:true,configured,detail:hevyConnectionDetail(error)||(status==="stale"?"Configured, awaiting a fresh successful sync":"Hevy API data is current"),lastSuccessAt:sync?.last_success_at??null,lastAttemptAt:sync?.last_attempt_at??null,lastError:error,recordsSeen:sync?.records_seen??0,recordsChanged:sync?.records_changed??0};
}

function isStrengthActivity(row:any){return row.source==="hevy"||/weight|strength|powerlift|crossfit|functional fitness/i.test(row.title||"")}
function overlaps(a:any,b:any){
  const aStart=Date.parse(a.startedAt),bStart=Date.parse(b.startedAt),parsedAEnd=a.endedAt?Date.parse(a.endedAt):NaN,parsedBEnd=b.endedAt?Date.parse(b.endedAt):NaN;
  const aDuration=Number(a.durationSeconds)||0,bDuration=Number(b.durationSeconds)||0;
  const aEnd=Number.isFinite(parsedAEnd)?parsedAEnd:aStart+aDuration*1000,bEnd=Number.isFinite(parsedBEnd)?parsedBEnd:bStart+bDuration*1000;
  if(![aStart,bStart,aEnd,bEnd].every(Number.isFinite))return false;
  const intersection=Math.max(0,Math.min(aEnd,bEnd)-Math.max(aStart,bStart)),shorter=Math.max(1,Math.min(aEnd-aStart,bEnd-bStart));
  if(intersection/shorter>=0.5)return true;
  const titleEvidence=/weight|strength|powerlift|crossfit|functional fitness/i.test(`${a.title} ${b.title}`),durationSimilar=aDuration>0&&bDuration>0&&Math.abs(aDuration-bDuration)<=Math.max(600,Math.min(aDuration,bDuration)*0.25);
  return Math.abs(aStart-bStart)<=15*60_000&&titleEvidence&&durationSimilar&&intersection>0;
}

function buildHealthSnapshot(asOf:string,includePrivateDetails:boolean){
  const whoopConnection=connectionStatus("whoop",asOf),hevyConnection=connectionStatus("hevy",asOf);const whoopBroken=whoopConnection.status==="broken";
  const whoopAccountIdentity=get<any>("SELECT account_identity accountIdentity FROM health_sync_state WHERE source='whoop'")?.accountIdentity??null,hevyAccountIdentity=get<any>("SELECT account_identity accountIdentity FROM health_sync_state WHERE source='hevy'")?.accountIdentity??null;
  const recovery=latestWhoop("recovery","recovery_updated_at"),hrv=latestWhoop("hrv_ms","recovery_updated_at"),rhr=latestWhoop("rhr_bpm","recovery_updated_at"),sleep=latestWhoop("sleep_hours","sleep_updated_at"),sleepPerformance=latestWhoop("sleep_performance","sleep_updated_at"),sleepEfficiency=latestWhoop("sleep_efficiency","sleep_updated_at"),strain=latestWhoop("strain","strain_updated_at"),cycleEnergy=latestWhoop("cycle_energy_kj","strain_updated_at");
  const whoop={connection:whoopConnection,recovery:metric<number>(recovery?.value??null,recovery?.updatedAt??recovery?.day??null,asOf,36,whoopBroken),hrv:metric<number>(hrv?.value??null,hrv?.updatedAt??hrv?.day??null,asOf,36,whoopBroken),rhr:metric<number>(rhr?.value??null,rhr?.updatedAt??rhr?.day??null,asOf,36,whoopBroken),sleepHours:metric<number>(sleep?.value??null,sleep?.updatedAt??sleep?.day??null,asOf,48,whoopBroken),sleepPerformance:metric<number>(sleepPerformance?.value??null,sleepPerformance?.updatedAt??sleepPerformance?.day??null,asOf,48,whoopBroken),sleepEfficiency:metric<number>(sleepEfficiency?.value??null,sleepEfficiency?.updatedAt??sleepEfficiency?.day??null,asOf,48,whoopBroken),strain:metric<number>(strain?.value??null,strain?.updatedAt??strain?.day??null,asOf,36,whoopBroken),energyKj:metric<number>(cycleEnergy?.value??null,cycleEnergy?.updatedAt??cycleEnergy?.day??null,asOf,36,whoopBroken,true),history:all<any>(`SELECT day,recovery,hrv_ms hrv,rhr_bpm rhr,sleep_hours sleepHours,sleep_performance sleepPerformance,sleep_efficiency sleepEfficiency,strain,cycle_energy_kj energyKj,COALESCE(recovery_updated_at,ts) recoveryAt,COALESCE(sleep_updated_at,ts) sleepAt,COALESCE(strain_updated_at,ts) strainAt FROM whoop_daily ORDER BY day DESC LIMIT 14`).reverse()};

  const storedBody=all<any>("SELECT id,COALESCE(source_external_id,external_id) externalId,measured_at measuredAt,weight_kg weightKg,body_fat_pct bodyFatPct,lean_mass_kg leanMassKg,waist_cm waistCm,context,estimated,source,observation_at_known observationAtKnown FROM health_body_measurements WHERE deleted_at IS NULL AND status='active' AND (source NOT IN ('whoop','hevy') OR (source='whoop' AND source_account_identity=?) OR (source='hevy' AND source_account_identity=?)) ORDER BY measured_at DESC LIMIT 30",whoopAccountIdentity,hevyAccountIdentity);
  const body:ProjectedBodyMeasurement[]=storedBody.map(row=>({...row,measuredAt:row.observationAtKnown===0?null:row.measuredAt}));
  const weights=body.filter(row=>row.weightKg!=null),latestWeight=weights[0]??null,knownWeights=weights.filter(row=>row.observationAtKnown!==0&&row.measuredAt!=null),comparisonWeight=latestWeight?.measuredAt?knownWeights.find(row=>row.id!==latestWeight.id&&row.measuredAt!=null&&Date.parse(row.measuredAt)<=Date.parse(latestWeight.measuredAt!)-7*DAY)??knownWeights[knownWeights.length-1]??null:null;
  const weightDelta=latestWeight?.measuredAt&&comparisonWeight?.measuredAt&&latestWeight.id!==comparisonWeight.id?+(latestWeight.weightKg!-comparisonWeight.weightKg!).toFixed(2):null;const weightFreshness:FreshnessState=latestWeight?.observationAtKnown===0?"unknown":freshness(latestWeight?.measuredAt??null,asOf,8*24);

  const today=dayInTimeZone(asOf),mealWindowStart=new Date(Date.parse(asOf)-36*HOUR).toISOString(),mealWindowEnd=new Date(Date.parse(asOf)+12*HOUR).toISOString();
  const meals=all<any>(`SELECT id,meal_at mealAt,meal_type mealType,description,calories_low caloriesLow,calories_high caloriesHigh,calories_selected caloriesSelected,protein_low_g proteinLowG,protein_high_g proteinHighG,protein_selected_g proteinSelectedG,confidence,assumptions FROM health_meals WHERE status='active' AND meal_at BETWEEN ? AND ? ORDER BY meal_at`,mealWindowStart,mealWindowEnd).filter(meal=>dayInTimeZone(meal.mealAt)===today);
  const sumKnown=(field:string)=>meals.length>0&&meals.every(row=>row[field]!=null)?meals.reduce((total,row)=>total+Number(row[field]),0):null,rounded=(value:number|null)=>value==null?null:+value.toFixed(1);
  const nutrition={day:today,meals,calories:{low:sumKnown("caloriesLow"),high:sumKnown("caloriesHigh"),selected:sumKnown("caloriesSelected")},proteinG:{low:rounded(sumKnown("proteinLowG")),high:rounded(sumKnown("proteinHighG")),selected:rounded(sumKnown("proteinSelectedG"))},complete:meals.length>0&&meals.every(row=>row.caloriesLow!=null&&row.caloriesHigh!=null&&row.proteinLowG!=null&&row.proteinHighG!=null)};

  const workoutRows=all<any>(`SELECT w.id,w.source,COALESCE(w.source_external_id,w.external_id) externalId,w.title,w.started_at startedAt,w.ended_at endedAt,w.duration_seconds durationSeconds,w.strain,w.energy_kj energyKj,w.energy_estimated energyEstimated,CASE WHEN w.source='whoop' AND COUNT(DISTINCT e.id)=0 THEN NULL ELSE COUNT(DISTINCT e.id) END exercises,CASE WHEN w.source='whoop' AND COUNT(s.id)=0 THEN NULL ELSE COUNT(s.id) END sets,CASE WHEN w.source='whoop' AND COUNT(s.id)=0 THEN NULL ELSE COALESCE(SUM(CASE WHEN s.weight_kg IS NOT NULL AND s.reps IS NOT NULL THEN s.weight_kg*s.reps ELSE 0 END),0) END volumeKg FROM health_workouts w LEFT JOIN health_workout_exercises e ON e.workout_id=w.id LEFT JOIN health_workout_sets s ON s.exercise_id=e.id WHERE w.deleted_at IS NULL AND (w.source NOT IN ('whoop','hevy') OR (w.source='whoop' AND w.source_account_identity=?) OR (w.source='hevy' AND w.source_account_identity=?)) GROUP BY w.id ORDER BY w.started_at DESC LIMIT 50`,whoopAccountIdentity,hevyAccountIdentity);
  const hevyRows=workoutRows.filter(row=>row.source==="hevy"),whoopRows=workoutRows.filter(row=>row.source==="whoop"),matchedWhoop=new Set<number>();
  const liftSessions=hevyRows.map(row=>{const match=whoopRows.find(candidate=>!matchedWhoop.has(candidate.id)&&isStrengthActivity(candidate)&&overlaps(row,candidate));if(match){matchedWhoop.add(match.id);return {...row,strain:row.strain??match.strain,energyKj:row.energyKj??match.energyKj,observedBy:["hevy","whoop"]}}return {...row,observedBy:["hevy"]}});
  for(const row of whoopRows)if(!matchedWhoop.has(row.id)&&isStrengthActivity(row))liftSessions.push({...row,observedBy:["whoop"]});
  liftSessions.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const activities=whoopRows.filter(row=>!matchedWhoop.has(row.id)&&!isStrengthActivity(row)).map(row=>({...row,observedBy:["whoop"]}));
  const recentWorkouts=[...liftSessions.map(row=>({...row,kind:"strength"})),...activities.map(row=>({...row,kind:"activity"}))].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,12);
  const weekStart=new Date(Date.parse(asOf)-7*DAY).toISOString(),weeklyLifts=liftSessions.filter(row=>row.startedAt>=weekStart),weeklyVolume=weeklyLifts.filter(row=>row.source==="hevy").reduce((sum,row)=>sum+Number(row.volumeKg||0),0);
  const liftRows=all<any>(`SELECT e.exercise_template_id templateId,e.title,w.started_at at,s.weight_kg weightKg,s.reps,s.rpe,s.rir,s.target_reps_min targetMin,s.target_reps_max targetMax FROM health_workout_sets s JOIN health_workout_exercises e ON e.id=s.exercise_id JOIN health_workouts w ON w.id=e.workout_id WHERE w.source='hevy' AND w.source_account_identity=? AND w.deleted_at IS NULL AND s.completed IS NOT 0 AND s.set_type NOT IN ('warmup') AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL ORDER BY w.started_at DESC,s.set_order`,hevyAccountIdentity);
  const liftGroups=new Map<string,any[]>();for(const row of liftRows){const key=row.templateId||row.title.toLowerCase(),group=liftGroups.get(key)||[];group.push({...row,e1rm:estimatedOneRepMax(row.weightKg,row.reps)});liftGroups.set(key,group)}
  const liftTrends=[...liftGroups.entries()].map(([key,rows])=>{const sessionsByAt=new Map<string,any[]>();for(const row of rows){const group=sessionsByAt.get(row.at)||[];group.push(row);sessionsByAt.set(row.at,group)}const sessions:ProgressionSession[]=[...sessionsByAt.entries()].map(([at,sets])=>({at,sets}));const e1rms=rows.map(row=>row.e1rm).filter((value):value is number=>value!=null),latestSession=[...sessionsByAt.values()][0]||[],latestE1rm=Math.max(...latestSession.map(row=>row.e1rm??0),0)||null,priorBest=Math.max(...rows.filter(row=>row.at!==rows[0]?.at).map(row=>row.e1rm??0),0)||null;return {key,title:rows[0].title,sessions:sessions.length,latestAt:rows[0].at,latestE1rm,bestE1rm:e1rms.length?Math.max(...e1rms):null,workingWeightKg:rows[0].weightKg,progression:progressionDecision(sessions,asOf),isPr:latestE1rm!=null&&(priorBest==null||latestE1rm>priorBest)}}).slice(0,12);
  const prs=liftTrends.filter(row=>row.isPr).map(row=>({exercise:row.title,e1rmKg:row.latestE1rm,at:row.latestAt,estimated:true}));

  const checkinRow=get<any>("SELECT * FROM health_checkins WHERE status='active' ORDER BY effective_at DESC LIMIT 1"),checkin=checkinRow?{id:checkinRow.id,effectiveAt:checkinRow.effective_at,effectiveDay:checkinRow.effective_day,energy:checkinRow.energy,hunger:checkinRow.hunger,soreness:checkinRow.soreness,stress:checkinRow.stress,trainingIntent:checkinRow.training_intent,trainingCompleted:boolOrNull(checkinRow.training_completed),nutritionAdherent:boolOrNull(checkinRow.nutrition_adherent),proteinTargetMet:boolOrNull(checkinRow.protein_target_met),stepsTargetMet:boolOrNull(checkinRow.steps_target_met),notes:checkinRow.notes,nextCheckpointAt:checkinRow.next_checkpoint_at}:null;
  const substances=all<any>("SELECT substance,occurred_at occurredAt,amount,unit,standard_drinks standardDrinks,thc_mg thcMg,cbd_mg cbdMg,timing_context timingContext,context,estimated FROM health_substance_events WHERE status='active' AND occurred_at>=? ORDER BY occurred_at DESC",weekStart);
  const alcoholEvents=substances.filter(event=>event.substance==="alcohol"),standardizedAmountKnown=alcoholEvents.every(event=>event.standardDrinks!=null);
  const substanceSummary:any={private:true,windowDays:7,eventCount:substances.length,alcoholEvents:alcoholEvents.length,cannabisEvents:substances.filter(event=>event.substance==="cannabis").length,knownStandardDrinks:standardizedAmountKnown?+alcoholEvents.reduce((sum,event)=>sum+Number(event.standardDrinks),0).toFixed(1):null,standardizedAmountKnown,unknownAmountEvents:substances.filter(event=>event.amount==null&&event.standardDrinks==null&&event.thcMg==null&&event.cbdMg==null).length};if(includePrivateDetails)substanceSummary.events=substances;

  const recommendationRow=get<any>("SELECT * FROM health_recommendations WHERE status IN ('active','accepted','review_needed') ORDER BY created_at DESC LIMIT 1");
  const mapRecommendation=(row:any)=>row?{id:row.id,category:row.category,action:row.action,rationale:row.rationale,inputsAsOf:row.inputs_as_of,provenance:safeJson(row.provenance_json,[]),status:row.status,expiresAt:row.expires_at,source:row.source}:null;
  const latestRecommendation=mapRecommendation(recommendationRow);let recommendationWarning:string|null=null;
  if(latestRecommendation){const provenanceText=JSON.stringify(latestRecommendation.provenance).toLowerCase();if(latestRecommendation.expiresAt&&Date.parse(latestRecommendation.expiresAt)<=Date.parse(asOf))recommendationWarning="expired";else if((ageHours(latestRecommendation.inputsAsOf,asOf)??Infinity)>36)recommendationWarning="inputs are stale";else if(provenanceText.includes("whoop")&&whoopConnection.status!=="healthy")recommendationWarning=`WHOOP evidence is ${whoopConnection.status}`;else if(provenanceText.includes("hevy")&&hevyConnection.status!=="healthy")recommendationWarning=`Hevy evidence is ${hevyConnection.status}`;else if(latestRecommendation.status==="review_needed")recommendationWarning="requires review"}
  const recommendation=latestRecommendation&&!recommendationWarning?{...latestRecommendation,current:true}:null,recommendationHistory=latestRecommendation?{...latestRecommendation,current:!recommendationWarning,warning:recommendationWarning}:null;

  const warnings:string[]=[];if(whoopConnection.status!=="healthy")warnings.push(`WHOOP ${whoopConnection.status}`);if(hevyConnection.status!=="healthy")warnings.push(`Hevy ${hevyConnection.status}`);if(whoop.recovery.freshness!=="fresh")warnings.push("No fresh readiness evidence; readiness claims are withheld");if(!nutrition.complete)warnings.push("Today's nutrition estimate is incomplete");if(recommendationWarning)warnings.push(`Latest recommendation is not current: ${recommendationWarning}`);
  const qualityStatus=whoopConnection.status==="broken"||hevyConnection.status==="broken"?"broken":warnings.length?"limited":"good";
  const readinessAvailable=whoopConnection.status==="healthy"&&whoop.recovery.freshness==="fresh";
  const exposedRecommendation=includePrivateDetails?recommendation:publicRecommendation(recommendation,asOf),exposedHistory=includePrivateDetails?recommendationHistory:publicRecommendation(recommendationHistory,asOf);
  return {generatedAt:asOf,dataQuality:{status:qualityStatus,warnings},connections:{whoop:whoopConnection,hevy:hevyConnection},readiness:{available:readinessAvailable,reason:readinessAvailable?"Healthy WHOOP connection and fresh recovery evidence are available":"Readiness withheld because WHOOP is not healthy or recovery evidence is stale, missing, or broken",recovery:whoop.recovery,recommendation:exposedRecommendation},whoop,body:{latest:latestWeight,latestFreshness:weightFreshness,latestAgeHours:latestWeight?.measuredAt?ageHours(latestWeight.measuredAt,asOf):null,weightDeltaKg:weightDelta,trendBasis:latestWeight?.measuredAt&&comparisonWeight?.measuredAt?{from:comparisonWeight.measuredAt,to:latestWeight.measuredAt}:null,history:body},nutrition,training:{recentWorkouts,liftSessions:liftSessions.slice(0,12),activities:activities.slice(0,12),weekly:{frequency:weeklyLifts.length,volumeKg:+weeklyVolume.toFixed(1),windowDays:7,coverage:hevyConnection.status==="healthy"?"complete":weeklyLifts.length?"partial":"unknown"},liftTrends,prs},checkin,substances:substanceSummary,recommendation:exposedRecommendation,recommendationHistory:exposedHistory};
}

export function healthSnapshot(asOf=nowIso()){return buildHealthSnapshot(asOf,false)}
export function privateHealthSnapshot(asOf=nowIso()){return buildHealthSnapshot(asOf,true)}
/** Authenticated browser projection: trainer/check-in detail is retained, raw substance events are not. */
export function dashboardHealthSnapshot(asOf=nowIso()){
  const snapshot=buildHealthSnapshot(asOf,true);const {events:_events,...substances}=snapshot.substances;
  return {...snapshot,substances};
}
export type HealthSnapshot=ReturnType<typeof healthSnapshot>;
