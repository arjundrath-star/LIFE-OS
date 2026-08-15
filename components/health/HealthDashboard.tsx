"use client";
import { useEffect, useState } from "react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Badge } from "@/components/ui";
import { EmptyState } from "@/components/Panel";
import { useConnStatus, useLiveData } from "@/hooks/useLiveData";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { selectCurrentHealthSnapshot } from "@/lib/health/client-freshness";
import { timeAgo } from "@/lib/time";
import { Activity, Apple, BarChart3, CheckCircle2, Dumbbell, Gauge, HeartPulse, Lock, Moon, Scale, ShieldCheck, TriangleAlert, Wine } from "lucide-react";

const fmt=(value:number|null|undefined,digits=0)=>value==null?"—":Number(value).toFixed(digits);
const pounds=(kg:number|null|undefined)=>kg==null?"—":`${(kg*2.20462262).toFixed(1)} lb`;
const tone=(state:string|undefined)=>state==="healthy"||state==="fresh"?"healthy":state==="broken"?"error":state==="stale"||state==="limited"?"warn":"off";

function Fresh({state,asOf}:{state:string;asOf?:string|null}){
  return <Badge tone={tone(state) as any} className="!normal-case">{state}{asOf?` · ${timeAgo(asOf)}`:""}</Badge>;
}
function Trend({rows,field,label,unit,color="bg-accent"}:{rows:any[];field:string;label:string;unit:string;color?:string}){
  const values=rows.map(row=>row[field]).filter((value):value is number=>typeof value==="number");
  if(!values.length)return <div className="py-5 text-center text-xs text-txt-faint">No trend data yet</div>;
  const min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,1);
  const latest=[...rows].reverse().find(row=>typeof row[field]==="number");
  const dated=rows.filter(row=>typeof row[field]==="number").map(row=>`${row.day}: ${row[field]}${unit}`).join("; ");
  const summary=`${label} trend: ${values.length} readings, minimum ${min}${unit}, maximum ${max}${unit}${latest?`, latest ${latest[field]}${unit} on ${latest.day}`:""}. ${dated}`;
  return <div className="mt-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/70" role="img" aria-label={summary} tabIndex={0}><span className="sr-only">{summary}</span><div className="flex h-20 items-end gap-1" aria-hidden="true">
    {rows.map((row,index)=>{
      const value=row[field];const height=value==null?4:18+((value-min)/span)*62;
      return <div key={`${row.day}-${index}`} className="group relative flex min-w-0 flex-1 items-end" title={`${row.day}: ${value ?? "unknown"}`}><div className={cn("w-full rounded-t-sm opacity-80 transition-opacity group-hover:opacity-100",value==null?"bg-border":color)} style={{height}} /></div>;
    })}
  </div><div className="mt-1 text-[10px] text-txt-faint">range {fmt(min,1)}–{fmt(max,1)} · latest {latest?`${fmt(latest[field],1)} (${latest.day})`:"unknown"}</div></div>;
}
function ConnectionCard({name,data}:{name:string;data:any}){
  return <div className="rounded-inner border border-border/70 bg-panel-2/30 p-3">
    <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-txt-primary">{name}</span><Fresh state={data?.status ?? "disconnected"} asOf={data?.lastSuccessAt}/></div>
    <p className="mt-2 text-xs text-txt-muted">{data?.detail ?? "No connection information"}</p>
  </div>;
}
function Tri({label,value}:{label:string;value:boolean|null|undefined}){
  return <div className="flex items-center justify-between border-b border-border/50 py-2 text-xs last:border-0"><span className="text-txt-muted">{label}</span><span className={value===true?"text-healthy":value===false?"text-warn":"text-txt-faint"}>{value===true?"yes":value===false?"no":"unknown"}</span></div>;
}

export function HealthDashboard(){
  const liveSnap=useLiveData<any>("health");
  const transport=useConnStatus();
  const {data:privateSnap,loading:restLoading,error:restError,succeeded:restSucceeded,refetch}=useApi<any>("/api/health");
  const [nowMs,setNowMs]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNowMs(Date.now()),30_000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{if(liveSnap?.generatedAt)void refetch()},[liveSnap?.generatedAt,refetch]);
  const selection=selectCurrentHealthSnapshot({live:liveSnap,rest:privateSnap,transport,restRequestSucceeded:restSucceeded,restLoading,nowMs});
  const snap=selection.snapshot;
  const fallbackNeeded=selection.source!=="live";
  useEffect(()=>{if(!fallbackNeeded)return;void refetch();const timer=setInterval(()=>refetch(),30_000);return()=>clearInterval(timer)},[fallbackNeeded,refetch]);
  if(!snap)return <ProjectPage title="Health" icon={<Activity size={18}/>} subtitle="Structured trainer control plane" statusDot={transport==="closed"?"error":"off"} statusLabel={transport==="closed"?"live transport unavailable":"loading live snapshot"}><Section><div className="py-12 text-center text-sm text-txt-faint">{transport==="closed"?"The live WebSocket transport is unavailable; source connection state is not yet known.":"Waiting for the first authenticated live snapshot…"}</div></Section></ProjectPage>;
  const whoop=snap.whoop,readiness=snap.readiness,weight=snap.body?.latest,nutrition=snap.nutrition,training=snap.training;
  const usingRestFallback=selection.source==="rest";
  const statusDot=transport!=="open"&&!usingRestFallback?"error":snap.dataQuality?.status==="good"?"healthy":snap.dataQuality?.status==="broken"?"error":"warn";
  const recommendation=snap.recommendation,latestRecommendation=snap.recommendationHistory;
  return <ProjectPage
    title="Health · Trainer control plane"
    icon={<Activity size={18}/>} statusDot={statusDot} statusLabel={selection.source==="live"?`${snap.dataQuality?.status ?? "limited"} data quality · live transport`:usingRestFallback?`${snap.dataQuality?.status ?? "limited"} data quality · REST fallback`:`transport offline · cached data not live`}
    subtitle="Structured nutrition, check-ins, lifting, body composition, and wearable evidence. Unknown stays unknown; stale data never becomes a readiness claim."
    hero={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <HeroStat label="Readiness" value={readiness?.available?`${fmt(readiness.recovery.value)}%`:"withheld"} tone={readiness?.available?(readiness.recovery.value>=67?"healthy":readiness.recovery.value>=34?"warn":"error"):"muted"} sub={readiness?.reason}/>
      <HeroStat label="Sleep" value={`${fmt(whoop?.sleepHours?.value,1)}h`} sub={whoop?.sleepHours?.freshness==="fresh"?(whoop?.sleepPerformance?.value==null?"performance unknown":`${fmt(whoop.sleepPerformance.value)}% performance`):`last recorded ${whoop?.sleepHours?.asOf?timeAgo(whoop.sleepHours.asOf):"unknown"} · ${whoop?.sleepHours?.freshness ?? "missing"}`}/>
      <HeroStat label="Weight" value={pounds(weight?.weightKg)} sub={weight?.observationAtKnown===0?"WHOOP profile value · observation date unknown":weight?.measuredAt?`${snap.body?.latestFreshness==="fresh"?"recorded":"last recorded"} ${timeAgo(weight.measuredAt)} · ${snap.body?.latestFreshness}`:"no measurement recorded"} tone={snap.body?.weightDeltaKg!=null&&snap.body.weightDeltaKg<0?"healthy":"primary"}/>
      <HeroStat label="Today · calories" value={nutrition?.meals?.length?`${fmt(nutrition.calories.low)}–${fmt(nutrition.calories.high)}`:"—"} sub={`${nutrition?.meals?.length ?? 0} logged meal${nutrition?.meals?.length===1?"":"s"}`}/>
      <HeroStat label="Rolling 7 days" value={training?.weekly?.coverage==="unknown"?"—":`${training?.weekly?.frequency ?? 0} strength sessions`} sub={training?.weekly?.coverage==="unknown"?"training coverage unavailable":`${fmt(training?.weekly?.volumeKg,0)} kg Hevy volume · ${training?.weekly?.coverage}`} tone="accent"/>
    </div>}
  >
    {transport!=="open"&&<div className="rounded-inner border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">{usingRestFallback?`WebSocket ${transport}; authenticated REST fallback generated ${snap.generatedAt}.`:`WebSocket ${transport}; retained values are not live${restLoading?" and REST fallback is loading":restError?` (${restError})`:""}.`}</div>}
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <Section title="Today · readiness and action" icon={<Gauge size={13}/>}>
        <div className="flex flex-wrap items-center gap-2"><Fresh state={whoop?.recovery?.freshness ?? "missing"} asOf={whoop?.recovery?.asOf}/>{!readiness?.available&&<Badge tone="warn"><TriangleAlert size={10}/> no readiness claim</Badge>}</div>
        {recommendation?<div className="mt-4 rounded-inner border border-accent/30 bg-accent/5 p-4"><div className="font-mono text-[10px] uppercase tracking-widest text-accent">{recommendation.category} · {recommendation.status}</div><h3 className="mt-2 text-base text-txt-primary">{recommendation.action}</h3><p className="mt-1 text-sm leading-relaxed text-txt-muted">{recommendation.rationale}</p><div className="mt-2 font-mono text-[10px] text-txt-faint">inputs as of {recommendation.inputsAsOf} · source {recommendation.source}</div>{recommendation.provenance?.length>0&&<div className="mt-1 text-[10px] text-txt-faint">provenance: {recommendation.provenance.map((item:any)=>typeof item==="string"?item:JSON.stringify(item)).join(" · ")}</div>}</div>:latestRecommendation?<div className="mt-4 rounded-inner border border-warn/30 bg-warn/5 p-4"><Badge tone="warn">not a current action · {latestRecommendation.warning}</Badge><h3 className="mt-2 text-sm text-txt-primary">{latestRecommendation.action}</h3><p className="mt-1 text-xs text-txt-muted">Retained for history; inputs as of {latestRecommendation.inputsAsOf}.</p></div>:<EmptyState title="No active recommendation" hint="The trainer can write one through the approved health-log CLI after reviewing current evidence."/>}
      </Section>
      <Section title="Connection and data quality" icon={<ShieldCheck size={13}/>} right={<Badge tone={tone(snap.dataQuality?.status) as any}>{snap.dataQuality?.status}</Badge>}>
        <div className="grid gap-3 sm:grid-cols-2"><ConnectionCard name="WHOOP" data={snap.connections?.whoop}/><ConnectionCard name="Hevy" data={snap.connections?.hevy}/></div>
        {snap.dataQuality?.warnings?.length>0&&<ul className="mt-3 space-y-1 text-xs text-warn">{snap.dataQuality.warnings.map((warning:string)=><li key={warning}>• {warning}</li>)}</ul>}
      </Section>
    </div>

    <Section title="WHOOP recovery, sleep, and strain trends" icon={<HeartPulse size={13}/>} right={<span className="max-w-full text-[11px] text-txt-faint">Energy is a wearable estimate, never precise eat-back calories.</span>}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[{label:"Recovery",field:"recovery",value:whoop?.recovery,unit:"%",color:"bg-healthy"},{label:"Sleep",field:"sleepHours",value:whoop?.sleepHours,unit:" h",color:"bg-accent"},{label:"HRV",field:"hrv",value:whoop?.hrv,unit:" ms",color:"bg-accent"},{label:"RHR",field:"rhr",value:whoop?.rhr,unit:" bpm",color:"bg-warn"},{label:"Strain",field:"strain",value:whoop?.strain,unit:"",color:"bg-error"}].map(item=><div key={item.field} className="min-w-0 rounded-inner border border-border/70 bg-panel-2/20 p-3"><div className="flex flex-wrap items-center justify-between gap-1"><span className="font-mono text-[10px] uppercase tracking-wider text-txt-faint">{item.label}</span><span className="font-mono text-lg text-txt-primary">{fmt(item.value?.value,1)}{item.unit}</span></div><Trend rows={whoop?.history ?? []} field={item.field} label={item.label} unit={item.unit} color={item.color}/><Fresh state={item.value?.freshness ?? "missing"} asOf={item.value?.asOf}/></div>)}
      </div>
    </Section>

    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Weight and cut trend" icon={<Scale size={13}/>}>
        {snap.body?.history?.length?<div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-inner bg-panel-2/30 p-3"><div className="text-[10px] uppercase tracking-wider text-txt-faint">Latest weight</div><div className="mt-1 font-mono text-2xl text-txt-primary">{pounds(weight?.weightKg)}</div><div className="text-xs text-txt-faint">{weight?.observationAtKnown===0?"WHOOP profile value · observation date unknown":weight?.measuredAt?`${snap.body.latestFreshness==="fresh"?"recorded":"last recorded"} ${timeAgo(weight.measuredAt)} · ${weight?.estimated?"estimated":"measured"}`:"unknown"}</div></div><div className="min-w-0 rounded-inner bg-panel-2/30 p-3"><div className="text-[10px] uppercase tracking-wider text-txt-faint">Available composition</div><div className="mt-1 break-words font-mono text-sm text-txt-primary">fat {fmt(weight?.bodyFatPct,1)}% · lean {pounds(weight?.leanMassKg)}</div><div className="text-xs text-txt-faint">waist {weight?.waistCm==null?"—":`${fmt(weight.waistCm,1)} cm`}</div></div></div><div className="mt-4 space-y-2">{snap.body.history.slice(0,6).map((row:any)=><div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs"><span className="text-txt-muted">{row.observationAtKnown===0?"date unknown":row.measuredAt?.slice(0,10)??"date unknown"} · {row.source}</span><span className="break-words font-mono text-txt-primary">{pounds(row.weightKg)}{row.bodyFatPct!=null?` · ${fmt(row.bodyFatPct,1)}% fat`:""}{row.waistCm!=null?` · ${fmt(row.waistCm,1)} cm waist`:""}</span></div>)}</div></div>:<EmptyState title="No body measurements" hint="Log bodyweight or sync an official source; no value will be inferred."/>}
      </Section>
      <Section title="Today's nutrition estimate" icon={<Apple size={13}/>} right={<Badge tone={nutrition?.complete?"healthy":"warn"}>{nutrition?.complete?"complete ranges":"incomplete"}</Badge>}>
        {nutrition?.meals?.length?<><div className="grid grid-cols-2 gap-3"><div className="rounded-inner bg-panel-2/30 p-3"><div className="text-[10px] uppercase text-txt-faint">Calories range</div><div className="font-mono text-2xl text-txt-primary">{fmt(nutrition.calories.low)}–{fmt(nutrition.calories.high)}</div><div className="text-xs text-txt-faint">selected {fmt(nutrition.calories.selected)}</div></div><div className="rounded-inner bg-panel-2/30 p-3"><div className="text-[10px] uppercase text-txt-faint">Protein range</div><div className="font-mono text-2xl text-txt-primary">{fmt(nutrition.proteinG.low)}–{fmt(nutrition.proteinG.high)}g</div><div className="text-xs text-txt-faint">selected {fmt(nutrition.proteinG.selected)}g</div></div></div><div className="mt-4 space-y-2">{nutrition.meals.map((meal:any)=><div key={meal.id} className="rounded-inner border border-border/60 px-3 py-2"><div className="flex justify-between gap-3 text-sm"><span className="text-txt-primary">{meal.description}</span><span className="font-mono text-txt-muted">{meal.caloriesLow ?? "?"}–{meal.caloriesHigh ?? "?"}</span></div><div className="mt-1 text-[10px] text-txt-faint">{meal.mealType} · confidence {meal.confidence}</div></div>)}</div></>:<EmptyState title="No meals logged today" hint="Nutrition remains unknown until the trainer logs an estimate range through the approved CLI."/>}
      </Section>
    </div>

    <Section title="Training · strength sessions, activities, and progression review" icon={<Dumbbell size={13}/>} right={<span className="font-mono text-[11px] text-txt-faint">{training?.weekly?.coverage==="unknown"?"coverage unknown":`${training?.weekly?.frequency ?? 0} strength sessions · ${fmt(training?.weekly?.volumeKg)} kg / rolling 7d`}</span>}>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="min-w-0"><div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">Strength sessions · deduplicated</div>{training?.liftSessions?.length?<div className="space-y-2">{training.liftSessions.slice(0,6).map((workout:any)=><div key={`${workout.source}-${workout.id}`} className="min-w-0 rounded-inner border border-border/60 bg-panel-2/20 p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm text-txt-primary">{workout.title}</div><div className="text-[11px] text-txt-faint">observed by {workout.observedBy.join(" + ")} · {workout.exercises==null||workout.sets==null?"detail unavailable":`${workout.exercises} exercises · ${workout.sets} sets`}</div></div><span className="font-mono text-[10px] text-txt-muted">{workout.startedAt.slice(0,10)}</span></div>{workout.energyKj!=null&&<div className="mt-1 text-[10px] text-txt-faint">{fmt(workout.energyKj)} kJ wearable estimate</div>}</div>)}</div>:<EmptyState title="No strength sessions in current history" hint={snap.connections?.hevy?.status==="healthy"?"Hevy coverage is healthy and complete; no strength sessions were returned for this history window.":"Hevy is preferred for lifting detail; coverage remains unknown while disconnected or unhealthy."}/>} {training?.activities?.length>0&&<div className="mt-4"><div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">General activities · not counted as lifts</div><div className="space-y-1">{training.activities.slice(0,4).map((activity:any)=><div key={activity.id} className="flex min-w-0 flex-wrap justify-between gap-2 rounded-inner border border-border/50 px-3 py-2 text-xs"><span className="min-w-0 truncate text-txt-muted">{activity.title}</span><span className="font-mono text-txt-faint">{activity.startedAt.slice(0,10)}</span></div>)}</div></div>}</div>
        <div>{training?.liftTrends?.length?<div className="space-y-2">{training.liftTrends.map((lift:any)=><div key={lift.key} className="rounded-inner border border-border/60 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm text-txt-primary">{lift.title}</span><div className="flex gap-1">{lift.isPr&&<Badge tone="accent">PR*</Badge>}<Badge tone={lift.progression.status==="increase"?"healthy":lift.progression.status==="hold"?"warn":"off"}>{lift.progression.status.replaceAll("_"," ")}</Badge></div></div><div className="mt-1 text-xs text-txt-muted">{lift.progression.action} · {lift.progression.rationale}</div><div className="mt-1 font-mono text-[10px] text-txt-faint">working {fmt(lift.workingWeightKg,1)} kg · est. 1RM {fmt(lift.latestE1rm,1)} kg · {lift.sessions} sessions</div></div>)}</div>:<EmptyState title="No comparable strength sets" hint="Progression stays review-needed until repeated prescribed rep ranges include RIR or RPE evidence."/>}<p className="mt-2 text-[10px] text-txt-faint">* PRs and 1RM values are estimates from logged sets, not tested maxes.</p></div>
      </div>
    </Section>

    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Latest check-in and checkpoint" icon={<CheckCircle2 size={13}/>}>
        {snap.checkin?<><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{["energy","hunger","soreness","stress"].map(field=><div key={field} className="rounded-inner bg-panel-2/30 p-2 text-center"><div className="font-mono text-xl text-txt-primary">{snap.checkin[field] ?? "—"}</div><div className="text-[9px] uppercase text-txt-faint">{field}</div></div>)}</div>{snap.checkin.trainingIntent&&<div className="mt-3 rounded-inner bg-panel-2/30 p-3 text-xs text-txt-muted"><span className="text-txt-faint">Training intent:</span> {snap.checkin.trainingIntent}</div>}<div className="mt-3"><Tri label="Training completed" value={snap.checkin.trainingCompleted}/><Tri label="Nutrition adhered" value={snap.checkin.nutritionAdherent}/><Tri label="Protein target met" value={snap.checkin.proteinTargetMet}/><Tri label="Steps target met" value={snap.checkin.stepsTargetMet}/></div>{snap.checkin.notes&&<p className="mt-3 text-xs text-txt-muted">{snap.checkin.notes}</p>}<div className="mt-3 font-mono text-[10px] text-txt-faint">check-in {snap.checkin.effectiveAt} · next {snap.checkin.nextCheckpointAt ?? "not scheduled"}</div></>:<EmptyState title="No check-in yet" hint="Energy, hunger, soreness, intent, steps, adherence, and completion remain unknown until explicitly logged."/>}
      </Section>
      <Section title="Private context · alcohol and cannabis" icon={<Lock size={13}/>} right={<Badge tone="off"><Lock size={9}/> private</Badge>}>
        {snap.substances?.eventCount?<><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-inner bg-panel-2/30 p-3"><Wine size={13} className="text-txt-faint"/><div className="mt-2 font-mono text-xl">{snap.substances.alcoholEvents}</div><div className="text-[9px] uppercase text-txt-faint">alcohol events</div></div><div className="rounded-inner bg-panel-2/30 p-3"><Moon size={13} className="text-txt-faint"/><div className="mt-2 font-mono text-xl">{snap.substances.cannabisEvents}</div><div className="text-[9px] uppercase text-txt-faint">cannabis events</div></div><div className="rounded-inner bg-panel-2/30 p-3"><BarChart3 size={13} className="text-txt-faint"/><div className="mt-2 font-mono text-xl">{snap.substances.standardizedAmountKnown?fmt(snap.substances.knownStandardDrinks,1):"unknown"}</div><div className="text-[9px] uppercase text-txt-faint">standard drinks</div></div></div><p className="mt-3 text-xs text-txt-muted">{snap.substances.unknownAmountEvents} event(s) have unknown raw amount. Standard drinks stay unknown when conversion is unavailable. Raw timestamps, amounts, and context are intentionally excluded from the dashboard/WebSocket snapshot.</p></>:<EmptyState title="No private context logged in rolling 7 days" hint="This is not interpreted as no use; it only means no structured events were logged."/>}
      </Section>
    </div>
  </ProjectPage>;
}
