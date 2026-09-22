import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  properties,
  recommendations,
  weeklyCapacity,
  weeklyCommitments,
  workItems,
} from "@/lib/db/schema";
import {
  completionRate,
  computePlan,
  type CapacityMember,
  type PlanItem,
  type PlanSummary,
} from "@/lib/domain/capacity";
import { addDays, parseISODate, weekStart as toWeekStart } from "@/lib/domain/dates";
import type { Category } from "@/lib/domain/types";
import { loadWorkspace, ServiceError, type Actor } from "./workspace";

export interface PlanMemberView {
  id: string;
  name: string;
  title: string;
  roleKey: string;
  defaultWeeklyHours: number;
  defaultReservedHours: number;
  totalHours: number;
  reservedHours: number;
  note: string;
  plannable: number;
}

export interface PlanItemView {
  id: string;
  title: string;
  propertyId: string;
  propertyName: string;
  category: Category;
  status: "backlog" | "committed" | "in_progress" | "blocked" | "complete";
  assigneeId: string | null;
  /** Hours counted against capacity: the larger of estimate and time already logged. */
  hours: number;
  estimatedHours: number;
  hoursSpent: number;
  priorityScore: number;
  rank: number;
  /** In-flight or finished work can't be removed from a week by the planner. */
  locked: boolean;
  blockedReason: string | null;
  needsLeadership: boolean;
  recommendationId: string | null;
}

export interface WeekPlanView {
  weekStart: string;
  commitment: { id: string; status: "draft" | "committed"; committedAt: string | null; committedByName: string | null } | null;
  members: PlanMemberView[];
  items: PlanItemView[];
  candidates: PlanItemView[];
  buffer: number;
  history: { weeks: number; committedHours: number; completedHours: number; rate: number | null };
  openRecommendations: number;
  summary: PlanSummary;
}

export const planHours = (estimated: number, spent: number) => Math.max(estimated, spent);
const LOCKED = new Set(["in_progress", "blocked", "complete"]);

export function assertWeekStart(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(parseISODate(iso).getTime())) throw new ServiceError("Invalid week.");
  return toWeekStart(iso);
}

export function toCapacityMembers(members: PlanMemberView[]): CapacityMember[] {
  return members.map((m) => ({ id: m.id, name: m.name, plannableHours: m.plannable }));
}

export function toPlanItems(items: PlanItemView[]): PlanItem[] {
  return items.map((i) => ({
    id: i.id,
    title: i.title,
    assigneeId: i.assigneeId,
    hours: i.hours,
    priorityScore: i.priorityScore,
    locked: i.locked,
  }));
}

export async function getWeekPlan(db: Db, orgId: string, weekStartIso: string): Promise<WeekPlanView> {
  const weekStart = assertWeekStart(weekStartIso);
  const ws = await loadWorkspace(db, orgId);

  const caps = await db.select().from(weeklyCapacity).where(and(eq(weeklyCapacity.orgId, orgId), eq(weeklyCapacity.weekStart, weekStart)));
  const members: PlanMemberView[] = ws.team.map((t) => {
    const c = caps.find((x) => x.teamMemberId === t.id);
    const totalHours = c?.totalHours ?? t.defaultWeeklyHours;
    const reservedHours = c?.reservedHours ?? t.defaultReservedHours;
    return {
      id: t.id,
      name: t.name,
      title: t.title,
      roleKey: t.roleKey,
      defaultWeeklyHours: t.defaultWeeklyHours,
      defaultReservedHours: t.defaultReservedHours,
      totalHours,
      reservedHours,
      note: c?.note ?? "",
      plannable: Math.max(0, totalHours - reservedHours),
    };
  });

  const [commitment] = await db
    .select()
    .from(weeklyCommitments)
    .where(and(eq(weeklyCommitments.orgId, orgId), eq(weeklyCommitments.weekStart, weekStart)));

  const propName = new Map(ws.properties.map((p) => [p.id, p.name]));
  const toView = (w: typeof workItems.$inferSelect): PlanItemView => ({
    id: w.id,
    title: w.title,
    propertyId: w.propertyId,
    propertyName: propName.get(w.propertyId) ?? "Archived property",
    category: w.category,
    status: w.status,
    assigneeId: w.assigneeId,
    hours: planHours(w.estimatedHours, w.hoursSpent),
    estimatedHours: w.estimatedHours,
    hoursSpent: w.hoursSpent,
    priorityScore: w.priorityScore,
    rank: w.rank,
    locked: LOCKED.has(w.status),
    blockedReason: w.blockedReason,
    needsLeadership: w.needsLeadership,
    recommendationId: w.recommendationId,
  });

  const inPlan = commitment
    ? (await db.select().from(workItems).where(and(eq(workItems.orgId, orgId), eq(workItems.commitmentId, commitment.id))).orderBy(asc(workItems.rank))).map(toView)
    : [];

  // Candidates: accepted work not yet scheduled, plus unfinished work carried over from earlier weeks.
  const olderCommitments = await db
    .select({ id: weeklyCommitments.id })
    .from(weeklyCommitments)
    .where(and(eq(weeklyCommitments.orgId, orgId), lt(weeklyCommitments.weekStart, weekStart)));
  const olderIds = olderCommitments.map((c) => c.id);
  const candidateRows = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.orgId, orgId),
        inArray(workItems.status, ["backlog", "committed", "in_progress", "blocked"]),
        or(isNull(workItems.commitmentId), olderIds.length ? inArray(workItems.commitmentId, olderIds) : undefined),
      ),
    )
    .orderBy(desc(workItems.priorityScore));
  const candidates = candidateRows.filter((c) => propName.has(c.propertyId)).map(toView);

  // How much of what this team committed did it actually finish recently?
  const recent = await db
    .select()
    .from(weeklyCommitments)
    .where(and(eq(weeklyCommitments.orgId, orgId), eq(weeklyCommitments.status, "committed"), lt(weeklyCommitments.weekStart, weekStart)))
    .orderBy(desc(weeklyCommitments.weekStart))
    .limit(4);
  let committedHours = 0;
  let completedHours = 0;
  if (recent.length) {
    const rows = await db.select().from(workItems).where(inArray(workItems.commitmentId, recent.map((r) => r.id)));
    // Use the hours snapshot taken at commit time: carrying an unfinished item into a new week
    // moves it out of the old commitment, and that must not make past weeks look better than they were.
    committedHours = recent.reduce((s, c) => s + (c.plannedHours ?? rows.filter((r) => r.commitmentId === c.id).reduce((t, r) => t + r.estimatedHours, 0)), 0);
    completedHours = rows.filter((r) => r.status === "complete").reduce((s, r) => s + r.estimatedHours, 0);
  }
  const rate = completionRate([{ committedHours, completedHours }]);

  const openRecs = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(and(eq(recommendations.orgId, orgId), inArray(recommendations.status, ["new", "refining"])));

  const summary = computePlan(toCapacityMembers(members), toPlanItems(inPlan), { buffer: ws.org.planningBuffer });

  return {
    weekStart,
    commitment: commitment
      ? { id: commitment.id, status: commitment.status, committedAt: commitment.committedAt?.toISOString() ?? null, committedByName: commitment.committedByName }
      : null,
    members,
    items: inPlan,
    candidates,
    buffer: ws.org.planningBuffer,
    history: { weeks: recent.length, committedHours, completedHours, rate },
    openRecommendations: openRecs.length,
    summary,
  };
}

export interface SavePlanInput {
  orgId: string;
  weekStart: string;
  actor: Actor;
  /** Ordered: index = priority rank. */
  items: { id: string; assigneeId: string | null }[];
  capacity: { memberId: string; totalHours: number; reservedHours: number; note?: string }[];
  commit: boolean;
  now?: Date;
}

/**
 * Persists a week's plan. The capacity rule is enforced here — not just in the
 * browser — so no client can commit an over-capacity plan.
 */
export async function saveWeekPlan(db: Db, input: SavePlanInput): Promise<PlanSummary> {
  const weekStart = assertWeekStart(input.weekStart);
  const { orgId, actor } = input;
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const ws = await loadWorkspace(txDb, orgId);
    const memberIds = new Set(ws.team.map((t) => t.id));

    for (const c of input.capacity) {
      if (!memberIds.has(c.memberId)) throw new ServiceError("Unknown team member.", "not_found");
      if (!(c.totalHours >= 0 && c.totalHours <= 80) || !(c.reservedHours >= 0 && c.reservedHours <= c.totalHours)) {
        throw new ServiceError("Capacity hours must be between 0 and 80, and reserved hours can't exceed total hours.");
      }
    }
    for (const it of input.items) {
      if (it.assigneeId && !memberIds.has(it.assigneeId)) throw new ServiceError("Unknown assignee.", "not_found");
    }

    // Capacity first, so the plan is evaluated against what the user just set.
    for (const c of input.capacity) {
      await tx
        .insert(weeklyCapacity)
        .values({ orgId, teamMemberId: c.memberId, weekStart, totalHours: c.totalHours, reservedHours: c.reservedHours, note: (c.note ?? "").slice(0, 200) })
        .onConflictDoUpdate({
          target: [weeklyCapacity.teamMemberId, weeklyCapacity.weekStart],
          set: { totalHours: c.totalHours, reservedHours: c.reservedHours, note: (c.note ?? "").slice(0, 200) },
        });
    }

    let [commitment] = await tx
      .select()
      .from(weeklyCommitments)
      .where(and(eq(weeklyCommitments.orgId, orgId), eq(weeklyCommitments.weekStart, weekStart)));
    const wasCommitted = commitment?.status === "committed";
    // Once committed, every later save must still fit: amending is committing again.
    const commit = input.commit || wasCommitted;

    const current = commitment
      ? await tx.select().from(workItems).where(and(eq(workItems.orgId, orgId), eq(workItems.commitmentId, commitment.id)))
      : [];
    const currentById = new Map(current.map((w) => [w.id, w]));

    const requestedIds = input.items.map((i) => i.id);
    if (new Set(requestedIds).size !== requestedIds.length) throw new ServiceError("An item appears twice in the plan.");
    const requested = requestedIds.length
      ? await tx.select().from(workItems).where(and(eq(workItems.orgId, orgId), inArray(workItems.id, requestedIds)))
      : [];
    if (requested.length !== requestedIds.length) throw new ServiceError("One or more work items no longer exist.", "not_found");
    for (const r of requested) {
      if (r.status === "complete" && !currentById.has(r.id)) throw new ServiceError(`“${r.title}” is already complete.`, "conflict");
    }

    // In-flight work already in this week can't be dropped by the planner.
    const finalIds = [...requestedIds];
    for (const c of current) if (LOCKED.has(c.status) && !finalIds.includes(c.id)) finalIds.push(c.id);
    const assigneeOverride = new Map(input.items.map((i) => [i.id, i.assigneeId]));
    const all = new Map<string, typeof workItems.$inferSelect>([...requested, ...current].map((w) => [w.id, w]));

    const planItems: PlanItem[] = finalIds.map((fid) => {
      const w = all.get(fid)!;
      return {
        id: fid,
        title: w.title,
        assigneeId: assigneeOverride.has(fid) ? assigneeOverride.get(fid)! : w.assigneeId,
        hours: planHours(w.estimatedHours, w.hoursSpent),
        priorityScore: w.priorityScore,
        locked: LOCKED.has(w.status),
      };
    });

    const caps = await tx.select().from(weeklyCapacity).where(and(eq(weeklyCapacity.orgId, orgId), eq(weeklyCapacity.weekStart, weekStart)));
    const members: CapacityMember[] = ws.team.map((t) => {
      const c = caps.find((x) => x.teamMemberId === t.id);
      return { id: t.id, name: t.name, plannableHours: Math.max(0, (c?.totalHours ?? t.defaultWeeklyHours) - (c?.reservedHours ?? t.defaultReservedHours)) };
    });
    const summary = computePlan(members, planItems, { buffer: ws.org.planningBuffer });

    if (commit && !summary.canCommit) throw new ServiceError(summary.blockReason ?? "This plan can't be committed.", "limit");

    if (!commitment) {
      [commitment] = await tx.insert(weeklyCommitments).values({ orgId, weekStart, status: "draft" }).returning();
    }

    // Anything that left the plan goes back to the backlog (unless it's in-flight, handled above).
    for (const c of current) {
      if (!finalIds.includes(c.id)) {
        await tx.update(workItems).set({ commitmentId: null, status: "backlog", rank: 0, updatedAt: now }).where(eq(workItems.id, c.id));
      }
    }

    for (let rank = 0; rank < planItems.length; rank++) {
      const p = planItems[rank];
      const w = all.get(p.id)!;
      const nextStatus = LOCKED.has(w.status) ? w.status : commit ? "committed" : "backlog";
      await tx
        .update(workItems)
        .set({ commitmentId: commitment.id, assigneeId: p.assigneeId, rank, status: nextStatus, updatedAt: now })
        .where(eq(workItems.id, p.id));
    }

    await tx
      .update(weeklyCommitments)
      .set({
        status: commit ? "committed" : "draft",
        committedAt: commit ? (wasCommitted ? commitment.committedAt ?? now : now) : null,
        committedByName: commit ? actor.name : null,
        plannableHours: summary.totalPlannable,
        plannedHours: summary.totalPlanned,
      })
      .where(eq(weeklyCommitments.id, commitment.id));

    return summary;
  });
}

/** The Monday of the week containing `now`, plus helpers for navigation. */
export function currentWeek(now = new Date()) {
  const start = toWeekStart(now);
  return { start, prev: addDays(start, -7), next: addDays(start, 7) };
}

export async function propertyNames(db: Db, orgId: string) {
  const rows = await db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r.name]));
}
