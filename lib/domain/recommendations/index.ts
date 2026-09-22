import { detectAnomalies, latestPeriod, propertyPeriods } from "../metrics";
import { comparePriority, scorePriority } from "../prioritization";
import type { PropertyLite, ScoredRecommendation, Snapshot } from "../types";
import { ALL_RULES, type Rule } from "./rules";

export interface EngineInput {
  properties: PropertyLite[];
  snapshots: Snapshot[];
  /** Override the reporting month for every property; defaults to each property's own latest month. */
  period?: string;
  rules?: Rule[];
}

export interface EngineResult {
  period: string | null;
  recommendations: ScoredRecommendation[];
}

/**
 * Deterministic recommendation engine. Pure: same data in, same recommendations out.
 * This is the seam where a production model can later add rationale/explanation
 * without altering the deterministic detection or the scoring that ranks results.
 */
export function generateRecommendations(input: EngineInput): EngineResult {
  const latest = latestPeriod(input.snapshots);
  if (!latest) return { period: null, recommendations: [] };
  const periods = propertyPeriods(input.snapshots);

  const rules = input.rules ?? ALL_RULES;
  const out: ScoredRecommendation[] = [];

  for (const property of input.properties) {
    const rows = input.snapshots.filter((s) => s.propertyId === property.id);
    if (!rows.length) continue;
    const period = input.period ?? periods.get(property.id)!;
    const anomalies = detectAnomalies(rows, property.id, period);
    for (const rule of rules) {
      for (const draft of rule({ property, rows, period, anomalies })) {
        const strategic = property.strategicWeight;
        out.push({
          ...draft,
          strategic,
          period,
          priorityScore: scorePriority({
            impact: draft.impact,
            urgency: draft.urgency,
            strategic,
            confidence: draft.confidence,
            effort: draft.effort,
          }),
        });
      }
    }
  }

  // Fingerprints must be unique so refreshes can upsert safely.
  const seen = new Set<string>();
  const unique = out.filter((r) => (seen.has(r.fingerprint) ? false : (seen.add(r.fingerprint), true)));
  return { period: input.period ?? latest, recommendations: unique.sort(comparePriority) };
}

export { ALL_RULES } from "./rules";
export type { Rule, RuleContext } from "./rules";
