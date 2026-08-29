import type Database from "better-sqlite3";
import { getDb } from "@/db";
import type { ProductForm } from "./types";

export interface InventoryRoundInput {
  name: string;
  starts_on: string;
  ends_on?: string | null;
  notes?: string | null;
}

export interface InventoryRoundRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryRoundBucket {
  units: number;
  percent: number;
}

export interface InventoryRoundTotals {
  purchased_units: number;
  /** Null means at least one canonical lot has no confirmed cost. */
  total_cost_cents: number | null;
  known_cost_cents: number;
  known_cost_units: number;
  pending_cost_lot_count: number;
  pending_cost_units: number;
  machine: InventoryRoundBucket;
  stockroom: InventoryRoundBucket;
  sold: InventoryRoundBucket;
  /** Purchased units removed by an audit/shrink event without a matching sale. */
  unresolved: InventoryRoundBucket;
}

export interface InventoryRoundProduct extends InventoryRoundTotals {
  product_id: number;
  display_name: string;
  set_name: string;
  form: ProductForm;
}

export interface InventoryRoundSummary extends InventoryRoundRow {
  lot_ids: number[];
  lot_count: number;
  totals: InventoryRoundTotals;
  products: InventoryRoundProduct[];
}

export interface InventoryRoundsSnapshot {
  as_of: string;
  rounds: InventoryRoundSummary[];
  traceability: {
    unassigned_purchase_units: number;
    unlinked_refill_units: number;
    over_allocated_refill_units: number;
    unknown_machine_units: number;
    unknown_sold_units: number;
  };
}

type Lot = {
  id:number; purchase_date:string; product_id:number; pack_count:number;
  total_cost_cents:number; cost_confirmed:0|1; display_name:string; set_name:string; form:ProductForm;
  round_id:number|null;
};
type StockEvent = { id:number; machine_id:number; slot_number:number; event:string; qty_delta:number; lot_id:number|null; at:string; product_id:number|null };
type Sale = { id:number; machine_id:number; slot_number:number; product_id:number; qty:number; sold_at:string };
type Assignment = { id:number; machine_id:number; slot_number:number; assigned_at:string };
type SlotState = { known:Map<number,number>; unknown:Map<number,number> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function cleanInput(input:InventoryRoundInput) {
  const name=input.name.trim();
  if (!name) throw new Error("round name is required");
  if (!DATE.test(input.starts_on)) throw new Error("starts_on must be YYYY-MM-DD");
  const ends=input.ends_on?.trim()||null;
  if (ends && !DATE.test(ends)) throw new Error("ends_on must be YYYY-MM-DD");
  if (ends && ends<input.starts_on) throw new Error("ends_on must not precede starts_on");
  return {name,starts_on:input.starts_on,ends_on:ends,notes:input.notes?.trim()||null};
}

export function createInventoryRound(input:InventoryRoundInput, db:Database.Database=getDb()):number {
  const value=cleanInput(input);
  const result=db.prepare(`INSERT INTO pk_inventory_rounds(name,starts_on,ends_on,notes) VALUES(?,?,?,?)`)
    .run(value.name,value.starts_on,value.ends_on,value.notes);
  return Number(result.lastInsertRowid);
}

export function updateInventoryRound(id:number,input:InventoryRoundInput,db:Database.Database=getDb()):InventoryRoundRow {
  if (!Number.isInteger(id)||id<=0) throw new Error("invalid round id");
  const value=cleanInput(input);
  return db.transaction(()=>{
    const result=db.prepare(`UPDATE pk_inventory_rounds SET name=?,starts_on=?,ends_on=?,notes=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(value.name,value.starts_on,value.ends_on,value.notes,id);
    if (!result.changes) throw new Error(`inventory round ${id} not found`);
    // Revalidate existing membership inside the same transaction so a rejected
    // boundary edit cannot strand a lot outside its acquisition dates.
    const outside=db.prepare(`SELECT l.id,l.purchase_date FROM pk_inventory_round_lots m JOIN pk_purchase_lots l ON l.id=m.lot_id
      WHERE m.round_id=? AND (l.purchase_date<? OR (? IS NOT NULL AND l.purchase_date>?)) ORDER BY l.purchase_date,l.id`).all(id,value.starts_on,value.ends_on,value.ends_on) as Array<{id:number;purchase_date:string}>;
    if (outside.length) throw new Error(`lot ${outside[0].id} purchase date ${outside[0].purchase_date} is outside ${value.name}`);
    return db.prepare("SELECT * FROM pk_inventory_rounds WHERE id=?").get(id) as InventoryRoundRow;
  })();
}

export function replaceInventoryRoundLots(roundId:number,lotIds:number[],db:Database.Database=getDb()):void {
  if (!Number.isInteger(roundId)||roundId<=0) throw new Error("invalid round id");
  if (!Array.isArray(lotIds)||lotIds.some(id=>!Number.isInteger(id)||id<=0)) throw new Error("lot_ids must contain positive integers");
  const unique=[...new Set(lotIds)];
  db.transaction(()=>{
    const round=db.prepare("SELECT * FROM pk_inventory_rounds WHERE id=?").get(roundId) as InventoryRoundRow|undefined;
    if (!round) throw new Error(`inventory round ${roundId} not found`);
    if (unique.length) {
      const findLot=db.prepare("SELECT id,purchase_date FROM pk_purchase_lots WHERE id=?");
      const owner=db.prepare(`SELECT r.name FROM pk_inventory_round_lots m JOIN pk_inventory_rounds r ON r.id=m.round_id WHERE m.lot_id=? AND m.round_id<>?`);
      for (const id of unique) {
        const lot=findLot.get(id) as {id:number;purchase_date:string}|undefined;
        if (!lot) throw new Error(`purchase lot ${id} not found`);
        if (lot.purchase_date<round.starts_on||(round.ends_on!==null&&lot.purchase_date>round.ends_on)) {
          throw new Error(`lot ${id} purchase date ${lot.purchase_date} is outside ${round.name}`);
        }
        const existing=owner.get(id,roundId) as {name:string}|undefined;
        if (existing) throw new Error(`lot ${id} already belongs to ${existing.name}`);
      }
    }
    db.prepare("DELETE FROM pk_inventory_round_lots WHERE round_id=?").run(roundId);
    const insert=db.prepare("INSERT INTO pk_inventory_round_lots(round_id,lot_id) VALUES(?,?)");
    for (const id of unique) insert.run(roundId,id);
  })();
}

function pct(units:number,total:number):number { return total===0?0:Math.round(units/total*1000)/10; }
function bucket(units:number,total:number):InventoryRoundBucket { return {units,percent:pct(units,total)}; }
function slotKey(machine:number,slot:number):string { return `${machine}:${slot}`; }
function stateFor(states:Map<string,SlotState>,machine:number,slot:number):SlotState {
  const key=slotKey(machine,slot); let state=states.get(key);
  if (!state) { state={known:new Map(),unknown:new Map()}; states.set(key,state); }
  return state;
}
function fifoLotIds(state:SlotState,productId:number,lots:Map<number,Lot>):number[] {
  return [...state.known].filter(([id,qty])=>qty>0&&lots.get(id)?.product_id===productId)
    .map(([id])=>id).sort((a,b)=>lots.get(a)!.purchase_date.localeCompare(lots.get(b)!.purchase_date)||a-b);
}
function consumeKnown(state:SlotState,qty:number,productId:number,lots:Map<number,Lot>,onConsume:(lotId:number,qty:number)=>void):number {
  let remaining=qty;
  for (const lotId of fifoLotIds(state,productId,lots)) {
    if (remaining<=0) break;
    const used=Math.min(remaining,state.known.get(lotId)??0);
    state.known.set(lotId,(state.known.get(lotId)??0)-used); onConsume(lotId,used); remaining-=used;
  }
  return remaining;
}
function consumeUnknown(state:SlotState,qty:number,productId:number):number {
  let remaining=qty;
  for (const key of [productId,0]) {
    const used=Math.min(remaining,state.unknown.get(key)??0);
    state.unknown.set(key,(state.unknown.get(key)??0)-used); remaining-=used;
  }
  return remaining;
}
function removeFromSlot(state:SlotState,qty:number,lots:Map<number,Lot>):void {
  let remaining=qty;
  for (const productId of [...state.unknown.keys()].sort((a,b)=>a-b)) {
    const used=Math.min(remaining,state.unknown.get(productId)??0);
    state.unknown.set(productId,(state.unknown.get(productId)??0)-used); remaining-=used;
  }
  const ids=[...state.known.keys()].filter(id=>(state.known.get(id)??0)>0)
    .sort((a,b)=>lots.get(a)!.purchase_date.localeCompare(lots.get(b)!.purchase_date)||a-b);
  for (const id of ids) {
    const used=Math.min(remaining,state.known.get(id)??0);
    state.known.set(id,(state.known.get(id)??0)-used); remaining-=used;
    if (remaining<=0) break;
  }
}

export function inventoryRoundsSnapshot(db:Database.Database=getDb()):InventoryRoundsSnapshot {
  const rounds=db.prepare("SELECT * FROM pk_inventory_rounds ORDER BY starts_on,id").all() as InventoryRoundRow[];
  const lotRows=db.prepare(`SELECT l.id,l.purchase_date,l.product_id,l.pack_count,l.total_cost_cents,l.cost_confirmed,p.display_name,p.set_name,p.form,m.round_id
    FROM pk_purchase_lots l JOIN pk_products p ON p.id=l.product_id LEFT JOIN pk_inventory_round_lots m ON m.lot_id=l.id
    ORDER BY l.purchase_date,l.id`).all() as Lot[];
  const lots=new Map(lotRows.map(lot=>[lot.id,lot]));
  const events=db.prepare(`SELECT e.id,e.machine_id,e.slot_number,e.event,e.qty_delta,e.lot_id,e.at,
    COALESCE(l.product_id,(SELECT a.product_id FROM pk_sku_assignments a WHERE a.machine_id=e.machine_id AND a.slot_number=e.slot_number AND a.assigned_at<=e.at AND (a.ended_at IS NULL OR a.ended_at>e.at) ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1)) product_id
    FROM pk_stock_events e LEFT JOIN pk_purchase_lots l ON l.id=e.lot_id ORDER BY e.at,e.id`).all() as StockEvent[];
  const sales=db.prepare("SELECT id,machine_id,slot_number,product_id,qty,sold_at FROM pk_sales WHERE qty>0 ORDER BY sold_at,id").all() as Sale[];
  const assignments=db.prepare("SELECT id,machine_id,slot_number,assigned_at FROM pk_sku_assignments ORDER BY assigned_at,id").all() as Assignment[];
  const timeline=[
    ...assignments.map(row=>({at:row.assigned_at,order:-1,id:row.id,kind:"assignment" as const,row})),
    ...sales.map(row=>({at:row.sold_at,order:0,id:row.id,kind:"sale" as const,row})),
    ...events.map(row=>({at:row.at,order:1,id:row.id,kind:"event" as const,row})),
  ].sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order||a.id-b.id);

  const states=new Map<string,SlotState>();
  const introduced=new Map<number,number>();
  const soldByLot=new Map<number,number>();
  let unlinkedRefill=0,overAllocated=0,unknownSold=0;
  for (const item of timeline) {
    if (item.kind==="assignment") {
      // A slot reassignment is a hard temporal boundary. Any balance left by
      // the prior assignment is no longer evidence for the new product. Known
      // lot units remain introduced, so round reconciliation reports them as
      // unresolved rather than silently returning them to the stockroom.
      states.delete(slotKey(item.row.machine_id,item.row.slot_number));
      continue;
    }
    if (item.kind==="sale") {
      const sale=item.row,state=stateFor(states,sale.machine_id,sale.slot_number);
      let remaining=consumeKnown(state,sale.qty,sale.product_id,lots,(lotId,qty)=>soldByLot.set(lotId,(soldByLot.get(lotId)??0)+qty));
      // Every unit left after known-lot FIFO is untraceable to a purchase lot,
      // whether or not an unlinked machine balance can absorb it.
      unknownSold+=remaining;
      remaining=consumeUnknown(state,remaining,sale.product_id);
      continue;
    }
    const event=item.row,state=stateFor(states,event.machine_id,event.slot_number);
    if (event.event==="refill"&&event.qty_delta>0) {
      const lot=event.lot_id===null?undefined:lots.get(event.lot_id);
      if (!lot) {
        unlinkedRefill+=event.qty_delta;
        const product=event.product_id??0; state.unknown.set(product,(state.unknown.get(product)??0)+event.qty_delta);
      } else {
        const available=Math.max(0,lot.pack_count-(introduced.get(lot.id)??0));
        const accepted=Math.min(event.qty_delta,available);
        if (accepted>0) { state.known.set(lot.id,(state.known.get(lot.id)??0)+accepted); introduced.set(lot.id,(introduced.get(lot.id)??0)+accepted); }
        overAllocated+=event.qty_delta-accepted;
      }
    } else if (event.event==="audit_count") {
      const current=[...state.known.values(),...state.unknown.values()].reduce((sum,value)=>sum+value,0);
      const target=Math.max(0,event.qty_delta);
      if (target<current) removeFromSlot(state,current-target,lots);
      else if (target>current) { const product=event.product_id??0; state.unknown.set(product,(state.unknown.get(product)??0)+target-current); }
    } else if (event.qty_delta<0) removeFromSlot(state,-event.qty_delta,lots);
    else if (event.qty_delta>0) { const product=event.product_id??0; state.unknown.set(product,(state.unknown.get(product)??0)+event.qty_delta); }
  }
  const machineByLot=new Map<number,number>(); let unknownMachine=0;
  for (const state of states.values()) {
    for (const [lotId,qty] of state.known) machineByLot.set(lotId,(machineByLot.get(lotId)??0)+Math.max(0,qty));
    unknownMachine += [...state.unknown.values()].reduce((sum,qty)=>sum+Math.max(0,qty),0);
  }

  const summarize=(selected:Lot[]):InventoryRoundTotals=>{
    const purchased=selected.reduce((sum,lot)=>sum+lot.pack_count,0);
    const machine=selected.reduce((sum,lot)=>sum+(machineByLot.get(lot.id)??0),0);
    const sold=selected.reduce((sum,lot)=>sum+(soldByLot.get(lot.id)??0),0);
    const stockroom=selected.reduce((sum,lot)=>sum+Math.max(0,lot.pack_count-(introduced.get(lot.id)??0)),0);
    const unresolved=Math.max(0,purchased-machine-sold-stockroom);
    const known=selected.filter(lot=>lot.cost_confirmed===1);
    const pending=selected.filter(lot=>lot.cost_confirmed===0);
    const knownCost=known.reduce((sum,lot)=>sum+lot.total_cost_cents,0);
    return {purchased_units:purchased,total_cost_cents:pending.length===0?knownCost:null,known_cost_cents:knownCost,known_cost_units:known.reduce((sum,lot)=>sum+lot.pack_count,0),pending_cost_lot_count:pending.length,pending_cost_units:pending.reduce((sum,lot)=>sum+lot.pack_count,0),machine:bucket(machine,purchased),stockroom:bucket(stockroom,purchased),sold:bucket(sold,purchased),unresolved:bucket(unresolved,purchased)};
  };
  return {
    as_of:new Date().toISOString(),
    rounds:rounds.map(round=>{
      const selected=lotRows.filter(lot=>lot.round_id===round.id);
      const productIds=[...new Set(selected.map(lot=>lot.product_id))];
      return {...round,lot_ids:selected.map(lot=>lot.id),lot_count:selected.length,totals:summarize(selected),products:productIds.map(productId=>{
        const productLots=selected.filter(lot=>lot.product_id===productId),product=productLots[0];
        return {product_id:productId,display_name:product.display_name,set_name:product.set_name,form:product.form,...summarize(productLots)};
      })};
    }),
    traceability:{
      unassigned_purchase_units:lotRows.filter(lot=>lot.round_id===null).reduce((sum,lot)=>sum+lot.pack_count,0),
      unlinked_refill_units:unlinkedRefill,
      over_allocated_refill_units:overAllocated,
      unknown_machine_units:unknownMachine,
      unknown_sold_units:unknownSold,
    },
  };
}
