/**
 * Prioritization under constraints.
 *
 * Inputs are the five signals the product promises to weigh:
 *   impact, urgency, strategic relevance (1–5), confidence (0–1), effort (1–5).
 *
 *   value        = 0.45·impact + 0.30·urgency + 0.25·strategic       (each ÷ 5)
 *   confidenceAdj = 0.6 + 0.4·confidence                                (unsure ideas are discounted ≤ 40%)
 *   effortAdj     = 1.2 − 0.4·(effort ÷ 5)                              (quick wins +12%, heavy lifts −20%)
 *   score         = clamp(100 · value · confidenceAdj · effortAdj)
 *
 * The weights are deliberately simple and visible: a marketer should be able to
 * predict why one item outranks another, and argue with it.
 */

export interface PriorityInputs {
  impact: number;
  urgency: number;
  strategic: number;
  confidence: number;
  effort: number;
}

export const WEIGHTS = { impact: 0.45, urgency: 0.3, strategic: 0.25 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function scorePriority(i: PriorityInputs): number {
  const impact = clamp(i.impact, 1, 5) / 5;
  const urgency = clamp(i.urgency, 1, 5) / 5;
  const strategic = clamp(i.strategic, 1, 5) / 5;
  const effort = clamp(i.effort, 1, 5) / 5;
  const confidence = clamp(i.confidence, 0, 1);

  const value = WEIGHTS.impact * impact + WEIGHTS.urgency * urgency + WEIGHTS.strategic * strategic;
  const confidenceAdj = 0.6 + 0.4 * confidence;
  const effortAdj = 1.2 - 0.4 * effort;
  return Math.round(clamp(100 * value * confidenceAdj * effortAdj, 0, 100) * 10) / 10;
}

export type PriorityBand = "now" | "soon" | "consider";

export function priorityBand(score: number): PriorityBand {
  if (score >= 62) return "now";
  if (score >= 45) return "soon";
  return "consider";
}

export const BAND_LABEL: Record<PriorityBand, string> = {
  now: "Do now",
  soon: "Plan soon",
  consider: "Consider",
};

export interface PriorityDriver {
  label: string;
  /** Signed contribution vs. a neutral (3/5) baseline, in score points. */
  points: number;
  note: string;
}

/**
 * Explains a score as its biggest levers, so the UI can say *why* something ranks where it does.
 * Points are the change in score if that single input were neutral (3 or 0.6 confidence).
 */
export function explainPriority(i: PriorityInputs): PriorityDriver[] {
  const base = scorePriority(i);
  const neutral = (patch: Partial<PriorityInputs>) => scorePriority({ ...i, ...patch });
  const drivers: PriorityDriver[] = [
    { label: "Impact", points: base - neutral({ impact: 3 }), note: `${i.impact}/5` },
    { label: "Urgency", points: base - neutral({ urgency: 3 }), note: `${i.urgency}/5` },
    { label: "Strategic fit", points: base - neutral({ strategic: 3 }), note: `${i.strategic}/5` },
    { label: "Confidence", points: base - neutral({ confidence: 0.6 }), note: `${Math.round(i.confidence * 100)}%` },
    { label: "Effort", points: base - neutral({ effort: 3 }), note: `${i.effort}/5` },
  ];
  return drivers.map((d) => ({ ...d, points: Math.round(d.points * 10) / 10 }));
}

/** Higher score first; ties broken by lower effort, then title for stable ordering. */
export function comparePriority<T extends { priorityScore: number; effort?: number; title?: string }>(a: T, b: T): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if ((a.effort ?? 0) !== (b.effort ?? 0)) return (a.effort ?? 0) - (b.effort ?? 0);
  return (a.title ?? "").localeCompare(b.title ?? "");
}

export const LEVEL_LABEL = ["", "Very low", "Low", "Medium", "High", "Very high"] as const;
