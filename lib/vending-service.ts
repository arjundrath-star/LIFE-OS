import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/db";

export const MACHINE_CONDITIONS = ["operational", "service_required", "out_of_order", "retired"] as const;
export const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
type Condition = typeof MACHINE_CONDITIONS[number];

export class ServiceError extends Error { constructor(message:string, public status=400){super(message);} }
const int=(v:unknown,label:string,max=1_000_000_000)=>{if(!Number.isInteger(v)||Number(v)<0||Number(v)>max)throw new ServiceError(`${label} must be a non-negative integer.`);return Number(v)};
const optionalInt=(v:unknown,label:string)=>v===null||v===undefined||v===""?null:int(v,label);

export function calculateServiceLine(input:{previous:number;remaining:number;removed:number;refill:number;capacity:number;salePrice:number;cost:number|null}) {
  for(const [k,v] of Object.entries(input)) if(k!=="cost") int(v,k);
  if(input.remaining+input.removed>input.capacity) throw new ServiceError("Physical remaining plus removed/damaged exceeds slot capacity.");
  const resulting=input.remaining+input.refill;
  if(resulting>input.capacity) throw new ServiceError("Resulting verified stock exceeds slot capacity.");
  const correction=input.remaining+input.removed>input.previous;
  const dispensed=Math.max(0,input.previous-input.remaining-input.removed);
  return {resulting,dispensed,correction,revenue:dispensed*input.salePrice,cost:input.cost===null?null:dispensed*input.cost,profit:input.cost===null?null:dispensed*(input.salePrice-input.cost)};
}

function stock(db:Database.Database,machineId:number,slot:number){
  const audit=db.prepare(`SELECT id,at,qty_delta FROM pk_stock_events WHERE machine_id=? AND slot_number=? AND event='audit_count' ORDER BY at DESC,id DESC LIMIT 1`).get(machineId,slot) as any;
  const deltas=audit?db.prepare(`SELECT COALESCE(SUM(qty_delta),0) s FROM pk_stock_events WHERE machine_id=? AND slot_number=? AND event!='audit_count' AND (at>? OR (at=? AND id>?))`).get(machineId,slot,audit.at,audit.at,audit.id) as any:db.prepare(`SELECT COALESCE(SUM(qty_delta),0) s FROM pk_stock_events WHERE machine_id=? AND slot_number=? AND event!='audit_count'`).get(machineId,slot) as any;
  const sales=audit?db.prepare(`SELECT COALESCE(SUM(qty),0) s FROM pk_sales WHERE machine_id=? AND slot_number=? AND sold_at>?`).get(machineId,slot,audit.at) as any:db.prepare(`SELECT COALESCE(SUM(qty),0) s FROM pk_sales WHERE machine_id=? AND slot_number=?`).get(machineId,slot) as any;
  return {quantity:(audit?.qty_delta??0)+deltas.s-sales.s,verifiedAt:audit?.at??null};
}

export function serviceSnapshot(machineId:number,db=getDb()){
  const machine=db.prepare(`SELECT * FROM machines WHERE id=?`).get(machineId) as any;
  if(!machine)throw new ServiceError("Machine not found.",404); if(machine.archived_at||machine.condition==="retired")throw new ServiceError("Archived or retired machines cannot be serviced.",409);
  const assignments=db.prepare(`SELECT a.*,p.display_name,p.set_name FROM pk_sku_assignments a JOIN pk_products p ON p.id=a.product_id WHERE a.machine_id=? AND a.ended_at IS NULL ORDER BY a.slot_number`).all(machineId) as any[];
  const slots=assignments.map(a=>{const current=stock(db,machineId,a.slot_number);const event=db.prepare(`SELECT e.lot_id,l.landed_cost_per_pack_cents FROM pk_stock_events e LEFT JOIN pk_purchase_lots l ON l.id=e.lot_id AND l.product_id=? WHERE e.machine_id=? AND e.slot_number=? AND e.at>=? ORDER BY e.at DESC,e.id DESC LIMIT 1`).get(a.product_id,machineId,a.slot_number,a.assigned_at) as any;return {...a,current_stock:current.quantity,last_verified_at:current.verifiedAt,source_lot_id:event?.lot_id??null,landed_cost_cents:event?.lot_id?event.landed_cost_per_pack_cents:null};});
  const canonical=JSON.stringify({machine:{id:machine.id,condition:machine.condition,archived_at:machine.archived_at,last_inspected_at:machine.last_inspected_at},slots:slots.map(s=>[s.id,s.slot_number,s.product_id,s.price_cents,s.capacity,s.current_stock,s.last_verified_at,s.source_lot_id,s.landed_cost_cents])});
  const visits=db.prepare(`SELECT * FROM vending_service_visits WHERE machine_id=? ORDER BY completed_at DESC,id DESC LIMIT 20`).all(machineId);
  const issues=db.prepare(`SELECT * FROM vending_machine_issues WHERE machine_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,created_at DESC,id DESC`).all(machineId);
  return {machine,slots,visits,issues,snapshotToken:createHash("sha256").update(canonical).digest("hex"),idempotencyKey:randomUUID()};
}

export function fleetServiceSummary(db=getDb()){
  const machines=db.prepare(`SELECT * FROM machines WHERE archived_at IS NULL ORDER BY id`).all() as any[];
  const severity:any={critical:4,high:3,medium:2,low:1};
  return machines.map(machine=>{const assignments=db.prepare(`SELECT a.*,p.display_name FROM pk_sku_assignments a JOIN pk_products p ON p.id=a.product_id WHERE a.machine_id=? AND a.ended_at IS NULL ORDER BY slot_number`).all(machine.id) as any[];const slots=assignments.map(a=>({...a,...stock(db,machine.id,a.slot_number)}));const issues=db.prepare(`SELECT * FROM vending_machine_issues WHERE machine_id=? AND status='open' ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,id DESC`).all(machine.id) as any[];const visit=db.prepare(`SELECT id,completed_at,actor_email FROM vending_service_visits WHERE machine_id=? ORDER BY completed_at DESC,id DESC LIMIT 1`).get(machine.id) as any;const verified=slots.map(s=>s.verifiedAt).filter(Boolean).sort().at(0)??null;const total=slots.reduce((n,s)=>n+s.quantity,0),capacity=slots.reduce((n,s)=>n+s.capacity,0),low=capacity>0&&total/capacity<=.25;const priority=(machine.condition==="out_of_order"?1000:machine.condition==="service_required"?800:0)+(issues[0]?severity[issues[0].severity]*100:0)+(low?50:0)+(verified?Math.min(40,Math.floor((Date.now()-Date.parse(verified))/86400000)):45);return {...machine,slots,calculated_stock:total,capacity,open_issues:issues,last_service:visit,latest_verified_at:verified,priority};}).sort((a,b)=>b.priority-a.priority||a.id-b.id);
}

export function submitServiceVisit(machineId:number,actorEmail:string,body:any,db=getDb()){
  if(!body||typeof body.idempotencyKey!=="string"||body.idempotencyKey.length<16)throw new ServiceError("Service form expired. Reload and recount.");
  const duplicate=db.prepare(`SELECT * FROM vending_service_visits WHERE idempotency_key=?`).get(body.idempotencyKey) as any;if(duplicate)return {visitId:duplicate.id,idempotent:true};
  const tx=db.transaction(()=>{const snap=serviceSnapshot(machineId,db);if(body.snapshotToken!==snap.snapshotToken)throw new ServiceError("This machine or its inventory changed while the form was open. Reload and recount every physical slot.",409);if(!snap.slots.length)throw new ServiceError("Configure at least one active slot before service.");
    if(!MACHINE_CONDITIONS.includes(body.conditionAfter))throw new ServiceError("Choose a valid machine condition.");
    const submitted=Array.isArray(body.lines)?body.lines:[];if(submitted.length!==snap.slots.length)throw new ServiceError("Every active slot must have a physical count.");
    const bySlot=new Map(submitted.map((l:any)=>[Number(l.slotNumber),l]));if(bySlot.size!==snap.slots.length)throw new ServiceError("Every active slot must be counted exactly once.");
    const cash=optionalInt(body.cashCollectedCents,"Cash collected"),before=optionalInt(body.counterBefore,"Counter before"),after=optionalInt(body.counterAfter,"Counter after");if(before!==null&&after!==null&&after<before)throw new ServiceError("Counter after cannot be lower than counter before.");
    const completed=new Date().toISOString(),started=typeof body.startedAt==="string"&&!Number.isNaN(Date.parse(body.startedAt))?body.startedAt:completed;
    const result=db.prepare(`INSERT INTO vending_service_visits(machine_id,actor_email,started_at,completed_at,condition_before,condition_after,cash_collected_cents,counter_before,counter_after,notes,idempotency_key,snapshot_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(machineId,actorEmail,started,completed,snap.machine.condition,body.conditionAfter,cash,before,after,typeof body.notes==="string"?body.notes.slice(0,4000):null,body.idempotencyKey,snap.snapshotToken);const visitId=Number(result.lastInsertRowid);
    for(const slot of snap.slots){const line:any=bySlot.get(slot.slot_number);if(!line||Number(line.productId)!==slot.product_id)throw new ServiceError(`Slot ${slot.slot_number} product changed. Reload and recount.`,409);const calc=calculateServiceLine({previous:slot.current_stock,remaining:int(line.remaining,`Slot ${slot.slot_number} remaining`,slot.capacity),removed:int(line.removed??0,`Slot ${slot.slot_number} removed`,slot.capacity),refill:int(line.refill??0,`Slot ${slot.slot_number} refill`,slot.capacity),capacity:slot.capacity,salePrice:slot.price_cents,cost:slot.landed_cost_cents});db.prepare(`INSERT INTO vending_service_lines(visit_id,machine_id,slot_number,product_id,previous_calculated_stock,physical_sellable_remaining,removed_damaged,refill_quantity,resulting_verified_stock,inferred_dispensed_quantity,sale_price_cents,landed_cost_cents,source_lot_id,estimated_revenue_cents,estimated_cost_cents,estimated_profit_cents,count_correction) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(visitId,machineId,slot.slot_number,slot.product_id,slot.current_stock,line.remaining,line.removed??0,line.refill??0,calc.resulting,calc.dispensed,slot.price_cents,slot.landed_cost_cents,slot.source_lot_id,calc.revenue,calc.cost,calc.profit,calc.correction?1:0);db.prepare(`INSERT INTO pk_stock_events(machine_id,slot_number,event,qty_delta,lot_id,at,note) VALUES(?,?,'audit_count',?,NULL,?,?)`).run(machineId,slot.slot_number,calc.resulting,completed,`Physical count from service visit ${visitId}; refill/removal captured in service evidence`);}
    if(body.issue?.description){if(!ISSUE_SEVERITIES.includes(body.issue.severity))throw new ServiceError("Choose a valid issue severity.");db.prepare(`INSERT INTO vending_machine_issues(machine_id,visit_id,severity,description,status,created_by_email) VALUES(?,?,?,?,'open',?)`).run(machineId,visitId,body.issue.severity,String(body.issue.description).slice(0,2000),actorEmail);}
    db.prepare(`UPDATE machines SET condition=?,last_inspected_at=?,needs_refill=0,last_refill=CASE WHEN EXISTS(SELECT 1 FROM vending_service_lines WHERE visit_id=? AND refill_quantity>0) THEN ? ELSE last_refill END WHERE id=?`).run(body.conditionAfter,completed,visitId,completed,machineId);return {visitId,idempotent:false};});
  return tx();
}

export function serviceHistory(db=getDb()){return db.prepare(`SELECT v.*,m.name machine_name,COUNT(l.id) slot_count,COALESCE(SUM(l.resulting_verified_stock),0) verified_units,COALESCE(SUM(l.inferred_dispensed_quantity),0) estimated_dispensed,COALESCE(SUM(l.estimated_revenue_cents),0) estimated_revenue_cents FROM vending_service_visits v JOIN machines m ON m.id=v.machine_id LEFT JOIN vending_service_lines l ON l.visit_id=v.id GROUP BY v.id ORDER BY v.completed_at DESC,v.id DESC LIMIT 100`).all();}
