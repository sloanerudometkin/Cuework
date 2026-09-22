import { describe, expect, it } from "vitest";
import {
  autoFit,
  completionRate,
  computePlan,
  loadStatus,
  membersWithRoom,
  moveItem,
  trimToCapacity,
  type CapacityMember,
  type PlanItem,
} from "@/lib/domain/capacity";

const maya: CapacityMember = { id: "maya", name: "Maya", plannableHours: 28 };
const jordan: CapacityMember = { id: "jordan", name: "Jordan", plannableHours: 26 };
const team = [maya, jordan];

const item = (id: string, hours: number, assigneeId: string | null, priorityScore = 50, locked = false): PlanItem => ({
  id,
  title: id,
  hours,
  assigneeId,
  priorityScore,
  locked,
});

describe("loadStatus", () => {
  it("is healthy up to 85%, tight up to 100%, over beyond", () => {
    expect(loadStatus(0.85)).toBe("healthy");
    expect(loadStatus(0.86)).toBe("tight");
    expect(loadStatus(1)).toBe("tight");
    expect(loadStatus(1.01)).toBe("over");
  });
});

describe("computePlan", () => {
  it("adds up hours used and remaining per person and overall", () => {
    const s = computePlan(team, [item("a", 10, "maya"), item("b", 6, "jordan")]);
    expect(s.members.find((m) => m.memberId === "maya")).toMatchObject({ planned: 10, remaining: 18, status: "healthy" });
    expect(s.totalPlanned).toBe(16);
    expect(s.totalPlannable).toBe(54);
    expect(s.totalRemaining).toBe(38);
    expect(s.canCommit).toBe(true);
    expect(s.blockReason).toBeNull();
  });

  it("blocks commitment when one person is over even if the team total has room", () => {
    const s = computePlan(team, [item("a", 20, "maya"), item("b", 12, "maya")]);
    expect(s.totalPlanned).toBeLessThan(s.totalPlannable);
    expect(s.canCommit).toBe(false);
    expect(s.warnings.some((w) => w.kind === "member_over" && w.memberId === "maya")).toBe(true);
    expect(s.blockReason).toMatch(/Maya is over capacity by 4h/);
  });

  it("blocks commitment when the team total exceeds capacity", () => {
    const s = computePlan(team, [item("a", 28, "maya"), item("b", 26, "jordan"), item("c", 1, "jordan")]);
    expect(s.canCommit).toBe(false);
    expect(s.warnings.some((w) => w.kind === "total_over")).toBe(true);
  });

  it("allows a plan that fills capacity exactly, but flags it as tight", () => {
    const s = computePlan(team, [item("a", 28, "maya"), item("b", 26, "jordan")]);
    expect(s.canCommit).toBe(true);
    expect(s.status).toBe("tight");
    expect(s.warnings.some((w) => w.kind === "tight")).toBe(true);
  });

  it("requires every item to have an owner and the plan to be non-empty", () => {
    expect(computePlan(team, [item("a", 4, null)]).canCommit).toBe(false);
    expect(computePlan(team, [item("a", 4, null)]).warnings.some((w) => w.kind === "unassigned")).toBe(true);
    expect(computePlan(team, []).canCommit).toBe(false);
    expect(computePlan(team, []).warnings.some((w) => w.kind === "empty")).toBe(true);
  });

  it("treats an assignee who isn't on the team as unassigned", () => {
    expect(computePlan(team, [item("a", 4, "ghost")]).unassignedCount).toBe(1);
  });

  it("refuses to commit when nobody has capacity", () => {
    const s = computePlan([{ id: "x", name: "X", plannableHours: 0 }], [item("a", 1, "x")]);
    expect(s.canCommit).toBe(false);
  });

  it("honours a custom buffer when judging 'tight'", () => {
    const items = [item("a", 22, "maya")];
    expect(computePlan(team, items, { buffer: 0.15 }).members[0].status).toBe("healthy"); // 79%
    expect(computePlan(team, items, { buffer: 0.25 }).members[0].status).toBe("tight");
  });
});

describe("autoFit", () => {
  const candidates = [
    { id: "big", hours: 12, priorityScore: 90, preferredAssigneeId: "maya" },
    { id: "mid", hours: 10, priorityScore: 70, preferredAssigneeId: "maya" },
    { id: "small", hours: 3, priorityScore: 40, preferredAssigneeId: "jordan" },
    { id: "huge", hours: 40, priorityScore: 95, preferredAssigneeId: null },
  ];

  it("never produces a plan that is over capacity or over the buffered target", () => {
    const { selected } = autoFit(team, [], candidates);
    const plan = computePlan(
      team,
      selected.map((s) => {
        const c = candidates.find((x) => x.id === s.id)!;
        return item(c.id, c.hours, s.assigneeId, c.priorityScore);
      }),
    );
    expect(plan.canCommit).toBe(true);
    for (const m of plan.members) expect(m.planned).toBeLessThanOrEqual(m.plannable * 0.85 + 1e-9);
  });

  it("skips what can't fit rather than truncating it, and still fills gaps with smaller items", () => {
    const { selected, skipped } = autoFit(team, [], candidates);
    expect(skipped.map((s) => s.id)).toContain("huge");
    expect(selected.map((s) => s.id)).toContain("small");
  });

  it("prefers the suggested owner and spills to the person with the most room", () => {
    const { selected } = autoFit(team, [], candidates);
    expect(selected.find((s) => s.id === "big")!.assigneeId).toBe("maya");
    // Maya's buffered room is 23.8h: after 'big' (12h) 'mid' (10h) still fits her; both stay with her.
    expect(selected.find((s) => s.id === "mid")!.assigneeId).toBe("maya");
  });

  it("counts items already in the plan before adding more", () => {
    const { selected } = autoFit(team, [item("existing", 20, "maya", 50, true)], [{ id: "new", hours: 6, priorityScore: 80, preferredAssigneeId: "maya" }]);
    // Maya has 23.8 − 20 = 3.8h left, so the item moves to Jordan.
    expect(selected[0].assigneeId).toBe("jordan");
  });
});

describe("trimToCapacity", () => {
  it("drops the lowest-priority unlocked items of whoever is over, until the plan fits", () => {
    const items = [item("keep", 14, "maya", 90), item("low", 10, "maya", 20), item("mid", 8, "maya", 50), item("other", 5, "jordan", 10)];
    const { kept, dropped } = trimToCapacity(team, items);
    expect(dropped.map((d) => d.id)).toEqual(["low"]);
    expect(computePlan(team, kept).canCommit).toBe(true);
    expect(kept.map((k) => k.id)).toContain("other"); // Jordan wasn't over, so nothing of theirs is cut
  });

  it("never removes locked (in-flight) work", () => {
    const items = [item("running", 30, "maya", 5, true), item("new", 4, "maya", 99)];
    const { kept } = trimToCapacity(team, items);
    expect(kept.map((k) => k.id)).toContain("running");
  });
});

describe("membersWithRoom / moveItem / completionRate", () => {
  it("lists who could absorb more hours, most room first, excluding the current owner", () => {
    const s = computePlan(team, [item("a", 20, "maya")]);
    expect(membersWithRoom(s, 5).map((m) => m.memberId)).toEqual(["jordan", "maya"]);
    expect(membersWithRoom(s, 5, "jordan").map((m) => m.memberId)).toEqual(["maya"]);
    expect(membersWithRoom(s, 30)).toEqual([]);
  });

  it("reorders immutably and ignores invalid moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(list).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
    expect(moveItem(list, 0, 9)).toBe(list);
  });

  it("computes how much of what was committed got finished", () => {
    expect(completionRate([{ committedHours: 10, completedHours: 8 }, { committedHours: 10, completedHours: 12 }])).toBeCloseTo(0.9);
    expect(completionRate([])).toBeNull();
  });
});
