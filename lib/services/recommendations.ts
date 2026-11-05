import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  properties,
  recommendationDecisions,
  recommendationEvidence,
  recommendations,
  teamMembers,
  workItems,
} from "@/lib/db/schema";
import { capRecommendations } from "@/lib/domain/entitlements";
import { generateRecommendations } from "@/lib/domain/recommendations";
import { comparePriority } from "@/lib/domain/prioritization";
import { toISODate } from "@/lib/domain/dates";
import { loadWorkspace, ServiceError, type Actor } from "./workspace";

export type RecommendationRow = typeof recommendations.$inferSelect;
export type EvidenceRow = typeof recommendationEvidence.$inferSelect;
export type DecisionRow = typeof recommendationDecisions.$inferSelect;

export const OPEN_STATUSES = ["new", "refining", "accepted"] as const;

export interface RefreshResult {
  period: string | null;
  created: number;
  updated: number;
  resurfaced: number;
}

/**
 * Re-runs the deterministic engine and reconciles with what's stored:
 *  - new fingerprints are inserted
 *  - open ones (new/refining) get fresh numbers and evidence
 *  - dismissed ones stay dismissed (institutional memory), converted ones are left alone
 *  - deferred ones resurface when their defer date has passed
 */
export async function refreshRecommendations(db: Db, orgId: string, now = new Date()): Promise<RefreshResult> {
  const ws = await loadWorkspace(db, orgId);
  const result: RefreshResult = { period: ws.period, created: 0, updated: 0, resurfaced: 0 };
  if (!ws.period) return result;

  const { recommendations: drafts } = generateRecommendations({
    properties: ws.properties.map((p) => ({ id: p.id, name: p.name, kind: p.kind, strategicWeight: p.strategicWeight })),
    snapshots: ws.snapshots,
  });

  const existing = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
  const byFingerprint = new Map(existing.map((r) => [r.fingerprint, r]));
  const today = toISODate(now);

  await db.transaction(async (tx) => {
    for (const d of drafts) {
      const found = byFingerprint.get(d.fingerprint);
      const values = {
        propertyId: d.propertyId,
        ruleKey: d.ruleKey,
        category: d.category,
        title: d.title,
        rationale: d.rationale,
        expectedOutcome: d.expectedOutcome,
        nextStep: d.nextStep,
        whyNow: d.whyNow,
        target: d.target,
        impact: d.impact,
        effort: d.effort,
        urgency: d.urgency,
        strategic: d.strategic,
        confidence: d.confidence,
        estimatedHours: d.estimatedHours,
        suggestedOwnerRole: d.suggestedOwnerRole,
        priorityScore: d.priorityScore,
        basedOnPeriod: d.period,
        updatedAt: now,
      };

      const attachEvidence = async (recId: string) => {
        await tx.delete(recommendationEvidence).where(eq(recommendationEvidence.recommendationId, recId));
        const sourceId = ws.dataSources.find((s) => s.propertyId === d.propertyId)?.id ?? null;
        if (d.evidence.length) {
          await tx.insert(recommendationEvidence).values(
            d.evidence.map((e, i) => ({
              recommendationId: recId,
              position: i,
              label: e.label,
              value: e.value,
              comparison: e.comparison ?? null,
              dataSourceId: sourceId,
            })),
          );
        }
      };

      if (!found) {
        const [row] = await tx.insert(recommendations).values({ orgId, fingerprint: d.fingerprint, ...values }).returning();
        await attachEvidence(row.id);
        result.created++;
      } else if (found.status === "new" || found.status === "refining") {
        await tx.update(recommendations).set(values).where(eq(recommendations.id, found.id));
        await attachEvidence(found.id);
        result.updated++;
      } else if (found.status === "deferred" && found.deferUntil && found.deferUntil <= today) {
        await tx.update(recommendations).set({ ...values, status: "new", deferUntil: null }).where(eq(recommendations.id, found.id));
        await attachEvidence(found.id);
        result.resurfaced++;
      }
    }
  });
  return result;
}

export interface RecommendationView extends RecommendationRow {
  propertyName: string;
  evidence: EvidenceRow[];
  decisions: DecisionRow[];
  workItemId: string | null;
}

async function hydrate(db: Db, rows: RecommendationRow[]): Promise<RecommendationView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const props = await db.select({ id: properties.id, name: properties.name }).from(properties);
  const evidence = await db.select().from(recommendationEvidence).where(inArray(recommendationEvidence.recommendationId, ids));
  const decisions = await db
    .select()
    .from(recommendationDecisions)
    .where(inArray(recommendationDecisions.recommendationId, ids))
    .orderBy(desc(recommendationDecisions.createdAt));
  const work = await db
    .select({ id: workItems.id, recommendationId: workItems.recommendationId })
    .from(workItems)
    .where(inArray(workItems.recommendationId, ids));
  return rows.map((r) => ({
    ...r,
    propertyName: props.find((p) => p.id === r.propertyId)?.name ?? "Unknown property",
    evidence: evidence.filter((e) => e.recommendationId === r.id).sort((a, b) => a.position - b.position),
    decisions: decisions.filter((d) => d.recommendationId === r.id),
    workItemId: work.find((w) => w.recommendationId === r.id)?.id ?? null,
  }));
}

export interface InboxData {
  open: RecommendationView[];
  hiddenByPlan: number;
  deferred: RecommendationView[];
  dismissed: RecommendationView[];
  converted: RecommendationView[];
}

export async function getInbox(db: Db, orgId: string): Promise<InboxData> {
  const ws = await loadWorkspace(db, orgId);
  const activeIds = new Set(ws.properties.map((p) => p.id));
  const rows = (await db.select().from(recommendations).where(eq(recommendations.orgId, orgId))).filter((r) => activeIds.has(r.propertyId));
  const views = await hydrate(db, rows);
  const sorted = [...views].sort(comparePriority);
  const isOpen = (r: RecommendationView) => (OPEN_STATUSES as readonly string[]).includes(r.status);
  const { visible, hidden } = capRecommendations(sorted.filter(isOpen), ws.planKey);
  return {
    open: visible,
    hiddenByPlan: hidden,
    deferred: sorted.filter((r) => r.status === "deferred"),
    dismissed: sorted.filter((r) => r.status === "dismissed"),
    converted: sorted.filter((r) => r.status === "converted"),
  };
}

export async function getRecommendation(db: Db, orgId: string, id: string): Promise<RecommendationView | null> {
  const rows = await db.select().from(recommendations).where(and(eq(recommendations.orgId, orgId), eq(recommendations.id, id)));
  return (await hydrate(db, rows))[0] ?? null;
}

export async function getDecisionLog(db: Db, orgId: string, limit = 50) {
  const rows = await db
    .select({
      decision: recommendationDecisions,
      title: recommendations.title,
      propertyId: recommendations.propertyId,
    })
    .from(recommendationDecisions)
    .innerJoin(recommendations, eq(recommendations.id, recommendationDecisions.recommendationId))
    .where(eq(recommendationDecisions.orgId, orgId))
    .orderBy(desc(recommendationDecisions.createdAt))
    .limit(limit);
  const props = await db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.orgId, orgId));
  return rows.map((r) => ({ ...r.decision, title: r.title, propertyName: props.find((p) => p.id === r.propertyId)?.name ?? "" }));
}

export type DecisionInput =
  | { decision: "accept"; rationale?: string; addToBacklog?: boolean; ownerId?: string | null; hours?: number }
  | { decision: "convert"; rationale?: string; ownerId?: string | null; hours?: number }
  | { decision: "defer"; rationale: string; deferUntil: string }
  | { decision: "dismiss"; rationale: string }
  | { decision: "refine"; rationale: string };

export interface DecisionResult {
  status: RecommendationRow["status"];
  workItemId: string | null;
}

/** Records the decision + rationale (institutional memory) and applies its downstream effect. */
export async function decideRecommendation(
  db: Db,
  args: { orgId: string; recommendationId: string; actor: Actor; input: DecisionInput; now?: Date },
): Promise<DecisionResult> {
  const { orgId, recommendationId, actor, input } = args;
  const now = args.now ?? new Date();

  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.id, recommendationId), eq(recommendations.orgId, orgId)));
    if (!rec) throw new ServiceError("Recommendation not found", "not_found");

    const rationale = (input.rationale ?? "").trim();
    if ((input.decision === "dismiss" || input.decision === "refine" || input.decision === "defer") && rationale.length < 3) {
      throw new ServiceError(
        input.decision === "dismiss"
          ? "Add a short reason so the team remembers why this was dismissed."
          : input.decision === "defer"
            ? "Add a short reason for deferring."
            : "Say what you'd like refined.",
      );
    }
    if (input.decision === "defer" && !/^\d{4}-\d{2}-\d{2}$/.test(input.deferUntil)) {
      throw new ServiceError("Choose a date to revisit this.");
    }
    if (rec.status === "converted" && input.decision !== "refine") {
      throw new ServiceError("This recommendation is already work. Manage it on the work board.", "conflict");
    }

    let status: RecommendationRow["status"] = rec.status;
    let workItemId: string | null = null;
    let deferUntil: string | null = null;

    const wantsWork = input.decision === "convert" || (input.decision === "accept" && input.addToBacklog !== false);

    if (input.decision === "accept") status = "accepted";
    if (input.decision === "defer") {
      status = "deferred";
      deferUntil = input.deferUntil;
    }
    if (input.decision === "dismiss") status = "dismissed";
    if (input.decision === "refine") status = "refining";

    if (wantsWork) {
      const existing = await tx.select({ id: workItems.id }).from(workItems).where(eq(workItems.recommendationId, rec.id));
      if (existing.length) {
        workItemId = existing[0].id;
      } else {
        const ownerId =
          (input as { ownerId?: string | null }).ownerId ?? (await suggestOwnerId(tx as unknown as Db, orgId, rec.suggestedOwnerRole));
        const [prop] = await tx.select().from(properties).where(eq(properties.id, rec.propertyId));
        const hours = (input as { hours?: number }).hours;
        const [item] = await tx
          .insert(workItems)
          .values({
            orgId,
            propertyId: rec.propertyId,
            recommendationId: rec.id,
            title: rec.title,
            description: rec.nextStep,
            category: rec.category,
            status: "backlog",
            assigneeId: ownerId,
            estimatedHours: hours && hours > 0 ? hours : rec.estimatedHours,
            priorityScore: rec.priorityScore,
            objective: prop?.goal ?? "",
            expectedOutcome: rec.expectedOutcome,
            target: rec.target,
          })
          .returning({ id: workItems.id });
        workItemId = item.id;
      }
      status = "converted";
    }

    await tx
      .update(recommendations)
      .set({ status, deferUntil, updatedAt: now })
      .where(eq(recommendations.id, rec.id));

    await tx.insert(recommendationDecisions).values({
      orgId,
      recommendationId: rec.id,
      decision: input.decision,
      rationale,
      decidedByUserId: actor.userId,
      decidedByName: actor.name,
      deferUntil,
      createdAt: now,
    });

    return { status, workItemId };
  });
}

/** Picks the team member whose role matches the recommendation's suggested owner, else the least-loaded. */
export async function suggestOwnerId(db: Db, orgId: string, role: string): Promise<string | null> {
  const team = await db.select().from(teamMembers).where(and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)));
  if (!team.length) return null;
  return (team.find((t) => t.roleKey === role) ?? team[0]).id;
}

export async function countOpen(db: Db, orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(and(eq(recommendations.orgId, orgId), inArray(recommendations.status, ["new", "refining"])));
  return row?.n ?? 0;
}

/** Deferred recommendations whose date has arrived come back to the inbox. */
export async function resurfaceDeferred(db: Db, orgId: string, now = new Date()) {
  await db
    .update(recommendations)
    .set({ status: "new", deferUntil: null })
    .where(and(eq(recommendations.orgId, orgId), eq(recommendations.status, "deferred"), lte(recommendations.deferUntil, toISODate(now))));
}
