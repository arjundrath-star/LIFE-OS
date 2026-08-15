type RecommendationLike = {
  id: number;
  category: string;
  inputsAsOf: string;
  status: string;
  expiresAt: string | null;
  source: string;
  current?: boolean;
  warning?: string | null;
} | null;

export function publicRecommendation(value: RecommendationLike, generatedAt: string) {
  if (!value) return null;
  const ageMs = Date.parse(generatedAt) - Date.parse(value.inputsAsOf);
  const inputAgeHours = Number.isFinite(ageMs) ? Math.max(0, +(ageMs / 3_600_000).toFixed(1)) : null;
  return {
    id: value.id,
    category: value.category,
    status: value.status,
    current: value.current === true,
    inputsAsOf: value.inputsAsOf,
    inputAgeHours,
    expiresAt: value.expiresAt,
    source: value.source,
    ...(value.warning ? { warning: value.warning } : {}),
  };
}
