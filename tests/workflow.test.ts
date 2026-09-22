import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db, Handle } from "@/lib/db/connect";
import { openTestDb } from "./helpers/db";
import { outcomes, properties, recommendationDecisions, recommendations, subscriptions, workItems } from "@/lib/db/schema";
import { seedDemoWorkspace, ensureDemoWorkspace, resetDemoWorkspace } from "@/lib/seed/demo";
import { authenticate, signUp } from "@/lib/services/accounts";
import { importDataset } from "@/lib/services/imports";
import { decideRecommendation, getInbox, refreshRecommendations } from "@/lib/services/recommendations";
import { getPlan } from "@/lib/domain/entitlements";
import { getPortfolio, getPerformance } from "@/lib/services/performance";
import { getWeekPlan, saveWeekPlan } from "@/lib/services/planning";
import { buildLiveBrief, saveBrief } from "@/lib/services/reports";
import { addProperty, addTeamMember, changePlan } from "@/lib/services/settings";
import { getWorkDetail, listWork, transitionWork } from "@/lib/services/work";
import { loadWorkspace, ServiceError, type Actor } from "@/lib/services/workspace";
import { briefToMarkdown } from "@/lib/domain/reporting";
import { autoFit } from "@/lib/domain/capacity";
import { addDays, weekStart } from "@/lib/domain/dates";

// A fixed "today" (Wednesday) so the assertions don't depend on when the suite runs.
const NOW = new Date("2026-09-16T15:00:00.000Z");
const WEEK = weekStart(NOW); // 2026-09-14

let h: Handle;
let db: Db;
let orgId: string;
let actor: Actor;

async function expectServiceError(p: Promise<unknown>, code?: ServiceError["code"], message?: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err, "expected a ServiceError").toBeInstanceOf(ServiceError);
  if (code) expect((err as ServiceError).code).toBe(code);
  if (message) expect((err as ServiceError).message).toMatch(message);
}

beforeAll(async () => {
  h = await openTestDb(); // in-memory PostgreSQL by default; a real server when TEST_DATABASE_URL is set
  db = h.db;
  const seeded = await seedDemoWorkspace(db, NOW);
  orgId = seeded.orgId;
  actor = { userId: seeded.userId, name: "Maya Okafor" };
});
afterAll(async () => {
  await h.close();
});

describe("seeded workspace", () => {
  it("has three labelled demo properties on the Growth plan with two team members", async () => {
    const ws = await loadWorkspace(db, orgId);
    expect(ws.properties).toHaveLength(3);
    expect(ws.planKey).toBe("growth");
    expect(ws.team).toHaveLength(2);
    expect(ws.dataSources.every((d) => d.status === "demo")).toBe(true);
    expect(ws.period).toBe("2026-08-01");
  });

  it("is idempotent to ensure, and reset rebuilds cleanly", async () => {
    const again = await ensureDemoWorkspace(db, NOW);
    expect(again.orgId).toBe(orgId);
  });
});

describe("recommendation → decision → work", () => {
  it("records a dismissal only with a reason, and remembers it", async () => {
    const inbox = await getInbox(db, orgId);
    const target = inbox.open.find((r) => r.status === "new")!;
    await expectServiceError(decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "dismiss", rationale: " " } }), "invalid", /reason/);
    // Not dismissed yet:
    const [still] = await db.select().from(recommendations).where(eq(recommendations.id, target.id));
    expect(still.status).toBe("new");
  });

  it("turns an accepted recommendation into a backlog work item that keeps its evidence trail", async () => {
    const inbox = await getInbox(db, orgId);
    const target = inbox.open.find((r) => r.status === "new" && r.title.includes("harbour cruise times"))!;
    expect(target).toBeDefined();

    const res = await decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "accept", rationale: "Cheap win before peak ends." }, now: NOW });
    expect(res.status).toBe("converted");
    expect(res.workItemId).toBeTruthy();

    const detail = await getWorkDetail(db, orgId, res.workItemId!);
    expect(detail!.item.status).toBe("backlog");
    expect(detail!.item.recommendationId).toBe(target.id);
    expect(detail!.item.target).toEqual(target.target);
    expect(detail!.item.estimatedHours).toBe(target.estimatedHours);
    expect(detail!.evidence.length).toBe(target.evidence.length);
    expect(detail!.item.objective).toMatch(/ticket sales/i);

    const decisions = await db.select().from(recommendationDecisions).where(eq(recommendationDecisions.recommendationId, target.id));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: "accept", rationale: "Cheap win before peak ends.", decidedByName: "Maya Okafor" });
  });

  it("doesn't create a second work item if the same recommendation is converted again", async () => {
    const [conv] = await db.select().from(recommendations).where(and(eq(recommendations.orgId, orgId), eq(recommendations.status, "converted")));
    await expectServiceError(decideRecommendation(db, { orgId, actor, recommendationId: conv.id, input: { decision: "convert" } }), "conflict");
  });

  it("supports accept-without-work followed by convert-to-work", async () => {
    const inbox = await getInbox(db, orgId);
    const target = inbox.open.find((r) => r.status === "new" && r.title.includes("question-style") && r.propertyName.includes("Ferries"))!;
    const a = await decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "accept", addToBacklog: false }, now: NOW });
    expect(a).toEqual({ status: "accepted", workItemId: null });
    const c = await decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "convert" }, now: NOW });
    expect(c.status).toBe("converted");
    expect(c.workItemId).toBeTruthy();
  });

  it("defers with a date and a reason, and keeps dismissals through a data refresh", async () => {
    const inbox = await getInbox(db, orgId);
    const target = inbox.open.find((r) => r.status === "new" && r.title.includes("airport shuttle bus"))!;
    await expectServiceError(decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "defer", rationale: "later", deferUntil: "soon" } }), "invalid");
    await decideRecommendation(db, { orgId, actor, recommendationId: target.id, input: { decision: "defer", rationale: "Busy season", deferUntil: addDays(WEEK, 30) }, now: NOW });

    const before = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    const dismissedBefore = before.filter((r) => r.status === "dismissed").map((r) => r.id);
    expect(dismissedBefore.length).toBeGreaterThan(0);
    const refreshed = await refreshRecommendations(db, orgId, NOW);
    expect(refreshed.created).toBe(0); // no duplicates
    const after = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    expect(after).toHaveLength(before.length);
    expect(after.filter((r) => r.status === "dismissed").map((r) => r.id).sort()).toEqual(dismissedBefore.sort());
    expect(after.find((r) => r.id === target.id)!.status).toBe("deferred");
  });

  it("resurfaces a deferred recommendation once its date arrives", async () => {
    const [deferred] = await db.select().from(recommendations).where(and(eq(recommendations.orgId, orgId), eq(recommendations.status, "deferred"), eq(recommendations.ruleKey, "low_ctr_high_impressions")));
    await refreshRecommendations(db, orgId, new Date(`${addDays(WEEK, 45)}T00:00:00Z`));
    const [again] = await db.select().from(recommendations).where(eq(recommendations.id, deferred.id));
    expect(again.status).toBe("new");
  });
});

describe("capacity-aware weekly commitment", () => {
  it("shows the seeded week as committed, within capacity, with room to plan more", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    expect(plan.commitment?.status).toBe("committed");
    expect(plan.summary.canCommit).toBe(true);
    expect(plan.summary.totalPlannable).toBe(54); // Maya 28 + Jordan 26 (out Friday)
    expect(plan.summary.totalRemaining).toBeGreaterThan(20);
    expect(plan.candidates.length).toBeGreaterThan(2);
    expect(plan.history.rate).not.toBeNull();
    expect(plan.history.rate!).toBeLessThan(1); // dropped items in earlier weeks
  });

  it("REFUSES to commit a plan that exceeds someone's capacity — on the server, regardless of the UI", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    const maya = plan.members.find((m) => m.name === "Maya Okafor")!;
    const current = plan.items.map((i) => ({ id: i.id, assigneeId: i.assigneeId }));
    // Pile everything onto Maya.
    const overloaded = [...current, ...plan.candidates.map((c) => ({ id: c.id, assigneeId: maya.id }))];
    await expectServiceError(
      saveWeekPlan(db, { orgId, actor, weekStart: WEEK, commit: true, now: NOW, items: overloaded, capacity: plan.members.map((m) => ({ memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })) }),
      "limit",
      /over capacity/,
    );
    // Nothing was written: the plan is unchanged.
    const after = await getWeekPlan(db, orgId, WEEK);
    expect(after.items.map((i) => i.id).sort()).toEqual(current.map((c) => c.id).sort());
  });

  it("refuses to commit when reducing someone's capacity would put the existing plan over", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    const maya = plan.members.find((m) => m.name === "Maya Okafor")!;
    await expectServiceError(
      saveWeekPlan(db, {
        orgId, actor, weekStart: WEEK, commit: true, now: NOW,
        items: plan.items.map((i) => ({ id: i.id, assigneeId: i.assigneeId })),
        capacity: plan.members.map((m) => (m.id === maya.id ? { memberId: m.id, totalHours: 20, reservedHours: 12 } : { memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })),
      }),
      "limit",
      /Maya Okafor is over capacity/,
    );
    const capAfter = await getWeekPlan(db, orgId, WEEK);
    expect(capAfter.members.find((m) => m.id === maya.id)!.totalHours).toBe(40); // rolled back
  });

  it("requires an owner on every item", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    const cand = plan.candidates[0];
    await expectServiceError(
      saveWeekPlan(db, { orgId, actor, weekStart: WEEK, commit: true, now: NOW, items: [...plan.items.map((i) => ({ id: i.id, assigneeId: i.assigneeId })), { id: cand.id, assigneeId: null }], capacity: plan.members.map((m) => ({ memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })) }),
      "limit",
      /need an owner/,
    );
  });

  it("commits an auto-fitted plan, keeps in-flight work locked in, and reflects it on the board", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    const members = plan.members.map((m) => ({ id: m.id, name: m.name, plannableHours: m.plannable }));
    const fit = autoFit(
      members,
      plan.items.map((i) => ({ id: i.id, title: i.title, assigneeId: i.assigneeId, hours: i.hours, priorityScore: i.priorityScore })),
      plan.candidates.map((c) => ({ id: c.id, hours: c.hours, priorityScore: c.priorityScore, preferredAssigneeId: c.assigneeId })),
      { buffer: plan.buffer },
    );
    expect(fit.selected.length).toBeGreaterThan(0);

    const summary = await saveWeekPlan(db, {
      orgId, actor, weekStart: WEEK, commit: true, now: NOW,
      // Deliberately omit the blocked/in-progress items: the server must keep them.
      items: [...plan.items.filter((i) => !i.locked).map((i) => ({ id: i.id, assigneeId: i.assigneeId })), ...fit.selected.map((s) => ({ id: s.id, assigneeId: s.assigneeId }))],
      capacity: plan.members.map((m) => ({ memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })),
    });
    expect(summary.canCommit).toBe(true);
    for (const m of summary.members) expect(m.planned).toBeLessThanOrEqual(m.plannable);

    const after = await getWeekPlan(db, orgId, WEEK);
    for (const locked of plan.items.filter((i) => i.locked)) expect(after.items.some((i) => i.id === locked.id)).toBe(true);
    for (const s of fit.selected) expect(after.items.find((i) => i.id === s.id)?.status).toBe("committed");
  });

  it("returns dropped items to the backlog", async () => {
    const plan = await getWeekPlan(db, orgId, WEEK);
    const removable = plan.items.find((i) => !i.locked)!;
    await saveWeekPlan(db, {
      orgId, actor, weekStart: WEEK, commit: true, now: NOW,
      items: plan.items.filter((i) => i.id !== removable.id && !i.locked).map((i) => ({ id: i.id, assigneeId: i.assigneeId })),
      capacity: plan.members.map((m) => ({ memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })),
    });
    const [w] = await db.select().from(workItems).where(eq(workItems.id, removable.id));
    expect(w.status).toBe("backlog");
    expect(w.commitmentId).toBeNull();
  });

  it("rejects malformed weeks and capacity", async () => {
    await expectServiceError(getWeekPlan(db, orgId, "not-a-date"), "invalid");
    const plan = await getWeekPlan(db, orgId, WEEK);
    await expectServiceError(
      saveWeekPlan(db, { orgId, actor, weekStart: WEEK, commit: false, items: [], capacity: [{ memberId: plan.members[0].id, totalHours: 10, reservedHours: 12 }] }),
      "invalid",
    );
  });
});

describe("work board → outcomes → leadership brief", () => {
  it("enforces legal transitions", async () => {
    const work = await listWork(db, orgId);
    const backlog = work.find((w) => w.status === "backlog")!;
    await expectServiceError(transitionWork(db, { orgId, id: backlog.id, action: { type: "start" } }), "conflict", /Schedule this item/);
    await expectServiceError(transitionWork(db, { orgId, id: backlog.id, action: { type: "complete" } }), "conflict");
    const blocked = work.find((w) => w.status === "blocked")!;
    await expectServiceError(transitionWork(db, { orgId, id: blocked.id, action: { type: "complete" } }), "conflict", /Unblock/);
    const running = work.find((w) => w.status === "in_progress")!;
    await expectServiceError(transitionWork(db, { orgId, id: running.id, action: { type: "block", reason: "" } }), "invalid");
  });

  it("completing work records a baseline outcome tied to the original recommendation and metric", async () => {
    const work = await listWork(db, orgId);
    const running = work.find((w) => w.status === "in_progress")!;
    const done = await transitionWork(db, { orgId, id: running.id, action: { type: "complete", actualHours: 5.5 }, now: NOW });
    expect(done.status).toBe("complete");
    expect(done.hoursSpent).toBe(5.5);

    const [o] = await db.select().from(outcomes).where(eq(outcomes.workItemId, running.id));
    expect(o).toBeDefined();
    expect(o.target).toEqual(running.target);
    expect(o.baselinePeriod).toBe("2026-08-01"); // last full month before completion in September
    expect(o.baselineValue).toBeGreaterThan(0);
    expect(o.verdict).toBe("pending"); // no newer month yet — we don't invent a result
    expect(o.evidenceStrength).toBe("correlation");
    expect(o.note).toMatch(/next month of data/);
  });

  it("re-measures outcomes when a newer month of data is imported, without ever claiming proof", async () => {
    const ws = await loadWorkspace(db, orgId);
    const ferry = ws.properties.find((p) => p.name.includes("Ferries"))!;
    const sept = "month,channel,impressions,clicks,sessions,conversions,cost\n" +
      "2026-09,organic,4000000,150000,158000,5200,0\n2026-09,paid,900000,26000,25000,1400,31000\n2026-09,other,0,0,50000,1500,0\n";
    const summary = await importDataset(db, { orgId, propertyId: ferry.id, dataset: "site_totals", csv: sept, fileName: "sept-totals.csv" });
    expect(summary).toMatchObject({ rows: 3, months: ["2026-09-01"], replaced: 0 });

    const ws2 = await loadWorkspace(db, orgId);
    expect(ws2.dataSources.some((d) => d.status === "imported" && d.kind === "csv")).toBe(true);
    const all = await db.select().from(outcomes).where(eq(outcomes.orgId, orgId));
    // The pending outcomes on *ferry* targets can now be measured; none is labelled "proven" unless it was a real experiment.
    for (const o of all) {
      if (o.evidenceStrength === "experiment") expect(o.note).toMatch(/Controlled A\/B test/);
    }
  });

  it("re-importing the same month replaces rather than double-counts", async () => {
    const ws = await loadWorkspace(db, orgId);
    const ferry = ws.properties.find((p) => p.name.includes("Ferries"))!;
    const csv = "month,channel,sessions,conversions\n2026-09,organic,158000,5200\n";
    const again = await importDataset(db, { orgId, propertyId: ferry.id, dataset: "site_totals", csv, fileName: "again.csv" });
    expect(again.replaced).toBeGreaterThan(0);
  });

  it("a partial file only replaces the rows it re-supplies and never deletes anything else", async () => {
    const ws = await loadWorkspace(db, orgId);
    const auth = ws.properties.find((p) => p.name.includes("Port Authority"))!;
    const count = () => loadWorkspace(db, orgId).then((w) => w.snapshots.filter((s) => s.propertyId === auth.id && s.dimension === "page" && s.periodStart === "2026-08-01"));
    const before = await count();
    expect(before.length).toBeGreaterThan(5);

    const partial = "month,page,sessions,conversions\n2026-08,/tenders,9999,99\n"; // one page only
    const res = await importDataset(db, { orgId, propertyId: auth.id, dataset: "landing_pages", csv: partial, fileName: "partial.csv" });
    expect(res.replaced).toBe(1);

    const after = await count();
    expect(after).toHaveLength(before.length); // same rows: one replaced in place, none lost
    expect(after.find((r) => r.key === "/tenders")!.sessions).toBe(9999);
    for (const r of before.filter((b) => b.key !== "/tenders")) {
      expect(after.find((a) => a.key === r.key)!.sessions).toBe(r.sessions); // untouched
    }
  });

  it("rejects a bad CSV in full, explaining the first problem, and writes nothing", async () => {
    const ws = await loadWorkspace(db, orgId);
    const before = ws.dataSources.length;
    await expectServiceError(
      importDataset(db, { orgId, propertyId: ws.properties[0].id, dataset: "landing_pages", csv: "month,page,sessions,conversions\n2026-09,/ok,10,1\n2026-09,/bad,ten,1\n", fileName: "bad.csv" }),
      "invalid",
      /line 3: sessions: must be a number/,
    );
    expect((await loadWorkspace(db, orgId)).dataSources.length).toBe(before);
  });

  it("builds a leadership brief from real state: completed work, blockers, decisions, plan and honest caveats", async () => {
    const brief = await buildLiveBrief(db, orgId, NOW);
    expect(brief.completed.some((c) => c.title.includes("ferry schedule"))).toBe(true); // the item we just completed
    expect(brief.completed.some((c) => c.outcome?.evidence === "experiment")).toBe(true); // seeded tested win, if inside the window
    expect(brief.blocked).toHaveLength(1);
    expect(brief.leadershipAsks[0].title).toMatch(/Investigate a 7\d% conversion drop/);
    expect(brief.leadershipAsks[0].property).toBe("Harborline Regional Airport");
    expect(brief.headline).toBe("August 2026: Harborline Regional Airport needs leadership attention");
    // Routine work with no metric is never described as "awaiting data".
    expect(brief.completed.some((c) => !c.hasMetric)).toBe(true);
    expect(brief.summary[1]).toMatch(/routine \(no metric attached\)/);
    // Anomalies are reported on their own, not folded into year-over-year declines.
    expect(brief.anomalies.length).toBeGreaterThan(0);
    expect(brief.declines.join(" ")).not.toMatch(/anomal/i);
    expect(brief.decisions.length).toBeGreaterThan(0);
    expect(brief.nextWeek.status).toBe("committed");
    expect(brief.nextWeek.items.length).toBeGreaterThan(0);
    expect(brief.properties).toHaveLength(3);
    expect(brief.caveats.join(" ")).toMatch(/not proven to be caused/);

    const md = briefToMarkdown(brief, "Please prioritise the IT ticket.");
    expect(md).toContain("## What the team completed");
    expect(md).toContain("## Where leadership attention is needed");
    expect(md).toContain("> Please prioritise the IT ticket.");
    expect(md).toMatch(/Correlated|Corroborated|Proven/);

    const saved = await saveBrief(db, { orgId, actor, note: "n", now: NOW });
    expect(saved.markdown).toContain("Leadership brief");
  });

  it("surfaces the same story on the command center and performance pages", async () => {
    const p = await getPortfolio(db, orgId, NOW);
    expect(p.properties).toHaveLength(3);
    expect(p.attention[0].tone).toBe("urgent");
    expect(p.atRisk.some((r) => r.kind === "blocked")).toBe(true);
    expect(p.wins.length).toBeGreaterThan(0);
    const perf = await getPerformance(db, orgId);
    const airport = perf.properties.find((x) => x.property.name.includes("Airport"))!;
    expect(airport.anomalies.length).toBeGreaterThan(0);
  });
});

describe("subscription limits are enforced", () => {
  it("blocks adding properties beyond the plan's limit, with an upgrade message", async () => {
    await addProperty(db, orgId, { name: "Harborline Marina" });
    await addProperty(db, orgId, { name: "Harborline Tours" });
    await expectServiceError(addProperty(db, orgId, { name: "One too many" }), "limit", /Growth plan includes 5 properties.*Upgrade to Scale/);
  });

  it("blocks adding team members beyond the limit", async () => {
    for (let i = 0; i < 4; i++) await addTeamMember(db, orgId, { name: `Contractor ${i}`, defaultWeeklyHours: 20, defaultReservedHours: 2, roleKey: "coordinator" });
    await expectServiceError(addTeamMember(db, orgId, { name: "Overflow", defaultWeeklyHours: 20, defaultReservedHours: 2 }), "limit", /6 team members/);
  });

  it("refuses a downgrade that current usage doesn't fit, and allows an upgrade", async () => {
    await expectServiceError(changePlan(db, orgId, "starter", "month"), "limit", /Archive 4 first/);
    await changePlan(db, orgId, "scale", "year");
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
    expect(sub).toMatchObject({ plan: "scale", interval: "year", simulated: true });
    await addProperty(db, orgId, { name: "Now allowed" });
  });
});

describe("accounts and tenancy", () => {
  it("signs up a new organisation on Starter with the right limits, and authenticates it", async () => {
    const u = await signUp(db, { name: "Sam Rivera", orgName: "Rivera & Co", email: "Sam@Example.test", password: "correct horse battery" });
    const ws = await loadWorkspace(db, u.orgId);
    expect(ws.planKey).toBe("starter");
    expect(ws.properties).toHaveLength(0);
    expect(ws.team).toHaveLength(1);
    expect(getPlan(ws.planKey).limits.properties).toBe(1);

    expect(await authenticate(db, "sam@example.test", "correct horse battery")).toMatchObject({ orgId: u.orgId });
    expect(await authenticate(db, "sam@example.test", "wrong password!!")).toBeNull();
    expect(await authenticate(db, "nobody@example.test", "whatever password")).toBeNull();
    await expectServiceError(signUp(db, { name: "Sam", orgName: "Dup", email: "sam@example.test", password: "another long password" }), "conflict");
    await expectServiceError(signUp(db, { name: "Sam", orgName: "Weak", email: "weak@example.test", password: "short" }), "invalid", /10 characters/);
  });

  it("enforces the Starter plan's one-property limit for that new organisation", async () => {
    const u = await signUp(db, { name: "Kit Lee", orgName: "Lee Studio", email: "kit@example.test", password: "long enough password" });
    await addProperty(db, u.orgId, { name: "Lee Studio site" });
    await expectServiceError(addProperty(db, u.orgId, { name: "Second site" }), "limit", /Starter plan includes 1 property/);
  });

  it("never lets one organisation touch another's data", async () => {
    const other = await signUp(db, { name: "Eve", orgName: "Other Org", email: "eve@example.test", password: "a very long passphrase" });
    const [rec] = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    await expectServiceError(decideRecommendation(db, { orgId: other.orgId, actor: { userId: other.userId, name: "Eve" }, recommendationId: rec.id, input: { decision: "dismiss", rationale: "nope" } }), "not_found");
    const [w] = await db.select().from(workItems).where(eq(workItems.orgId, orgId));
    await expectServiceError(transitionWork(db, { orgId: other.orgId, id: w.id, action: { type: "start" } }), "not_found");
    expect(await getWorkDetail(db, other.orgId, w.id)).toBeNull();
    expect((await getInbox(db, other.orgId)).open).toHaveLength(0);
    const [prop] = await db.select().from(properties).where(eq(properties.orgId, orgId));
    await expectServiceError(importDataset(db, { orgId: other.orgId, propertyId: prop.id, dataset: "landing_pages", csv: "month,page,sessions,conversions\n2026-09,/x,1,1\n", fileName: "x.csv" }), "not_found");
  });
});

describe("demo reset", () => {
  it("rebuilds the demo workspace from scratch without touching other organisations", async () => {
    const before = await db.select().from(properties);
    const others = before.filter((p) => p.orgId !== orgId).length;
    const res = await resetDemoWorkspace(db, NOW);
    expect(res.orgId).not.toBe(orgId);
    const after = await db.select().from(properties);
    expect(after.filter((p) => p.orgId !== orgId && p.orgId !== res.orgId).length).toBe(others);
    expect((await loadWorkspace(db, res.orgId)).properties).toHaveLength(3);
  });
});

describe("history integrity", () => {
  it("carrying unfinished work into a new week does not rewrite how past weeks went", async () => {
    // Regression: dropped items used to leave their old commitment, inflating the historical completion rate.
    const fresh = await openTestDb();
    try {
      const seeded = await seedDemoWorkspace(fresh.db, NOW);
      const me: Actor = { userId: seeded.userId, name: "Maya Okafor" };
      const before = await getWeekPlan(fresh.db, seeded.orgId, WEEK);
      const carried = before.candidates.filter((c) => c.recommendationId === null);
      expect(carried).toHaveLength(2); // the seeded routine items that were dropped in earlier weeks
      expect(before.history.rate).toBeCloseTo(0.67, 1);

      const jordan = before.members.find((m) => m.name.startsWith("Jordan"))!;
      await saveWeekPlan(fresh.db, {
        orgId: seeded.orgId, actor: me, weekStart: WEEK, commit: true, now: NOW,
        items: [...before.items.map((i) => ({ id: i.id, assigneeId: i.assigneeId })), ...carried.map((c) => ({ id: c.id, assigneeId: jordan.id }))],
        capacity: before.members.map((m) => ({ memberId: m.id, totalHours: m.totalHours, reservedHours: m.reservedHours })),
      });

      const after = await getWeekPlan(fresh.db, seeded.orgId, WEEK);
      expect(after.items).toHaveLength(before.items.length + 2);
      expect(after.candidates.filter((c) => c.recommendationId === null)).toHaveLength(0);
      expect(after.history.rate).toBeCloseTo(before.history.rate!, 8);
      expect(after.history.committedHours).toBe(before.history.committedHours);
    } finally {
      await fresh.close();
    }
  });
});
