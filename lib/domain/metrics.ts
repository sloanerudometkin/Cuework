import { addMonths, lastYear } from "./dates";
import type { Channel, Dimension, MetricId, MetricTarget, Snapshot } from "./types";

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: "count" | "percent" | "currency" | "position";
  /** false for cost-like metrics where a decrease is good. */
  higherIsBetter: boolean;
}

export const METRICS: Record<MetricId, MetricDef> = {
  sessions: { id: "sessions", label: "Sessions", unit: "count", higherIsBetter: true },
  clicks: { id: "clicks", label: "Clicks", unit: "count", higherIsBetter: true },
  impressions: { id: "impressions", label: "Impressions", unit: "count", higherIsBetter: true },
  ctr: { id: "ctr", label: "CTR", unit: "percent", higherIsBetter: true },
  conversions: { id: "conversions", label: "Conversions", unit: "count", higherIsBetter: true },
  conversion_rate: { id: "conversion_rate", label: "Conversion rate", unit: "percent", higherIsBetter: true },
  cost: { id: "cost", label: "Spend", unit: "currency", higherIsBetter: false },
  cpa: { id: "cpa", label: "Cost per conversion", unit: "currency", higherIsBetter: false },
  avg_position: { id: "avg_position", label: "Avg. position", unit: "position", higherIsBetter: false },
};

export interface Totals {
  impressions: number;
  clicks: number;
  sessions: number;
  conversions: number;
  cost: number;
  /** Impression-weighted average position, null when there is no position data. */
  avgPosition: number | null;
  rows: number;
}

export function sumRows(rows: Snapshot[]): Totals {
  let impressions = 0;
  let clicks = 0;
  let sessions = 0;
  let conversions = 0;
  let cost = 0;
  let posWeight = 0;
  let posSum = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    sessions += r.sessions;
    conversions += r.conversions;
    cost += r.cost;
    if (r.avgPosition != null && r.impressions > 0) {
      posWeight += r.impressions;
      posSum += r.avgPosition * r.impressions;
    }
  }
  return {
    impressions,
    clicks,
    sessions,
    conversions,
    cost,
    avgPosition: posWeight > 0 ? posSum / posWeight : null,
    rows: rows.length,
  };
}

function safeDiv(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Derive a single metric from summed totals. Returns null when undefined (e.g. CPA with 0 conversions). */
export function metricFromTotals(metric: MetricId, t: Totals): number | null {
  switch (metric) {
    case "sessions":
      return t.rows ? t.sessions : null;
    case "clicks":
      return t.rows ? t.clicks : null;
    case "impressions":
      return t.rows ? t.impressions : null;
    case "ctr":
      return safeDiv(t.clicks, t.impressions);
    case "conversions":
      return t.rows ? t.conversions : null;
    case "conversion_rate":
      return safeDiv(t.conversions, t.sessions);
    case "cost":
      return t.rows ? t.cost : null;
    case "cpa":
      return safeDiv(t.cost, t.conversions);
    case "avg_position":
      return t.avgPosition;
  }
}

export interface RowFilter {
  propertyId: string;
  period?: string;
  /** Inclusive range, used for rolling windows. */
  from?: string;
  to?: string;
  channel?: Channel | "all";
  dimension?: Dimension;
  key?: string;
}

export function filterRows(rows: Snapshot[], f: RowFilter): Snapshot[] {
  return rows.filter((r) => {
    if (r.propertyId !== f.propertyId) return false;
    if (f.period && r.periodStart !== f.period) return false;
    if (f.from && r.periodStart < f.from) return false;
    if (f.to && r.periodStart > f.to) return false;
    if (f.channel && f.channel !== "all" && r.channel !== f.channel) return false;
    if (f.dimension && r.dimension !== f.dimension) return false;
    if (f.key !== undefined && f.key !== "" && r.key !== f.key) return false;
    return true;
  });
}

/** Resolve a metric target to a number for a single period. */
export function evaluateTarget(
  rows: Snapshot[],
  propertyId: string,
  target: MetricTarget,
  period: string,
): number | null {
  const matched = filterRows(rows, {
    propertyId,
    period,
    channel: target.channel,
    dimension: target.dimension,
    key: target.key,
  });
  if (!matched.length) return null;
  return metricFromTotals(target.metric, sumRows(matched));
}

/** Resolve a metric target over a rolling window of months (inclusive). */
export function evaluateTargetWindow(
  rows: Snapshot[],
  propertyId: string,
  target: MetricTarget,
  from: string,
  to: string,
): number | null {
  const matched = filterRows(rows, {
    propertyId,
    from,
    to,
    channel: target.channel,
    dimension: target.dimension,
    key: target.key,
  });
  if (!matched.length) return null;
  return metricFromTotals(target.metric, sumRows(matched));
}

/** Relative change; null when the base is missing or zero. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export type Sentiment = "good" | "bad" | "neutral";

/** Whether a change is good or bad given the metric's direction. `flatBand` = ±this fraction is neutral. */
export function sentiment(metric: MetricId, change: number | null, flatBand = 0.02): Sentiment {
  if (change == null || Math.abs(change) < flatBand) return "neutral";
  const up = change > 0;
  return up === METRICS[metric].higherIsBetter ? "good" : "bad";
}

export interface PeriodComparison {
  metric: MetricId;
  current: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  mom: number | null;
  yoy: number | null;
}

export function comparePeriods(
  rows: Snapshot[],
  propertyId: string,
  target: MetricTarget,
  period: string,
): PeriodComparison {
  const current = evaluateTarget(rows, propertyId, target, period);
  const previousMonth = evaluateTarget(rows, propertyId, target, addMonths(period, -1));
  const previousYear = evaluateTarget(rows, propertyId, target, lastYear(period));
  return {
    metric: target.metric,
    current,
    previousMonth,
    previousYear,
    mom: pctChange(current, previousMonth),
    yoy: pctChange(current, previousYear),
  };
}

/** Monthly series for a target between two periods (inclusive). Missing months are null. */
export function series(
  rows: Snapshot[],
  propertyId: string,
  target: MetricTarget,
  from: string,
  to: string,
): { period: string; value: number | null }[] {
  const out: { period: string; value: number | null }[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) {
    out.push({ period: p, value: evaluateTarget(rows, propertyId, target, p) });
  }
  return out;
}

/** Latest period that has any data for the given rows (or null). */
export function latestPeriod(rows: Snapshot[]): string | null {
  let latest: string | null = null;
  for (const r of rows) if (!latest || r.periodStart > latest) latest = r.periodStart;
  return latest;
}

/** Each property's own latest month — properties are imported on their own schedules. */
export function propertyPeriods(rows: Snapshot[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const cur = out.get(r.propertyId);
    if (!cur || r.periodStart > cur) out.set(r.propertyId, r.periodStart);
  }
  return out;
}

/**
 * The latest month that *every* property with data has reached. Portfolio reports use
 * it so all properties are compared over the same month, whatever their import schedule.
 */
export function commonPeriod(rows: Snapshot[]): string | null {
  const periods = [...propertyPeriods(rows).values()];
  return periods.length ? periods.reduce((a, b) => (a < b ? a : b)) : null;
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export interface Anomaly {
  propertyId: string;
  target: MetricTarget;
  period: string;
  current: number;
  expected: number;
  /** Relative change vs. the trailing mean. */
  deviation: number;
  zScore: number;
  direction: "up" | "down";
  sentiment: Sentiment;
  severity: "high" | "medium";
}

const ANOMALY_TARGETS: MetricTarget[] = [
  { metric: "sessions", channel: "organic", dimension: "property", key: "", label: "Organic sessions" },
  { metric: "conversions", channel: "all", dimension: "property", key: "", label: "Total conversions" },
  { metric: "conversion_rate", channel: "all", dimension: "property", key: "", label: "Site conversion rate" },
  { metric: "cost", channel: "paid", dimension: "property", key: "", label: "Paid spend" },
  { metric: "cpa", channel: "paid", dimension: "property", key: "", label: "Paid cost per conversion" },
];

/**
 * Flags property-level metrics that moved far outside their own recent range.
 *
 * The baseline is the trailing `window` months (excluding the current one),
 * re-shaped by last year's seasonality when a year of history exists: each past
 * month is scaled by (last year's current month ÷ last year's that month), so a
 * ferry service's summer peak isn't mistaken for an anomaly. Both a z-score and
 * a minimum relative move are required so quiet series don't generate noise.
 */
export function detectAnomalies(
  rows: Snapshot[],
  propertyId: string,
  period: string,
  opts: { window?: number; minZ?: number; minDeviation?: number } = {},
): Anomaly[] {
  const window = opts.window ?? 6;
  const minZ = opts.minZ ?? 2;
  const minDeviation = opts.minDeviation ?? 0.2;
  const found: Anomaly[] = [];

  for (const target of ANOMALY_TARGETS) {
    const current = evaluateTarget(rows, propertyId, target, period);
    if (current == null) continue;
    const lyCurrent = evaluateTarget(rows, propertyId, target, lastYear(period));

    const history: number[] = [];
    for (let i = 1; i <= window; i++) {
      const p = addMonths(period, -i);
      const v = evaluateTarget(rows, propertyId, target, p);
      if (v == null) continue;
      const lyThen = evaluateTarget(rows, propertyId, target, lastYear(p));
      const adjusted = lyCurrent != null && lyThen != null && lyThen > 0 && lyCurrent > 0 ? v * (lyCurrent / lyThen) : v;
      history.push(adjusted);
    }
    if (history.length < 4) continue;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    if (mean === 0) continue;
    const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
    // Floor the deviation at 2% of the mean so a perfectly flat history can't yield infinite z.
    const std = Math.max(Math.sqrt(variance), Math.abs(mean) * 0.02);
    const z = (current - mean) / std;
    const deviation = (current - mean) / Math.abs(mean);
    if (Math.abs(z) < minZ || Math.abs(deviation) < minDeviation) continue;
    found.push({
      propertyId,
      target,
      period,
      current,
      expected: mean,
      deviation,
      zScore: z,
      direction: current > mean ? "up" : "down",
      sentiment: sentiment(target.metric, deviation, 0.05),
      severity: Math.abs(z) >= 3 && Math.abs(deviation) >= 0.3 ? "high" : "medium",
    });
  }
  return found.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatMetricValue(metric: MetricId, value: number | null, opts: { compact?: boolean } = {}): string {
  if (value == null || Number.isNaN(value)) return "—";
  const def = METRICS[metric];
  switch (def.unit) {
    case "percent":
      return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
    case "currency":
      return value >= 1000 && opts.compact
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
    case "position":
      return value.toFixed(1);
    default:
      return opts.compact && Math.abs(value) >= 10_000
        ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`
        : Math.round(value).toLocaleString("en-US");
  }
}

export function formatPct(change: number | null, opts: { digits?: number } = {}): string {
  if (change == null) return "—";
  const digits = opts.digits ?? (Math.abs(change) < 0.1 ? 1 : 0);
  const v = (change * 100).toFixed(digits);
  return `${change > 0 ? "+" : change < 0 ? "−" : ""}${v.replace("-", "")}%`;
}
