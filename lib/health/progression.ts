import type { ProgressionDecision, ProgressionSession, ProgressionSet } from "@/lib/health/types";

const DAY_MS = 86_400_000;

export function estimatedOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || reps == null || weightKg <= 0 || reps < 1 || reps > 15) return null;
  return +(weightKg * (1 + reps / 30)).toFixed(1);
}

function hasEffortEvidence(set: ProgressionSet): boolean {
  return set.rir != null || set.rpe != null;
}

function adequateEffort(set: ProgressionSet): boolean {
  return (set.rir != null && set.rir >= 2) || (set.rpe != null && set.rpe <= 8);
}

function prescribedSuccess(session: ProgressionSession): boolean {
  const working = session.sets.filter((set) => set.weightKg != null && set.reps != null);
  if (!working.length) return false;
  return working.every((set) =>
    set.targetMin != null &&
    set.targetMax != null &&
    set.reps! >= set.targetMin &&
    set.reps! <= set.targetMax &&
    hasEffortEvidence(set) &&
    adequateEffort(set)
  );
}

export function progressionDecision(
  sessions: ProgressionSession[],
  asOf = new Date().toISOString(),
  maxAgeDays = 14
): ProgressionDecision {
  const ordered = [...sessions].filter((s) => Number.isFinite(Date.parse(s.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!ordered.length) return { status: "review_needed", action: "Collect working sets", rationale: "No completed working-set history is available." };
  const ageDays = (Date.parse(asOf) - Date.parse(ordered[0].at)) / DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays > maxAgeDays) {
    return { status: "stale", action: "Refresh training data", rationale: "Recent training evidence is stale, so no readiness or load increase is claimed." };
  }
  const recent = ordered.slice(0, 2);
  const lacksPrescription = recent.some((session) => session.sets.some((set) => set.targetMin == null || set.targetMax == null));
  const lacksEffort = recent.some((session) => session.sets.some((set) => set.weightKg != null && set.reps != null && !hasEffortEvidence(set)));
  if (recent.length < 2 || lacksPrescription || lacksEffort) {
    return { status: "review_needed", action: "Trainer review needed", rationale: "A load increase requires two recent sessions with prescribed rep ranges and RIR or RPE evidence." };
  }
  if (!recent.every(prescribedSuccess)) {
    return { status: "hold", action: "Hold current load", rationale: "The last two sessions did not both complete the prescribed rep range with adequate reserve." };
  }
  return { status: "increase", action: "Consider the smallest load increase", rationale: "Two recent sessions completed the prescribed rep range with adequate RIR or RPE evidence. Confirm technique before progressing." };
}
