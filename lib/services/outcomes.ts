import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import { outcomes, properties, workItems } from "@/lib/db/schema";
import { monthStart } from "@/lib/domain/dates";
import { evaluateTarget, pctChange } from "@/lib/domain/metrics";
import { measureOutcome } from "@/lib/domain/outcomes";
import type { MetricTarget, Snapshot } from "@/lib/domain/types";
import { loadSnapshots } from "./workspace";

export type OutcomeRow = typeof outcomes.$inferSelect;

/** Distinct periods present for a property, ascending. */
function periodsFor(rows: Snapshot[], propertyId: string): string[] {
  return [...new Set(rows.filter((r) => r.propertyId === propertyId).map((r) => r.periodStart))].sort();
}

/**
 * Baseline = the last complete month *before* the work was finished, so the
 * comparison never includes the change itself.
 */
export function pickBaselinePeriod(periods: string[], completedAt: Date): string | null {
  const cutoff = monthStart(completedAt);
  const before = periods.filter((p) => p < cutoff);
  return before.length ? before[before.length - 1] : null;
}

export function pickCurrentPeriod(periods: string[], baseline: string): string | null {
  const latest = periods[periods.length - 1];
  return latest && latest > baseline ? latest : null;
}

export interface MeasureContext {
  snapshots: Snapshot[];
  propertyId: string;
  target: MetricTarget;
  baselinePeriod: string | null;
  experiment?: boolean;
}

export function measureAgainstData(ctx: MeasureContext) {
  const periods = periodsFor(ctx.snapshots, ctx.propertyId);
  const baselinePeriod = ctx.baselinePeriod;
  const baselineValue = baselinePeriod ? evaluateTarget(ctx.snapshots, ctx.propertyId, ctx.target, baselinePeriod) : null;
  const currentPeriod = baselinePeriod ? pickCurrentPeriod(periods, baselinePeriod) : null;
  const currentValue = currentPeriod ? evaluateTarget(ctx.snapshots, ctx.propertyId, ctx.target, currentPeriod) : null;

  // Whole-property movement of the same metric, used to judge whether the change is localised.
  const wide: MetricTarget = { ...ctx.target, dimension: "property", key: "" };
  const propertyChange =
    baselinePeriod && currentPeriod
      ? pctChange(evaluateTarget(ctx.snapshots, ctx.propertyId, wide, currentPeriod), evaluateTarget(ctx.snapshots, ctx.propertyId, wide, baselinePeriod))
      : null;

  const m = measureOutcome({ target: ctx.target, baselineValue, currentValue: currentPeriod ? currentValue : null, propertyChange, experiment: ctx.experiment });
  return { baselineValue, baselinePeriod, currentValue, currentPeriod, ...m };
}

/** Called when work is completed: records the baseline and, if newer data exists, an initial reading. */
export async function recordOutcomeForCompletion(db: Db, orgId: string, workItemId: string, completedAt: Date) {
  const [item] = await db.select().from(workItems).where(and(eq(workItems.id, workItemId), eq(workItems.orgId, orgId)));
  if (!item || !item.target) return null;

  const snapshots = await loadSnapshots(db, orgId, [item.propertyId]);
  const baselinePeriod = pickBaselinePeriod(periodsFor(snapshots, item.propertyId), completedAt);
  const m = measureAgainstData({ snapshots, propertyId: item.propertyId, target: item.target, baselinePeriod });

  const values = {
    orgId,
    workItemId,
    propertyId: item.propertyId,
    target: item.target,
    baselineValue: m.baselineValue,
    baselinePeriod: m.baselinePeriod,
    currentValue: m.currentValue,
    currentPeriod: m.currentPeriod,
    changePct: m.changePct,
    verdict: m.verdict,
    evidenceStrength: m.evidenceStrength,
    note:
      m.verdict === "pending"
        ? "Baseline captured at completion. Cuework will compare against the next month of data as soon as it's imported or synced."
        : "",
    measuredAt: m.verdict === "pending" ? null : new Date(),
  };
  const [row] = await db
    .insert(outcomes)
    .values(values)
    .onConflictDoUpdate({ target: outcomes.workItemId, set: values })
    .returning();
  return row;
}

/** Re-measures every outcome against the latest data. Safe to call after any import. */
export async function measureOutcomes(db: Db, orgId: string): Promise<{ measured: number }> {
  const rows = await db.select().from(outcomes).where(eq(outcomes.orgId, orgId));
  if (!rows.length) return { measured: 0 };
  const snapshots = await loadSnapshots(db, orgId);
  let measured = 0;
  for (const o of rows) {
    const m = measureAgainstData({
      snapshots,
      propertyId: o.propertyId,
      target: o.target,
      baselinePeriod: o.baselinePeriod,
      experiment: o.evidenceStrength === "experiment",
    });
    if (m.verdict === "pending") continue;
    await db
      .update(outcomes)
      .set({
        baselineValue: m.baselineValue,
        currentValue: m.currentValue,
        currentPeriod: m.currentPeriod,
        changePct: m.changePct,
        verdict: m.verdict,
        evidenceStrength: m.evidenceStrength,
        measuredAt: new Date(),
      })
      .where(eq(outcomes.id, o.id));
    measured++;
  }
  return { measured };
}

export interface OutcomeView extends OutcomeRow {
  workTitle: string;
  propertyName: string;
  completedAt: Date | null;
  recommendationId: string | null;
  hours: number;
}

export async function listOutcomes(db: Db, orgId: string): Promise<OutcomeView[]> {
  const rows = await db
    .select({ o: outcomes, w: workItems, p: properties.name })
    .from(outcomes)
    .innerJoin(workItems, eq(workItems.id, outcomes.workItemId))
    .innerJoin(properties, eq(properties.id, outcomes.propertyId))
    .where(eq(outcomes.orgId, orgId))
    .orderBy(desc(workItems.completedAt));
  return rows.map(({ o, w, p }) => ({
    ...o,
    workTitle: w.title,
    propertyName: p,
    completedAt: w.completedAt,
    recommendationId: w.recommendationId,
    hours: Math.max(w.hoursSpent, w.estimatedHours),
  }));
}
