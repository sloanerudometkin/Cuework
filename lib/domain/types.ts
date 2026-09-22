/**
 * Shared domain vocabulary. Everything in lib/domain is pure (no I/O) so it can
 * be unit-tested and later reused by a background worker without change.
 */

export const CATEGORIES = ["seo", "aeo", "sem", "analytics", "content"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  seo: "SEO",
  aeo: "AEO",
  sem: "Paid search",
  analytics: "Analytics",
  content: "Content",
};

/** Traffic channel a snapshot row belongs to. */
export const CHANNELS = ["organic", "paid", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

/** What the row describes. "property" rows are monthly totals per channel. */
export const DIMENSIONS = ["property", "query", "page", "campaign", "keyword"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type SnapshotAttrs = Record<string, string | number | boolean | null>;

/** One monthly measurement. `periodStart` is always the first of the month (YYYY-MM-01). */
export interface Snapshot {
  id?: string;
  propertyId: string;
  dataSourceId?: string;
  periodStart: string;
  channel: Channel;
  dimension: Dimension;
  key: string;
  secondaryKey: string | null;
  impressions: number;
  clicks: number;
  sessions: number;
  conversions: number;
  cost: number;
  avgPosition: number | null;
  attrs: SnapshotAttrs;
}

export const METRIC_IDS = [
  "sessions",
  "clicks",
  "impressions",
  "ctr",
  "conversions",
  "conversion_rate",
  "cost",
  "cpa",
  "avg_position",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

/** A precise, re-measurable pointer at a number: "CTR of query X on property P". */
export interface MetricTarget {
  metric: MetricId;
  /** "all" sums every channel. */
  channel: Channel | "all";
  dimension: Dimension;
  /** Empty string = the whole dimension (e.g. all property rows). */
  key: string;
  /** Human label, e.g. "Organic CTR · “ferry schedule”". */
  label: string;
}

export type Role = "manager" | "coordinator";

export interface EvidenceDraft {
  label: string;
  value: string;
  comparison?: string;
  snapshotId?: string;
}

export interface RecommendationDraft {
  ruleKey: string;
  /** Stable identity so refreshes update rather than duplicate, and dismissals stick. */
  fingerprint: string;
  propertyId: string;
  category: Category;
  title: string;
  rationale: string;
  expectedOutcome: string;
  nextStep: string;
  whyNow: string;
  target: MetricTarget;
  /** 1–5 */
  impact: number;
  /** 1–5 (higher = more work) */
  effort: number;
  /** 1–5 */
  urgency: number;
  /** 0–1 */
  confidence: number;
  estimatedHours: number;
  suggestedOwnerRole: Role;
  evidence: EvidenceDraft[];
}

export type ScoredRecommendation = RecommendationDraft & {
  strategic: number;
  priorityScore: number;
  /** The property's latest month at generation time (properties can be imported on different schedules). */
  period: string;
};

export interface PropertyLite {
  id: string;
  name: string;
  kind: string;
  /** 1–5, how central this property is to the organisation's goals. */
  strategicWeight: number;
}
