// Pokemon ops enums + row/input types. Mirrors db/migrations/0011_pokemon_ops.sql
// (the locked schema in docs/plans/pokemon-ops/PLAN.md §2) exactly.

export const PRODUCT_FORMS = ["booster", "blister", "tin_pack", "slab", "other"] as const;
export type ProductForm = (typeof PRODUCT_FORMS)[number];

export const PRODUCT_TIERS = ["premium", "mid", "entry", "slab", "unknown"] as const;
export type ProductTier = (typeof PRODUCT_TIERS)[number];

export const REPRINT_STATUSES = ["none", "announced", "active"] as const;
export type ReprintStatus = (typeof REPRINT_STATUSES)[number];

export const OBSERVATION_SOURCES = [
  "carddistro",
  "supplier_other",
  "ebay_sold",
  "ebay_active",
  "tcgplayer",
  "costco",
  "target",
  "walmart",
  "sams",
  "fb_marketplace",
  "local_shop",
  "amazon",
  "retail_restock",
  "other",
] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const STOCK_EVENT_TYPES = ["refill", "audit_count", "shrink_adjust"] as const;
export type StockEventType = (typeof STOCK_EVENT_TYPES)[number];

export const SALE_SOURCES = ["manual", "csv", "lynx", "sqs"] as const;
export type SaleSource = (typeof SALE_SOURCES)[number];
// Only API sources dedupe on (source, external_txn_id) — the partial unique index.
export const SALE_DEDUPE_SOURCES = ["lynx", "sqs"] as const;

export const LOT_STATUSES = ["in_transit", "received", "allocated", "depleted"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const RECOMMENDATION_RULES = [
  "refill_sync",
  "price_raise",
  "add_slot",
  "dead_stock",
  "refill_order",
  "sourcing_offer",
  "nayax_drift",
] as const;
export type RecommendationRule = (typeof RECOMMENDATION_RULES)[number];

export const RECOMMENDATION_SEVERITIES = ["info", "action", "urgent"] as const;
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];

export const RECOMMENDATION_STATUSES = ["open", "acked", "done", "dismissed"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

// pk_config known keys (integer-string values). PATCH only ever touches these.
export const CONFIG_KEYS = [
  "refill_cycle_days",
  "budget_cents",
  "alert_threshold_pct",
  "min_margin_cents",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

// ---- row types (as read from SQLite) ----

export interface PkProduct {
  id: number;
  set_name: string;
  form: ProductForm;
  display_name: string;
  release_date: string | null;
  tier: ProductTier;
  reprint_status: ReprintStatus;
  active: 0 | 1;
  created_at: string;
}

export interface PkPriceObservation {
  id: number;
  observed_date: string;
  source: ObservationSource;
  product_id: number;
  price_per_pack_cents: number;
  lot_size: number | null;
  total_cost_cents: number | null;
  includes_shipping: 0 | 1 | null;
  includes_tax: 0 | 1 | null;
  listing_ref: string;
  quantity_available: number | null;
  alerted_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface PkPurchaseLot {
  id: number;
  purchase_date: string;
  source: ObservationSource;
  product_id: number;
  pack_count: number;
  total_cost_cents: number;
  landed_cost_per_pack_cents: number;
  observation_id: number | null;
  benchmark_price_cents: number | null;
  benchmark_delta_cents: number | null;
  status: LotStatus;
  notes: string | null;
  created_at: string;
}

export interface PkSkuAssignment {
  id: number;
  machine_id: number;
  slot_number: number;
  product_id: number;
  price_cents: number;
  capacity: number;
  assigned_at: string;
  ended_at: string | null;
  note: string | null;
}

export interface PkStockEvent {
  id: number;
  machine_id: number;
  slot_number: number;
  event: StockEventType;
  qty_delta: number;
  lot_id: number | null;
  at: string;
  note: string | null;
}

export interface PkSale {
  id: number;
  machine_id: number;
  slot_number: number;
  product_id: number;
  qty: number;
  unit_price_cents: number;
  sold_at: string;
  source: SaleSource;
  external_txn_id: string;
  created_at: string;
}

export interface PkImportReceipt {
  sha256: string;
  filename: string;
  kind: string;
  row_count: number;
  imported_at: string;
}

export interface PkRecommendation {
  id: number;
  rule: RecommendationRule;
  machine_id: number | null;
  slot_number: number | null;
  payload_json: string;
  severity: RecommendationSeverity;
  created_at: string;
  status: RecommendationStatus;
  alerted_at: string | null;
}

export interface PkSourceProductCurrent {
  source_product_id: number;
  pack_product_id: number;
  set_name: string;
  tcgplayer_product_id: number;
  name: string;
  form: string;
  pack_count: number;
  tcgplayer_url: string;
  pack_count_source_url: string;
  pack_count_note: string;
  observed_date: string;
  tcg_market_cents: number | null;
  tcg_low_cents: number | null;
  tcg_high_cents: number | null;
  pack_tcg_cents: number;
  carddistro_cents: number;
  benchmark_ppp_cents: number;
  low_total_cents: number;
  medium_total_cents: number;
  high_total_cents: number;
  tcg_market_ppp_cents: number | null;
  low_ppp_cents: number;
  medium_ppp_cents: number;
  high_ppp_cents: number;
  methodology: string;
}

export interface PkSourceProductCoverage {
  set_name: string;
  carddistro_observed_date: string;
  source_product_count: number;
  valued_product_count: number;
}

export interface Machine {
  id: number;
  name: string;
  location: string | null;
  status: string;
  needs_refill: number;
  last_refill: string | null;
  note: string | null;
  created_at: string;
}

// ---- insert inputs ----

export interface NewProduct {
  set_name: string;
  form: ProductForm;
  display_name?: string;
  release_date?: string | null;
  tier: ProductTier;
  reprint_status?: ReprintStatus;
  active?: 0 | 1;
}

export interface NewPriceObservation {
  observed_date: string;
  source: ObservationSource;
  product_id: number;
  price_per_pack_cents: number;
  lot_size?: number | null;
  total_cost_cents?: number | null;
  includes_shipping?: 0 | 1 | null;
  includes_tax?: 0 | 1 | null;
  listing_ref?: string | null;
  quantity_available?: number | null;
  notes?: string | null;
}

export interface NewPurchaseLot {
  purchase_date: string;
  source: ObservationSource;
  product_id: number;
  pack_count: number;
  total_cost_cents: number;
  observation_id?: number | null;
  status?: LotStatus;
  notes?: string | null;
}

export interface NewSkuAssignment {
  machine_id: number;
  slot_number: number;
  product_id: number;
  price_cents: number;
  capacity: number;
  assigned_at?: string;
  note?: string | null;
}

export interface NewStockEvent {
  machine_id: number;
  slot_number: number;
  event: StockEventType;
  qty_delta: number;
  lot_id?: number | null;
  at?: string;
  note?: string | null;
}

export interface NewSale {
  machine_id: number;
  slot_number: number;
  product_id: number;
  qty: number;
  unit_price_cents: number;
  sold_at: string;
  source: SaleSource;
  external_txn_id?: string | null;
}

export interface NewRecommendation {
  rule: RecommendationRule;
  machine_id?: number | null;
  slot_number?: number | null;
  payload?: unknown;
  severity?: RecommendationSeverity;
}

export interface NewImportReceipt {
  sha256: string;
  filename: string;
  kind: string;
  row_count: number;
}
