import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import { recommendations, workItems } from "@/lib/db/schema";
import { addMonths, weekStart as toWeekStart } from "@/lib/domain/dates";
import {
  comparePeriods,
  detectAnomalies,
  formatMetricValue,
  propertyPeriods,
  sentiment,
  series,
  type Anomaly,
  type Sentiment,
} from "@/lib/domain/metrics";
import type { MetricId, MetricTarget } from "@/lib/domain/types";
import { listOutcomes, type OutcomeView } from "./outcomes";
import { getWeekPlan, type WeekPlanView } from "./planning";
import { loadWorkspace, propertySourceStatus, type PropertyRow, type Workspace } from "./workspace";

export interface KpiBlockDef {
  id: string;
  label: string;
  target: MetricTarget;
  /** Which completed-work metrics belong under this block. */
  family: MetricId[];
  channel: "organic" | "paid" | "all";
}

const t = (metric: MetricId, channel: MetricTarget["channel"], label: string): MetricTarget => ({ metric, channel, dimension: "property", key: "", label });

export const KPI_BLOCKS: KpiBlockDef[] = [
  { id: "organic_sessions", label: "Organic sessions", target: t("sessions", "organic", "Organic sessions"), family: ["sessions", "clicks", "impressions", "avg_position"], channel: "organic" },
  { id: "organic_ctr", label: "Organic CTR", target: t("ctr", "organic", "Organic CTR"), family: ["ctr"], channel: "organic" },
  { id: "conversions", label: "Conversions", target: t("conversions", "all", "Conversions"), family: ["conversions"], channel: "all" },
  { id: "conversion_rate", label: "Conversion rate", target: t("conversion_rate", "all", "Conversion rate"), family: ["conversion_rate"], channel: "all" },
  { id: "paid_cost", label: "Paid spend", target: t("cost", "paid", "Paid spend"), family: ["cost"], channel: "paid" },
  { id: "paid_cpa", label: "Cost per paid conversion", target: t("cpa", "paid", "Cost per paid conversion"), family: ["cpa"], channel: "paid" },
];

export interface KpiView {
  id: string;
  label: string;
  metric: MetricId;
  current: number | null;
  display: string;
  mom: number | null;
  yoy: number | null;
  momSentiment: Sentiment;
  yoySentiment: Sentiment;
  series: { period: string; value: number | null }[];
  previousYearSeries: { period: string; value: number | null }[];
}

export interface PropertyPerformance {
  property: PropertyRow;
  /** This property's own latest month of data. */
  period: string;
  sourceStatus: ReturnType<typeof propertySourceStatus>;
  kpis: KpiView[];
  anomalies: Anomaly[];
  relatedOutcomes: Record<string, OutcomeView[]>;
}

export function buildKpis(ws: Workspace, propertyId: string, period: string, ids?: string[]): KpiView[] {
  const views: KpiView[] = [];
  const from = addMonths(period, -12);
  const lyFrom = addMonths(period, -24);
  for (const def of KPI_BLOCKS) {
    if (ids && !ids.includes(def.id)) continue;
    const cmp = comparePeriods(ws.snapshots, propertyId, def.target, period);
    if (cmp.current == null) continue;
    views.push({
      id: def.id,
      label: def.label,
      metric: def.target.metric,
      current: cmp.current,
      display: formatMetricValue(def.target.metric, cmp.current, { compact: true }),
      mom: cmp.mom,
      yoy: cmp.yoy,
      momSentiment: sentiment(def.target.metric, cmp.mom),
      yoySentiment: sentiment(def.target.metric, cmp.yoy),
      series: series(ws.snapshots, propertyId, def.target, from, period),
      previousYearSeries: series(ws.snapshots, propertyId, def.target, lyFrom, addMonths(period, -12)),
    });
  }
  return views;
}

export function isRelated(def: KpiBlockDef, o: OutcomeView): boolean {
  const okChannel = def.channel === "all" ? true : o.target.channel === def.channel;
  return okChannel && def.family.includes(o.target.metric);
}

export async function getPerformance(db: Db, orgId: string) {
  const ws = await loadWorkspace(db, orgId);
  const outcomesAll = await listOutcomes(db, orgId);
  const period = ws.period;
  const periods = propertyPeriods(ws.snapshots);
  const props: PropertyPerformance[] = [];
  if (period) {
    for (const p of ws.properties) {
      const pPeriod = periods.get(p.id);
      if (!pPeriod) continue;
      const kpis = buildKpis(ws, p.id, pPeriod);
      const mine = outcomesAll.filter((o) => o.propertyId === p.id);
      const related: Record<string, OutcomeView[]> = {};
      for (const def of KPI_BLOCKS) related[def.id] = mine.filter((o) => isRelated(def, o));
      props.push({
        property: p,
        period: pPeriod,
        sourceStatus: propertySourceStatus(ws, p.id),
        kpis,
        anomalies: detectAnomalies(ws.snapshots, p.id, pPeriod),
        relatedOutcomes: related,
      });
    }
  }
  return { ws, period, properties: props, outcomes: outcomesAll };
}

// ---------------------------------------------------------------------------
// Portfolio command center
// ---------------------------------------------------------------------------

export interface AttentionItem {
  id: string;
  tone: "urgent" | "decision" | "risk" | "info";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

export async function getPortfolio(db: Db, orgId: string, now = new Date()) {
  const ws = await loadWorkspace(db, orgId);
  const period = ws.period;
  const weekStart = toWeekStart(now);
  const plan = await getWeekPlan(db, orgId, weekStart);
  const outcomesAll = await listOutcomes(db, orgId);

  const openRecs = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.orgId, orgId), inArray(recommendations.status, ["new", "refining"])))
    .orderBy(desc(recommendations.priorityScore));
  const activeProps = new Set(ws.properties.map((p) => p.id));
  const open = openRecs.filter((r) => activeProps.has(r.propertyId));

  const blocked = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.orgId, orgId), eq(workItems.status, "blocked")));
  const overrun = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.orgId, orgId), eq(workItems.status, "in_progress"), isNotNull(workItems.startedAt)));
  const atRisk = [
    ...blocked.map((w) => ({ w, reason: w.blockedReason ?? "Blocked", kind: "blocked" as const })),
    ...overrun.filter((w) => w.hoursSpent > w.estimatedHours).map((w) => ({ w, reason: `${w.hoursSpent}h logged against a ${w.estimatedHours}h estimate`, kind: "overrun" as const })),
  ];

  const periods = propertyPeriods(ws.snapshots);
  const properties = ws.properties.flatMap((p) => {
    const pPeriod = periods.get(p.id);
    if (!pPeriod) {
      return [{ property: p, period: null as string | null, sourceStatus: propertySourceStatus(ws, p.id), kpis: [], anomalies: [] as Anomaly[], openRecs: open.filter((r) => r.propertyId === p.id).length }];
    }
    return [
      {
        property: p,
        period: pPeriod as string | null,
        sourceStatus: propertySourceStatus(ws, p.id),
        kpis: buildKpis(ws, p.id, pPeriod, ["organic_sessions", "conversions", "paid_cpa", "conversion_rate"]).slice(0, 3),
        anomalies: detectAnomalies(ws.snapshots, p.id, pPeriod),
        openRecs: open.filter((r) => r.propertyId === p.id).length,
      },
    ];
  });

  const anomalies = properties.flatMap((p) => p.anomalies.map((a) => ({ ...a, propertyName: p.property.name }))).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  const wins = outcomesAll
    .filter((o) => o.verdict === "improved")
    .slice(0, 4);

  const attention = buildAttention({ plan, open, blocked, anomalies, ws });

  return { ws, period, plan, properties, anomalies, open, atRisk, wins, attention, outcomesPending: outcomesAll.filter((o) => o.verdict === "pending").length };
}

export function buildAttention(input: {
  plan: WeekPlanView;
  open: { id: string; title: string; priorityScore: number }[];
  blocked: { id: string; title: string; blockedReason: string | null; needsLeadership: boolean }[];
  anomalies: { propertyName: string; severity: string; sentiment: string; target: MetricTarget; deviation: number }[];
  ws: Workspace;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const bl = input.blocked.filter((b) => b.needsLeadership);
  for (const b of input.blocked) {
    items.push({
      id: `blocked-${b.id}`,
      tone: b.needsLeadership ? "urgent" : "risk",
      title: `Blocked: ${b.title}`,
      detail: b.blockedReason ?? "Waiting on something outside the team.",
      href: "/work",
      cta: bl.includes(b) ? "Needs leadership" : "Open board",
    });
  }
  const worst = input.anomalies.find((a) => a.severity === "high" && a.sentiment === "bad");
  if (worst && !input.blocked.some((b) => b.title.toLowerCase().includes("tracking") || b.title.toLowerCase().includes("conversion"))) {
    items.push({
      id: "anomaly",
      tone: "urgent",
      title: `${worst.target.label} moved ${Math.round(Math.abs(worst.deviation) * 100)}% off its normal range at ${worst.propertyName}`,
      detail: "Check whether this is real demand or a measurement problem before making decisions from it.",
      href: "/performance",
      cta: "Review anomaly",
    });
  }
  if (input.open.length) {
    const top = input.open[0];
    items.push({
      id: "decisions",
      tone: "decision",
      title: `${input.open.length} recommendation${input.open.length === 1 ? "" : "s"} waiting for a decision`,
      detail: `Highest priority: ${top.title}`,
      href: "/recommendations",
      cta: "Decide",
    });
  }
  const p = input.plan;
  if (!p.commitment || p.commitment.status !== "committed") {
    items.push({
      id: "plan",
      tone: "info",
      title: "This week has no committed plan",
      detail: `${p.summary.totalPlannable}h of capacity is available. Committing a realistic plan protects the team from overload.`,
      href: "/plan",
      cta: "Build the plan",
    });
  } else if (p.summary.status === "tight") {
    items.push({
      id: "plan-tight",
      tone: "risk",
      title: `This week's plan is ${Math.round(p.summary.utilization * 100)}% of capacity`,
      detail: "There's little room for surprises. Consider moving the lowest-priority item to next week.",
      href: "/plan",
      cta: "Review plan",
    });
  }
  const order = { urgent: 0, decision: 1, risk: 2, info: 3 } as const;
  return items.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 5);
}
