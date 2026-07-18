"use client";
// Entry forms: lot, observation, sku-assignment, stock-event, quick-sales, CSV
// upload. Each posts to an existing Phase 2 route (or the new import route) and
// calls onSubmitted() so the page refetches the snapshot. Native <input>/<select>
// elements carry data-testid so the E2E can select fields robustly (the house
// trap: page.click() on a wide row hits the wrong child — explicit selectors
// on the actual form controls sidestep that entirely).
import { useState, type FormEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger, Button, Badge } from "@/components/ui";
import { apiPost } from "@/hooks/useApi";
import {
  LOT_STATUSES,
  OBSERVATION_SOURCES,
  STOCK_EVENT_TYPES,
  type PkProduct,
} from "@/lib/pokemon-ops/types";

const inputCls =
  "h-9 w-full rounded-inner border border-border bg-base px-2.5 text-xs text-txt-primary outline-none focus:border-accent/50";
const labelCls = "mb-1 block font-mono text-[10px] uppercase tracking-wider text-txt-faint";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function usdToCents(usd: string): number {
  const n = Number(usd);
  return Math.round(n * 100);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function ProductSelect({
  products,
  value,
  onChange,
  testId,
}: {
  products: PkProduct[];
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <select
      data-testid={testId}
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
    >
      <option value="">select a set…</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.set_name}
        </option>
      ))}
    </select>
  );
}

function Result({ msg }: { msg: string | null }) {
  if (!msg) return null;
  const isError = msg.startsWith("error:");
  return (
    <Badge tone={isError ? "error" : "healthy"} className="!normal-case">
      {msg}
    </Badge>
  );
}

function LotForm({ products, onSubmitted }: { products: PkProduct[]; onSubmitted: () => void }) {
  const [productId, setProductId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [source, setSource] = useState<string>("ebay_sold");
  const [packCount, setPackCount] = useState("10");
  const [totalUsd, setTotalUsd] = useState("");
  const [status, setStatus] = useState<string>("in_transit");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/pokemon-ops/lots", {
        product_id: Number(productId),
        purchase_date: purchaseDate,
        source,
        pack_count: Number(packCount),
        total_cost_cents: usdToCents(totalUsd),
        status,
        notes: notes || undefined,
      });
      if (res?.error) setMsg(`error: ${res.error}`);
      else {
        setMsg(`lot #${res.lot.id} added — landed $${(res.lot.landed_cost_per_pack_cents / 100).toFixed(2)}/pack`);
        setTotalUsd("");
        setNotes("");
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="lot-form">
      <Field label="Set">
        <ProductSelect products={products} value={productId} onChange={setProductId} testId="lot-form-product" />
      </Field>
      <Field label="Purchase date">
        <input
          data-testid="lot-form-purchase-date"
          type="date"
          className={inputCls}
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          required
        />
      </Field>
      <Field label="Source">
        <select
          data-testid="lot-form-source"
          className={inputCls}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {OBSERVATION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pack count">
        <input
          data-testid="lot-form-pack-count"
          type="number"
          min={1}
          className={inputCls}
          value={packCount}
          onChange={(e) => setPackCount(e.target.value)}
          required
        />
      </Field>
      <Field label="Total cost (USD, tax+shipping incl.)">
        <input
          data-testid="lot-form-total-cost"
          type="number"
          min={0}
          step="0.01"
          className={inputCls}
          value={totalUsd}
          onChange={(e) => setTotalUsd(e.target.value)}
          required
        />
      </Field>
      <Field label="Status">
        <select
          data-testid="lot-form-status"
          className={inputCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {LOT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <input
          data-testid="lot-form-notes"
          type="text"
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy || !productId} id="lot-form-submit">
          Add lot
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

function ObservationForm({ products, onSubmitted }: { products: PkProduct[]; onSubmitted: () => void }) {
  const [productId, setProductId] = useState("");
  const [observedDate, setObservedDate] = useState(todayIso());
  const [source, setSource] = useState<string>("ebay_active");
  const [priceUsd, setPriceUsd] = useState("");
  const [listingRef, setListingRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/pokemon-ops/observations", {
        product_id: Number(productId),
        observed_date: observedDate,
        source,
        price_per_pack_cents: usdToCents(priceUsd),
        listing_ref: listingRef || undefined,
      });
      if (res?.error) setMsg(`error: ${res.error}`);
      else {
        setMsg(res.inserted ? "observation logged" : "already recorded (duplicate)");
        setPriceUsd("");
        setListingRef("");
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="observation-form">
      <Field label="Set">
        <ProductSelect products={products} value={productId} onChange={setProductId} testId="observation-form-product" />
      </Field>
      <Field label="Observed date">
        <input
          data-testid="observation-form-date"
          type="date"
          className={inputCls}
          value={observedDate}
          onChange={(e) => setObservedDate(e.target.value)}
          required
        />
      </Field>
      <Field label="Source">
        <select
          data-testid="observation-form-source"
          className={inputCls}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {OBSERVATION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Price per pack (USD)">
        <input
          data-testid="observation-form-price"
          type="number"
          min={0}
          step="0.01"
          className={inputCls}
          value={priceUsd}
          onChange={(e) => setPriceUsd(e.target.value)}
          required
        />
      </Field>
      <Field label="Listing ref (URL / order#)">
        <input
          data-testid="observation-form-listing-ref"
          type="text"
          className={inputCls}
          value={listingRef}
          onChange={(e) => setListingRef(e.target.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy || !productId} id="observation-form-submit">
          Log observation
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

function SkuAssignmentForm({
  products,
  machineId,
  onSubmitted,
}: {
  products: PkProduct[];
  machineId: number | null;
  onSubmitted: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [slotNumber, setSlotNumber] = useState("1");
  const [priceUsd, setPriceUsd] = useState("");
  const [capacity, setCapacity] = useState("15");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!machineId) {
      setMsg("error: no machine yet — add a purchase lot / seed a machine row first");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/pokemon-ops/sku-assignments", {
        machine_id: machineId,
        slot_number: Number(slotNumber),
        product_id: Number(productId),
        price_cents: usdToCents(priceUsd),
        capacity: Number(capacity),
        note: note || undefined,
      });
      if (res?.error) setMsg(`error: ${res.error}`);
      else {
        setMsg(`slot ${slotNumber} assigned`);
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="sku-assignment-form">
      <Field label="Set">
        <ProductSelect products={products} value={productId} onChange={setProductId} testId="sku-form-product" />
      </Field>
      <Field label="Slot number">
        <input
          data-testid="sku-form-slot"
          type="number"
          min={1}
          max={8}
          className={inputCls}
          value={slotNumber}
          onChange={(e) => setSlotNumber(e.target.value)}
          required
        />
      </Field>
      <Field label="Price (USD)">
        <input
          data-testid="sku-form-price"
          type="number"
          min={0}
          step="0.01"
          className={inputCls}
          value={priceUsd}
          onChange={(e) => setPriceUsd(e.target.value)}
          required
        />
      </Field>
      <Field label="Capacity">
        <input
          data-testid="sku-form-capacity"
          type="number"
          min={1}
          className={inputCls}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
      </Field>
      <Field label="Note">
        <input
          data-testid="sku-form-note"
          type="text"
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy || !productId} id="sku-form-submit">
          Assign slot
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

function StockEventForm({ machineId, onSubmitted }: { machineId: number | null; onSubmitted: () => void }) {
  const [slotNumber, setSlotNumber] = useState("1");
  const [event, setEvent] = useState<string>("refill");
  const [qtyDelta, setQtyDelta] = useState("15");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!machineId) {
      setMsg("error: no machine yet");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/pokemon-ops/stock-events", {
        machine_id: machineId,
        slot_number: Number(slotNumber),
        event,
        qty_delta: Number(qtyDelta),
        note: note || undefined,
      });
      if (res?.error) setMsg(`error: ${res.error}`);
      else {
        setMsg(`stock updated — current: ${res.current_stock}`);
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="stock-event-form">
      <Field label="Slot number">
        <input
          data-testid="stock-form-slot"
          type="number"
          min={1}
          max={8}
          className={inputCls}
          value={slotNumber}
          onChange={(e) => setSlotNumber(e.target.value)}
          required
        />
      </Field>
      <Field label="Event">
        <select
          data-testid="stock-form-event"
          className={inputCls}
          value={event}
          onChange={(e) => setEvent(e.target.value)}
        >
          {STOCK_EVENT_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label={event === "audit_count" ? "Counted total (absolute)" : "Qty delta"}>
        <input
          data-testid="stock-form-qty"
          type="number"
          className={inputCls}
          value={qtyDelta}
          onChange={(e) => setQtyDelta(e.target.value)}
          required
        />
      </Field>
      <Field label="Note">
        <input
          data-testid="stock-form-note"
          type="text"
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy} id="stock-form-submit">
          Log stock event
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

function QuickSalesForm({ machineId, onSubmitted }: { machineId: number | null; onSubmitted: () => void }) {
  const [slotNumber, setSlotNumber] = useState("1");
  const [qty, setQty] = useState("1");
  const [sinceTs, setSinceTs] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!machineId) {
      setMsg("error: no machine yet");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/pokemon-ops/sales", {
        machine_id: machineId,
        slot_number: Number(slotNumber),
        action: "quick_bulk",
        qty: Number(qty),
        since_ts: new Date(sinceTs).toISOString(),
      });
      if (res?.error) setMsg(`error: ${res.error}`);
      else {
        setMsg(`${res.rows?.length ?? 0} sale row(s) recorded`);
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="quick-sales-form">
      <Field label="Slot number">
        <input
          data-testid="quick-sale-form-slot"
          type="number"
          min={1}
          max={8}
          className={inputCls}
          value={slotNumber}
          onChange={(e) => setSlotNumber(e.target.value)}
          required
        />
      </Field>
      <Field label="Qty sold">
        <input
          data-testid="quick-sale-form-qty"
          type="number"
          min={1}
          className={inputCls}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
      </Field>
      <Field label="Sold since">
        <input
          data-testid="quick-sale-form-since"
          type="datetime-local"
          className={inputCls}
          value={sinceTs}
          onChange={(e) => setSinceTs(e.target.value)}
          required
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy} id="quick-sale-form-submit">
          Record sale(s)
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

function CsvUploadForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [kind, setKind] = useState<string>("carddistro");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMsg("error: choose a file");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const r = await fetch("/api/pokemon-ops/import", { method: "POST", body: form });
      const json = await r.json();
      if (!r.ok || json?.error) setMsg(`error: ${json?.error || "import failed"}`);
      else {
        const res = json.result as { imported?: number; skipped?: number; row_count?: number };
        setMsg(`imported ${res.imported ?? res.row_count ?? 0}, skipped ${res.skipped ?? 0}`);
        onSubmitted();
      }
    } catch (err: any) {
      setMsg(`error: ${err?.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-testid="csv-upload-form">
      <Field label="Kind">
        <select
          data-testid="csv-form-kind"
          className={inputCls}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="carddistro">carddistro (supplier / mentor quote)</option>
          <option value="lots">lots</option>
          <option value="sales">sales</option>
        </select>
      </Field>
      <Field label="CSV file">
        <input
          data-testid="csv-form-file"
          type="file"
          accept=".csv,text/csv"
          className={inputCls}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="accent" disabled={busy} id="csv-form-submit">
          Upload
        </Button>
        <Result msg={msg} />
      </div>
    </form>
  );
}

export function EntryForms({
  products,
  machineId,
  onSubmitted,
}: {
  products: PkProduct[];
  machineId: number | null;
  onSubmitted: () => void;
}) {
  return (
    <Tabs defaultValue="lot">
      <TabsList>
        <TabsTrigger value="lot">Lot</TabsTrigger>
        <TabsTrigger value="observation">Observation</TabsTrigger>
        <TabsTrigger value="sku">SKU assignment</TabsTrigger>
        <TabsTrigger value="stock">Stock event</TabsTrigger>
        <TabsTrigger value="sale">Quick sale</TabsTrigger>
        <TabsTrigger value="csv">CSV upload</TabsTrigger>
      </TabsList>
      <TabsContent value="lot" className="pt-4">
        <LotForm products={products} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="observation" className="pt-4">
        <ObservationForm products={products} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="sku" className="pt-4">
        <SkuAssignmentForm products={products} machineId={machineId} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="stock" className="pt-4">
        <StockEventForm machineId={machineId} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="sale" className="pt-4">
        <QuickSalesForm machineId={machineId} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="csv" className="pt-4">
        <CsvUploadForm onSubmitted={onSubmitted} />
      </TabsContent>
    </Tabs>
  );
}
