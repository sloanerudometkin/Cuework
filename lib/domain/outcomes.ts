import { METRICS, pctChange, sentiment } from "./metrics";
import type { MetricTarget } from "./types";

export type Verdict = "improved" | "declined" | "flat" | "pending";
export type EvidenceStrength = "correlation" | "corroborated" | "experiment";

export const EVIDENCE_LABEL: Record<EvidenceStrength, { short: string; long: string }> = {
  correlation: {
    short: "Correlated",
    long: "The metric moved after the work shipped, but other factors (seasonality, campaigns, algorithm changes) could explain it. Not proven causal.",
  },
  corroborated: {
    short: "Corroborated",
    long: "The change is concentrated on exactly what we touched while the wider property moved much less. Stronger evidence — still not a controlled test.",
  },
  experiment: {
    short: "Proven (tested)",
    long: "Measured in a controlled test with a comparison group, so the effect can be attributed to the change.",
  },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  improved: "Improved",
  declined: "Declined",
  flat: "No clear change",
  pending: "Awaiting data",
};

export const FLAT_BAND = 0.03;

export interface MeasureInput {
  target: MetricTarget;
  baselineValue: number | null;
  currentValue: number | null;
  /** Change in the same metric for the whole property over the same window, if known. */
  propertyChange?: number | null;
  /** True when a controlled test backs this outcome. */
  experiment?: boolean;
}

export interface Measurement {
  changePct: number | null;
  verdict: Verdict;
  evidenceStrength: EvidenceStrength;
}

/** Turns a before/after pair into a verdict and an honest evidence label. */
export function measureOutcome(input: MeasureInput): Measurement {
  const { target, baselineValue, currentValue } = input;
  const changePct = pctChange(currentValue, baselineValue);
  if (changePct == null) return { changePct: null, verdict: "pending", evidenceStrength: "correlation" };

  const s = sentiment(target.metric, changePct, FLAT_BAND);
  const verdict: Verdict = s === "good" ? "improved" : s === "bad" ? "declined" : "flat";
  return { changePct, verdict, evidenceStrength: classifyEvidence(input, changePct) };
}

export function classifyEvidence(input: MeasureInput, scopedChange: number): EvidenceStrength {
  if (input.experiment) return "experiment";
  const scoped = input.target.dimension !== "property";
  const wide = input.propertyChange;
  if (scoped && wide != null && Math.abs(scopedChange) >= FLAT_BAND) {
    // Localised: our slice moved at least twice as much as the whole property.
    if (Math.abs(scopedChange) >= 2 * Math.abs(wide)) return "corroborated";
  }
  return "correlation";
}

export function metricLabel(target: MetricTarget): string {
  return target.label || METRICS[target.metric].label;
}
