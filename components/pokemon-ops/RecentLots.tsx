"use client";

import { useState } from "react";
import { formatCents, formatDate } from "@/lib/pokemon-ops/format";
import {
  LOT_STATUSES,
  OBSERVATION_SOURCES,
  type PkProduct,
  type PkPurchaseLot,
} from "@/lib/pokemon-ops/types";

type LotRow = PkPurchaseLot & { set_name: string };

const controlClass = "lot-edit-control";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function PurchaseLotCard({
  lot,
  products,
  onChanged,
}: {
  lot: LotRow;
  products: PkProduct[];
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseDate, setPurchaseDate] = useState(lot.purchase_date);
  const [source, setSource] = useState(lot.source);
  const [productId, setProductId] = useState(String(lot.product_id));
  const [packCount, setPackCount] = useState(String(lot.pack_count));
  const [totalCost, setTotalCost] = useState((lot.total_cost_cents / 100).toFixed(2));
  const [status, setStatus] = useState(lot.status);
  const [notes, setNotes] = useState(lot.notes ?? "");

  const reset = () => {
    setPurchaseDate(lot.purchase_date);
    setSource(lot.source);
    setProductId(String(lot.product_id));
    setPackCount(String(lot.pack_count));
    setTotalCost((lot.total_cost_cents / 100).toFixed(2));
    setStatus(lot.status);
    setNotes(lot.notes ?? "");
    setError(null);
  };

  const save = async () => {
    const packs = Number(packCount);
    const cents = Math.round(Number(totalCost) * 100);
    if (!Number.isInteger(packs) || packs <= 0 || !Number.isFinite(cents) || cents < 0) {
      setError("Enter a positive whole pack count and a valid total cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pokemon-ops/lots", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: lot.id,
          purchase_date: purchaseDate,
          source,
          product_id: Number(productId),
          pack_count: packs,
          total_cost_cents: cents,
          status,
          notes: notes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
      setEditing(false);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lot could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="purchase-lot-card" data-testid="lot-row">
      <div className="purchase-lot-card-head">
        <div>
          <span className={`lot-status ${lot.status}`}>{statusLabel(lot.status)}</span>
          <h3>{lot.set_name}</h3>
          <p>{formatDate(lot.purchase_date)} · {statusLabel(lot.source)}</p>
        </div>
        <button
          type="button"
          className="lot-edit-button"
          onClick={() => { if (editing) reset(); setEditing(!editing); }}
        >
          {editing ? "Close editor" : "Edit lot"}
        </button>
      </div>

      <div className="purchase-lot-economics">
        <div><span>Packs</span><strong>{lot.pack_count}</strong></div>
        <div><span>Total paid</span><strong>{formatCents(lot.total_cost_cents)}</strong></div>
        <div><span>Landed / pack</span><strong>{formatCents(lot.landed_cost_per_pack_cents)}</strong></div>
        <div>
          <span>Vs benchmark</span>
          <strong>{lot.benchmark_delta_cents == null ? "No benchmark" : `${lot.benchmark_delta_cents > 0 ? "+" : ""}${formatCents(lot.benchmark_delta_cents)}`}</strong>
        </div>
      </div>
      {lot.notes && <p className="purchase-lot-note">{lot.notes}</p>}

      {editing && (
        <div className="lot-edit-panel" data-testid={`lot-editor-${lot.id}`}>
          <div className="lot-edit-grid">
            <label>Set<select className={controlClass} value={productId} onChange={event => setProductId(event.target.value)}>{products.map(product => <option key={product.id} value={product.id}>{product.set_name}</option>)}</select></label>
            <label>Purchase date<input className={controlClass} type="date" value={purchaseDate} onChange={event => setPurchaseDate(event.target.value)} /></label>
            <label>Source<select className={controlClass} value={source} onChange={event => setSource(event.target.value as typeof source)}>{OBSERVATION_SOURCES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
            <label>Pack count<input className={controlClass} type="number" min="1" step="1" value={packCount} onChange={event => setPackCount(event.target.value)} /></label>
            <label>Total cost ($)<input className={controlClass} type="number" min="0" step="0.01" value={totalCost} onChange={event => setTotalCost(event.target.value)} /></label>
            <label>Status<select className={controlClass} value={status} onChange={event => setStatus(event.target.value as typeof status)}>{LOT_STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
            <label className="lot-notes-field">Notes<textarea className={controlClass} rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Allocation, shipping, condition, or correction context" /></label>
          </div>
          <div className="lot-edit-actions">
            <button type="button" onClick={() => { reset(); setEditing(false); }}>Cancel</button>
            <button type="button" className="business-primary-action" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
          {error && <p className="lot-edit-error" role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}

export function RecentLots({
  lots,
  products = [],
  onChanged,
}: {
  lots: LotRow[];
  products?: PkProduct[];
  onChanged?: () => void;
}) {
  if (lots.length === 0) return <p data-testid="recent-lots" className="text-xs text-txt-faint">No purchase lots match this view. Add a lot or clear the filters.</p>;
  return <div className="purchase-lot-grid" data-testid="recent-lots">{lots.map(lot => <PurchaseLotCard key={lot.id} lot={lot} products={products} onChanged={onChanged} />)}</div>;
}
