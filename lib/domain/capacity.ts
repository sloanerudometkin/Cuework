/**
 * Capacity-aware weekly planning — the signature Cuework mechanic.
 *
 * A commitment is only valid if every person's assigned hours fit inside their
 * plannable hours (weekly hours − reserved hours for meetings/BAU/time off) and
 * every item has an owner. Utilisation above (1 − buffer) is "tight": allowed,
 * but flagged, because plans that use 100% of capacity fail on the first surprise.
 */

export interface CapacityMember {
  id: string;
  name: string;
  /** Hours this person can actually put into planned work this week. */
  plannableHours: number;
}

export interface PlanItem {
  id: string;
  title: string;
  assigneeId: string | null;
  hours: number;
  priorityScore: number;
  /** Items already underway/finished can't be dropped by trimming. */
  locked?: boolean;
}

export type LoadStatus = "healthy" | "tight" | "over";

export interface MemberLoad {
  memberId: string;
  name: string;
  plannable: number;
  planned: number;
  remaining: number;
  utilization: number;
  status: LoadStatus;
}

export type WarningKind = "member_over" | "total_over" | "unassigned" | "tight" | "empty" | "no_capacity";

export interface PlanWarning {
  kind: WarningKind;
  severity: "block" | "warn";
  message: string;
  memberId?: string;
}

export interface PlanSummary {
  members: MemberLoad[];
  unassignedHours: number;
  unassignedCount: number;
  totalPlannable: number;
  totalPlanned: number;
  totalRemaining: number;
  utilization: number;
  status: LoadStatus;
  warnings: PlanWarning[];
  /** True only when the plan can be committed. */
  canCommit: boolean;
  /** Why not, in one sentence (null when committable). */
  blockReason: string | null;
}

export const DEFAULT_BUFFER = 0.15;

const round1 = (n: number) => Math.round(n * 10) / 10;
const EPS = 1e-9;

export function loadStatus(utilization: number, buffer = DEFAULT_BUFFER): LoadStatus {
  if (utilization > 1 + EPS) return "over";
  if (utilization > 1 - buffer + EPS) return "tight";
  return "healthy";
}

export function computePlan(members: CapacityMember[], items: PlanItem[], opts: { buffer?: number } = {}): PlanSummary {
  const buffer = opts.buffer ?? DEFAULT_BUFFER;
  const byMember = new Map<string, number>();
  let unassignedHours = 0;
  let unassignedCount = 0;

  for (const it of items) {
    if (it.assigneeId && members.some((m) => m.id === it.assigneeId)) {
      byMember.set(it.assigneeId, (byMember.get(it.assigneeId) ?? 0) + it.hours);
    } else {
      unassignedHours += it.hours;
      unassignedCount += 1;
    }
  }

  const loads: MemberLoad[] = members.map((m) => {
    const planned = byMember.get(m.id) ?? 0;
    const utilization = m.plannableHours > 0 ? planned / m.plannableHours : planned > 0 ? Infinity : 0;
    return {
      memberId: m.id,
      name: m.name,
      plannable: round1(m.plannableHours),
      planned: round1(planned),
      remaining: round1(m.plannableHours - planned),
      utilization,
      status: loadStatus(utilization, buffer),
    };
  });

  const totalPlannable = members.reduce((s, m) => s + m.plannableHours, 0);
  const totalPlanned = items.reduce((s, i) => s + i.hours, 0);
  const utilization = totalPlannable > 0 ? totalPlanned / totalPlannable : totalPlanned > 0 ? Infinity : 0;
  const status = loadStatus(utilization, buffer);

  const warnings: PlanWarning[] = [];
  if (totalPlannable <= 0) {
    warnings.push({ kind: "no_capacity", severity: "block", message: "No plannable capacity is set for this week." });
  }
  for (const l of loads) {
    if (l.status === "over") {
      warnings.push({
        kind: "member_over",
        severity: "block",
        memberId: l.memberId,
        message: `${l.name} is over capacity by ${round1(l.planned - l.plannable)}h (${round1(l.planned)}h planned of ${round1(l.plannable)}h).`,
      });
    } else if (l.status === "tight") {
      warnings.push({
        kind: "tight",
        severity: "warn",
        memberId: l.memberId,
        message: `${l.name} is at ${Math.round(l.utilization * 100)}% — little room for surprises.`,
      });
    }
  }
  if (totalPlanned > totalPlannable + EPS && totalPlannable > 0) {
    warnings.push({
      kind: "total_over",
      severity: "block",
      message: `The team plan exceeds capacity by ${round1(totalPlanned - totalPlannable)}h.`,
    });
  }
  if (unassignedCount > 0) {
    warnings.push({
      kind: "unassigned",
      severity: "block",
      message: `${unassignedCount} item${unassignedCount > 1 ? "s" : ""} (${round1(unassignedHours)}h) need an owner before you can commit.`,
    });
  }
  if (items.length === 0) {
    warnings.push({ kind: "empty", severity: "block", message: "Add at least one item to commit a plan." });
  }

  const blocking = warnings.filter((w) => w.severity === "block");
  return {
    members: loads,
    unassignedHours: round1(unassignedHours),
    unassignedCount,
    totalPlannable: round1(totalPlannable),
    totalPlanned: round1(totalPlanned),
    totalRemaining: round1(totalPlannable - totalPlanned),
    utilization,
    status,
    warnings,
    canCommit: blocking.length === 0,
    blockReason: blocking[0]?.message ?? null,
  };
}

export interface FitCandidate {
  id: string;
  hours: number;
  priorityScore: number;
  /** Preferred owner (member id); used first if they have room. */
  preferredAssigneeId: string | null;
}

export interface FitResult {
  selected: { id: string; assigneeId: string }[];
  skipped: { id: string; reason: string }[];
}

/**
 * Greedy priority-first fill. Items are taken in score order; each goes to its
 * preferred owner if they have room, otherwise to whoever has the most room.
 * Anything that doesn't fit is skipped (not truncated) and smaller, lower-ranked
 * items can still use leftover room. Fills to (1 − buffer) of capacity by default
 * so the suggested plan is one the team can actually finish.
 *
 * `existing` items are already in the plan and are counted before anything is added.
 */
export function autoFit(
  members: CapacityMember[],
  existing: PlanItem[],
  candidates: FitCandidate[],
  opts: { buffer?: number } = {},
): FitResult {
  const buffer = opts.buffer ?? DEFAULT_BUFFER;
  const room = new Map<string, number>();
  for (const m of members) room.set(m.id, m.plannableHours * (1 - buffer));
  for (const it of existing) {
    if (it.assigneeId && room.has(it.assigneeId)) room.set(it.assigneeId, room.get(it.assigneeId)! - it.hours);
  }

  const selected: FitResult["selected"] = [];
  const skipped: FitResult["skipped"] = [];
  const ordered = [...candidates].sort((a, b) => b.priorityScore - a.priorityScore || a.hours - b.hours);

  for (const c of ordered) {
    const preferred = c.preferredAssigneeId && room.has(c.preferredAssigneeId) ? c.preferredAssigneeId : null;
    let target: string | null = null;
    if (preferred && room.get(preferred)! + EPS >= c.hours) {
      target = preferred;
    } else {
      let best = -Infinity;
      for (const [id, r] of room) {
        if (r + EPS >= c.hours && r > best) {
          best = r;
          target = id;
        }
      }
    }
    if (target) {
      room.set(target, room.get(target)! - c.hours);
      selected.push({ id: c.id, assigneeId: target });
    } else {
      skipped.push({ id: c.id, reason: `${c.hours}h doesn't fit in anyone's remaining capacity` });
    }
  }
  return { selected, skipped };
}

/** Members who could absorb `hours` more without going over (most room first). */
export function membersWithRoom(summary: PlanSummary, hours: number, excludeId?: string | null) {
  return summary.members
    .filter((m) => m.memberId !== excludeId && m.remaining + EPS >= hours)
    .sort((a, b) => b.remaining - a.remaining);
}

/**
 * Drops the lowest-priority, unlocked items until the plan is committable on
 * capacity. Deterministic and explainable: "we removed what mattered least".
 */
export function trimToCapacity(
  members: CapacityMember[],
  items: PlanItem[],
  opts: { buffer?: number } = {},
): { kept: PlanItem[]; dropped: PlanItem[] } {
  const kept = [...items];
  const dropped: PlanItem[] = [];
  for (;;) {
    const s = computePlan(members, kept, opts);
    const overBlock = s.warnings.some((w) => w.kind === "member_over" || w.kind === "total_over");
    if (!overBlock) break;
    const overIds = new Set(s.members.filter((m) => m.status === "over").map((m) => m.memberId));
    const pool = kept
      .filter((i) => !i.locked && (overIds.size === 0 || (i.assigneeId && overIds.has(i.assigneeId))))
      .sort((a, b) => a.priorityScore - b.priorityScore);
    const victim = pool[0] ?? kept.filter((i) => !i.locked).sort((a, b) => a.priorityScore - b.priorityScore)[0];
    if (!victim) break;
    kept.splice(kept.indexOf(victim), 1);
    dropped.push(victim);
  }
  return { kept, dropped };
}

/** Immutable reorder used by the plan UI (also unit-tested). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** How much of what the team committed did they actually finish? Used to calibrate the buffer. */
export function completionRate(history: { committedHours: number; completedHours: number }[]): number | null {
  const committed = history.reduce((s, h) => s + h.committedHours, 0);
  if (committed <= 0) return null;
  return history.reduce((s, h) => s + Math.min(h.completedHours, h.committedHours), 0) / committed;
}
