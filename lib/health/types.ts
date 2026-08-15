export type FreshnessState = "fresh" | "stale" | "missing" | "unknown" | "broken";
export type ConnectionHealth = "disconnected" | "healthy" | "stale" | "broken";
export type TriState = boolean | null;

export type Metric<T> = {
  value: T | null;
  asOf: string | null;
  freshness: FreshnessState;
  ageHours: number | null;
  estimated?: boolean;
};

export type MealInput = {
  idempotencyKey: string;
  mealAt: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack" | "drink" | "pre_workout" | "post_workout" | "unknown";
  description: string;
  caloriesLow?: number | null;
  caloriesHigh?: number | null;
  caloriesSelected?: number | null;
  proteinLowG?: number | null;
  proteinHighG?: number | null;
  proteinSelectedG?: number | null;
  confidence?: "low" | "medium" | "high" | "unknown";
  assumptions?: string;
  source?: string;
  sourceRef?: string | null;
  supersedesId?: number | null;
};

export type CheckinInput = {
  idempotencyKey: string;
  effectiveAt: string;
  effectiveDay?: string;
  weightMeasurementId?: number | null;
  energy?: number | null;
  hunger?: number | null;
  soreness?: number | null;
  stress?: number | null;
  trainingIntent?: string | null;
  trainingCompleted?: TriState;
  nutritionAdherent?: TriState;
  proteinTargetMet?: TriState;
  stepsTargetMet?: TriState;
  notes?: string;
  nextCheckpointAt?: string | null;
  source?: string;
  sourceRef?: string | null;
  supersedesId?: number | null;
};

export type SubstanceInput = {
  idempotencyKey: string;
  occurredAt: string;
  substance: "alcohol" | "cannabis";
  amount?: number | null;
  unit?: string | null;
  standardDrinks?: number | null;
  thcMg?: number | null;
  cbdMg?: number | null;
  timingContext?: string | null;
  context?: string;
  estimated?: boolean;
  source?: string;
  sourceRef?: string | null;
  supersedesId?: number | null;
};

export type BodyMeasurementInput = {
  idempotencyKey: string;
  measuredAt: string;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  leanMassKg?: number | null;
  waistCm?: number | null;
  context?: string;
  estimated?: boolean;
  source?: string;
  externalId?: string | null;
  sourcePayload?: unknown;
  supersedesId?: number | null;
};

export type ProjectedBodyMeasurement = {
  id: number;
  externalId: string | null;
  measuredAt: string | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  waistCm: number | null;
  context: string;
  estimated: number;
  source: string;
  observationAtKnown: number;
};

export type RecommendationInput = {
  idempotencyKey: string;
  category: "training" | "nutrition" | "recovery" | "checkin" | "general";
  action: string;
  rationale: string;
  inputsAsOf: string;
  provenance?: unknown[];
  status?: "active" | "accepted" | "dismissed" | "expired" | "completed" | "review_needed";
  expiresAt?: string | null;
  source?: string;
};

export type ProgressionSet = {
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  rir: number | null;
  targetMin: number | null;
  targetMax: number | null;
};

export type ProgressionSession = { at: string; sets: ProgressionSet[] };
export type ProgressionDecision = {
  status: "increase" | "hold" | "review_needed" | "stale";
  action: string;
  rationale: string;
};
