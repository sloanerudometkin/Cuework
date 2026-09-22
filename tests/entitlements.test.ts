import { describe, expect, it } from "vitest";
import { capRecommendations, checkLimit, downgradeViolations, hasFeature, PLANS, upgradeTargetFor } from "@/lib/domain/entitlements";

describe("plans", () => {
  it("has three tiers with strictly increasing limits and prices", () => {
    const { starter, growth, scale } = PLANS;
    expect(starter.limits.properties).toBeLessThan(growth.limits.properties);
    expect(growth.limits.properties).toBeLessThan(scale.limits.properties);
    expect(starter.monthlyPrice).toBeLessThan(growth.monthlyPrice);
    expect(growth.monthlyPrice).toBeLessThan(scale.monthlyPrice);
    expect(growth.highlighted).toBe(true);
    expect(starter.highlighted).toBeFalsy();
  });
  it("gates leadership briefs and outcome tracking to Growth and above", () => {
    expect(hasFeature("starter", "leadershipBriefs")).toBe(false);
    expect(hasFeature("growth", "leadershipBriefs")).toBe(true);
    expect(hasFeature("starter", "outcomeTracking")).toBe(false);
    expect(upgradeTargetFor("leadershipBriefs")).toBe("growth");
    expect(upgradeTargetFor("approvalWorkflows")).toBe("scale");
  });
});

describe("checkLimit", () => {
  const usage = { properties: 1, teamMembers: 2, importsThisMonth: 2 };
  it("allows an action below the limit", () => {
    expect(checkLimit("growth", "properties", usage)).toMatchObject({ allowed: true, limit: 5, used: 1 });
  });
  it("blocks at the limit with a message that names the plan and the upgrade", () => {
    const r = checkLimit("starter", "properties", usage);
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/Starter plan includes 1 property/);
    expect(r.message).toMatch(/Upgrade to Growth/);
    expect(r.upgradeTo).toBe("growth");
  });
  it("suggests the cheapest plan that would actually help", () => {
    const r = checkLimit("growth", "properties", { ...usage, properties: 5 });
    expect(r.allowed).toBe(false);
    expect(r.upgradeTo).toBe("scale");
  });
  it("never blocks unlimited limits", () => {
    expect(checkLimit("scale", "importsPerMonth", { ...usage, importsThisMonth: 10_000 }).allowed).toBe(true);
  });
  it("enforces import quotas per month", () => {
    expect(checkLimit("starter", "importsPerMonth", { ...usage, importsThisMonth: 2 }).allowed).toBe(false);
    expect(checkLimit("starter", "importsPerMonth", { ...usage, importsThisMonth: 1 }).allowed).toBe(true);
  });
});

describe("downgradeViolations", () => {
  it("refuses a downgrade that current usage doesn't fit, and says what to remove", () => {
    const v = downgradeViolations("starter", { properties: 3, teamMembers: 2 });
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/Archive 2 first/);
  });
  it("allows a downgrade that fits", () => {
    expect(downgradeViolations("growth", { properties: 3, teamMembers: 2 })).toEqual([]);
  });
});

describe("capRecommendations", () => {
  it("shows the best N and reports how many are hidden", () => {
    const list = Array.from({ length: 12 }, (_, i) => i);
    expect(capRecommendations(list, "starter")).toEqual({ visible: list.slice(0, 8), hidden: 4 });
    expect(capRecommendations(list, "growth")).toEqual({ visible: list, hidden: 0 });
  });
});
