import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  leadershipReports,
  outcomes,
  recommendationDecisions,
  recommendations,
  teamMembers,
  workItems,
} from "@/lib/db/schema";
import { addDays, formatDay, toISODate, weekStart as toWeekStart } from "@/lib/domain/dates";
import { commonPeriod, detectAnomalies, formatMetricValue, formatPct } from "@/lib/domain/metrics";
import { briefToMarkdown, buildBrief, type BriefContent, type CompletedBrief } from "@/lib/domain/reporting";
import { getWeekPlan } from "./planning";
import { loadWorkspace, ServiceError, sourceLabel, type Actor } from "./workspace";

const DECISION_LABEL: Record<string, string> = {
  accept: "Accepted",
  convert: "Converted to work",
  defer: "Deferred",
  dismiss: "Dismissed",
  refine: "Sent for refinement",
};

/** Builds the brief from live workspace state. Nothing here is invented: each line comes from a query. */
export async function buildLiveBrief(db: Db, orgId: string, now = new Date()): Promise<BriefContent> {
  const ws = await loadWorkspace(db, orgId);
  const period = commonPeriod(ws.snapshots);
  if (!period) throw new ServiceError("Import or connect some data before generating a brief.");

  // Activity covers everything since the reporting month began, so the brief reads as one story.
  const from = period;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const propName = new Map(ws.properties.map((p) => [p.id, p.name]));

  const completedRows = await db
    .select({ w: workItems, o: outcomes })
    .from(workItems)
    .leftJoin(outcomes, eq(outcomes.workItemId, workItems.id))
    .where(and(eq(workItems.orgId, orgId), eq(workItems.status, "complete"), gte(workItems.completedAt, fromDate)))
    .orderBy(desc(workItems.completedAt));

  const completed: CompletedBrief[] = completedRows
    .filter(({ w }) => propName.has(w.propertyId))
    .map(({ w, o }) => ({
      title: w.title,
      property: propName.get(w.propertyId)!,
      hours: Math.max(w.hoursSpent, w.estimatedHours),
      completedOn: formatDay(toISODate(w.completedAt!)),
      hasMetric: Boolean(o),
      outcome:
        o && o.verdict !== "pending" && o.baselineValue != null && o.currentValue != null
          ? {
              metric: o.target.label,
              baseline: formatMetricValue(o.target.metric, o.baselineValue),
              current: formatMetricValue(o.target.metric, o.currentValue),
              change: formatPct(o.changePct),
              verdict: o.verdict,
              evidence: o.evidenceStrength,
            }
          : null,
    }));

  const decisionRows = await db
    .select({ d: recommendationDecisions, title: recommendations.title, propertyId: recommendations.propertyId })
    .from(recommendationDecisions)
    .innerJoin(recommendations, eq(recommendations.id, recommendationDecisions.recommendationId))
    .where(and(eq(recommendationDecisions.orgId, orgId), gte(recommendationDecisions.createdAt, fromDate), lte(recommendationDecisions.createdAt, now)))
    .orderBy(desc(recommendationDecisions.createdAt));
  const decisions = decisionRows
    .filter((r) => propName.has(r.propertyId))
    .map((r) => ({
      title: r.title,
      property: propName.get(r.propertyId)!,
      decision: DECISION_LABEL[r.d.decision] ?? r.d.decision,
      rationale: r.d.rationale,
      by: r.d.decidedByName,
      on: formatDay(toISODate(r.d.createdAt)),
    }));

  const blockedRows = await db
    .select({ w: workItems, a: teamMembers.name })
    .from(workItems)
    .leftJoin(teamMembers, eq(teamMembers.id, workItems.assigneeId))
    .where(and(eq(workItems.orgId, orgId), eq(workItems.status, "blocked")));
  const blocked = blockedRows
    .filter(({ w }) => propName.has(w.propertyId))
    .map(({ w, a }) => ({
      title: w.title,
      property: propName.get(w.propertyId)!,
      reason: w.blockedReason ?? "Waiting on an external dependency.",
      owner: a ?? "Unassigned",
      needsLeadership: w.needsLeadership,
    }));

  const plan = await getWeekPlan(db, orgId, toWeekStart(now));
  const memberName = new Map(plan.members.map((m) => [m.id, m.name]));
  const nextWeek = {
    week: `${formatDay(plan.weekStart)} – ${formatDay(addDays(plan.weekStart, 6))}`,
    committedHours: plan.summary.totalPlanned,
    plannableHours: plan.summary.totalPlannable,
    status: (plan.commitment?.status ?? "none") as "committed" | "draft" | "none",
    items: plan.items.map((i) => ({ title: i.title, property: i.propertyName, owner: (i.assigneeId && memberName.get(i.assigneeId)) || "Unassigned", hours: i.hours })),
  };

  const anomalies = ws.properties.flatMap((p) => detectAnomalies(ws.snapshots, p.id, period).map((a) => ({ ...a, propertyName: p.name })));

  const openDecisionCount = (
    await db.select({ id: recommendations.id, status: recommendations.status }).from(recommendations).where(eq(recommendations.orgId, orgId))
  ).filter((r) => r.status === "new" || r.status === "refining").length;

  const sources = [...new Set(ws.dataSources.map((d) => sourceLabel(d.status)))];

  return buildBrief({
    orgName: ws.org.name,
    period,
    snapshots: ws.snapshots,
    properties: ws.properties.map((p) => ({ id: p.id, name: p.name, conversionLabel: p.conversionLabel })),
    anomalies,
    activityFrom: from,
    activityTo: toISODate(now),
    completed,
    decisions,
    blocked,
    nextWeek,
    openDecisionCount,
    sources: sources.length ? sources : ["No data yet"],
  });
}

export async function saveBrief(db: Db, args: { orgId: string; actor: Actor; note: string; now?: Date }) {
  const content = await buildLiveBrief(db, args.orgId, args.now);
  const note = args.note.trim().slice(0, 1500);
  const [row] = await db
    .insert(leadershipReports)
    .values({
      orgId: args.orgId,
      periodStart: content.period,
      title: `Leadership brief — ${content.performanceWindow.split(" vs.")[0]}`,
      headline: content.headline,
      content,
      markdown: briefToMarkdown(content, note),
      note,
      createdByName: args.actor.name,
    })
    .returning();
  return row;
}

export async function listReports(db: Db, orgId: string) {
  return db
    .select({ id: leadershipReports.id, title: leadershipReports.title, headline: leadershipReports.headline, createdAt: leadershipReports.createdAt, createdByName: leadershipReports.createdByName })
    .from(leadershipReports)
    .where(eq(leadershipReports.orgId, orgId))
    .orderBy(desc(leadershipReports.createdAt));
}

export async function getReport(db: Db, orgId: string, id: string) {
  const [row] = await db.select().from(leadershipReports).where(and(eq(leadershipReports.id, id), eq(leadershipReports.orgId, orgId)));
  return row ?? null;
}

