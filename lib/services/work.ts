import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  outcomes,
  properties,
  recommendationEvidence,
  recommendations,
  teamMembers,
  weeklyCommitments,
  workItems,
} from "@/lib/db/schema";
import { recordOutcomeForCompletion } from "./outcomes";
import { ServiceError } from "./workspace";

export type WorkRow = typeof workItems.$inferSelect;

export interface WorkView extends WorkRow {
  propertyName: string;
  assigneeName: string | null;
  weekStart: string | null;
  outcomeVerdict: "improved" | "declined" | "flat" | "pending" | null;
}

export async function listWork(db: Db, orgId: string): Promise<WorkView[]> {
  const rows = await db
    .select({
      w: workItems,
      p: properties.name,
      a: teamMembers.name,
      wk: weeklyCommitments.weekStart,
      v: outcomes.verdict,
    })
    .from(workItems)
    .innerJoin(properties, eq(properties.id, workItems.propertyId))
    .leftJoin(teamMembers, eq(teamMembers.id, workItems.assigneeId))
    .leftJoin(weeklyCommitments, eq(weeklyCommitments.id, workItems.commitmentId))
    .leftJoin(outcomes, eq(outcomes.workItemId, workItems.id))
    .where(eq(workItems.orgId, orgId))
    .orderBy(desc(workItems.priorityScore), asc(workItems.createdAt));
  return rows
    .filter((r) => r.w.status !== "complete" || (r.w.completedAt && Date.now() - r.w.completedAt.getTime() < 45 * 86_400_000))
    .map((r) => ({ ...r.w, propertyName: r.p, assigneeName: r.a, weekStart: r.wk, outcomeVerdict: r.v }));
}

export async function getWorkDetail(db: Db, orgId: string, id: string) {
  const [row] = await db
    .select({ w: workItems, p: properties.name, a: teamMembers.name, wk: weeklyCommitments.weekStart })
    .from(workItems)
    .innerJoin(properties, eq(properties.id, workItems.propertyId))
    .leftJoin(teamMembers, eq(teamMembers.id, workItems.assigneeId))
    .leftJoin(weeklyCommitments, eq(weeklyCommitments.id, workItems.commitmentId))
    .where(and(eq(workItems.id, id), eq(workItems.orgId, orgId)));
  if (!row) return null;
  const [rec] = row.w.recommendationId
    ? await db.select().from(recommendations).where(eq(recommendations.id, row.w.recommendationId))
    : [];
  const evidence = rec
    ? await db.select().from(recommendationEvidence).where(eq(recommendationEvidence.recommendationId, rec.id)).orderBy(asc(recommendationEvidence.position))
    : [];
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.workItemId, id));
  return { item: row.w, propertyName: row.p, assigneeName: row.a, weekStart: row.wk, recommendation: rec ?? null, evidence, outcome: outcome ?? null };
}

export type WorkAction =
  | { type: "start" }
  | { type: "block"; reason: string; needsLeadership?: boolean }
  | { type: "unblock" }
  | { type: "complete"; actualHours?: number; note?: string }
  | { type: "reopen" }
  | { type: "log_hours"; hours: number }
  | { type: "assign"; assigneeId: string | null };

const bad = (m: string, code: ServiceError["code"] = "conflict") => new ServiceError(m, code);

/** Moves work through the board. Illegal jumps are rejected so the board can't lie about state. */
export async function transitionWork(
  db: Db,
  args: { orgId: string; id: string; action: WorkAction; now?: Date },
): Promise<WorkRow> {
  const { orgId, id, action } = args;
  const now = args.now ?? new Date();

  const updated = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(workItems).where(and(eq(workItems.id, id), eq(workItems.orgId, orgId)));
    if (!item) throw new ServiceError("Work item not found", "not_found");
    const patch: Partial<typeof workItems.$inferInsert> = { updatedAt: now };

    switch (action.type) {
      case "start":
        if (item.status === "backlog") throw bad("Schedule this item into a week first — the weekly plan checks capacity before work starts.");
        if (item.status !== "committed" && item.status !== "blocked") throw bad("Only committed or blocked work can be started.");
        patch.status = "in_progress";
        patch.startedAt = item.startedAt ?? now;
        patch.blockedReason = null;
        patch.needsLeadership = false;
        break;
      case "block": {
        const reason = action.reason.trim();
        if (reason.length < 3) throw bad("Say what it's waiting on.", "invalid");
        if (item.status !== "committed" && item.status !== "in_progress") throw bad("Only committed or in-progress work can be blocked.");
        patch.status = "blocked";
        patch.blockedReason = reason;
        patch.needsLeadership = Boolean(action.needsLeadership);
        break;
      }
      case "unblock":
        if (item.status !== "blocked") throw bad("This item isn't blocked.");
        patch.status = item.startedAt ? "in_progress" : "committed";
        patch.blockedReason = null;
        patch.needsLeadership = false;
        break;
      case "complete": {
        if (item.status === "backlog") throw bad("Schedule this item into a week before completing it.");
        if (item.status === "complete") throw bad("Already complete.");
        if (item.status === "blocked") throw bad("Unblock this item before completing it.");
        const actual = action.actualHours ?? Math.max(item.hoursSpent, item.estimatedHours);
        if (!(actual >= 0 && actual <= 200)) throw bad("Actual hours must be between 0 and 200.", "invalid");
        patch.status = "complete";
        patch.hoursSpent = actual;
        patch.completedAt = now;
        patch.startedAt = item.startedAt ?? now;
        break;
      }
      case "reopen":
        if (item.status !== "complete") throw bad("Only completed work can be reopened.");
        patch.status = "in_progress";
        patch.completedAt = null;
        await tx.delete(outcomes).where(eq(outcomes.workItemId, id));
        break;
      case "log_hours":
        if (!(action.hours > 0 && action.hours <= 40)) throw bad("Log between 0 and 40 hours at a time.", "invalid");
        if (item.status === "complete" || item.status === "backlog") throw bad("Hours can be logged on active work.");
        patch.hoursSpent = Math.round((item.hoursSpent + action.hours) * 10) / 10;
        break;
      case "assign":
        patch.assigneeId = action.assigneeId;
        break;
    }

    const [row] = await tx.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
    return row;
  });

  if (action.type === "complete") await recordOutcomeForCompletion(db, orgId, id, now);
  return updated;
}
