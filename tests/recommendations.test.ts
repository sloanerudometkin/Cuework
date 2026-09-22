import { describe, expect, it } from "vitest";
import { generateRecommendations } from "@/lib/domain/recommendations";
import { detectAnomalies } from "@/lib/domain/metrics";
import { DEMO_PROPERTIES, generateDemoSnapshots, type DemoKey } from "@/lib/seed/generator";
import type { Snapshot } from "@/lib/domain/types";

const LATEST = "2026-08-01";
const ids = { authority: "auth", ferry: "ferr", airport: "airp" } as Record<DemoKey, string>;
const sources = { authority: "s1", ferry: "s2", airport: "s3" } as Record<DemoKey, string>;
const snapshots = generateDemoSnapshots({ propertyIds: ids, dataSourceIds: sources, latest: LATEST });
const properties = DEMO_PROPERTIES.map((p) => ({ id: ids[p.key], name: p.name, kind: p.kind, strategicWeight: p.strategicWeight }));
const { recommendations: recs, period } = generateRecommendations({ properties, snapshots });

describe("demo data", () => {
  it("is deterministic", () => {
    const again = generateDemoSnapshots({ propertyIds: ids, dataSourceIds: sources, latest: LATEST });
    expect(again).toEqual(snapshots);
  });
  it("covers 24 months so year-over-year comparisons work", () => {
    const months = new Set(snapshots.map((s) => s.periodStart));
    expect(months.size).toBe(24);
    expect(period).toBe(LATEST);
  });
});

describe("recommendation engine", () => {
  const rule = (key: string) => recs.filter((r) => r.ruleKey === key);

  it("produces every rule family named in the spec", () => {
    for (const key of [
      "low_ctr_high_impressions",
      "paid_keywords_no_conversions",
      "landing_page_conversion_decline",
      "yoy_traffic_decline",
      "query_content_gap",
      "aeo_answer_gap",
      "campaign_budget_imbalance",
      "conversion_tracking_anomaly",
    ]) {
      expect(rule(key).length, key).toBeGreaterThan(0);
    }
  });

  it("answers the questions every recommendation must answer", () => {
    for (const r of recs) {
      expect(r.title.length).toBeGreaterThan(10);
      expect(r.rationale.length).toBeGreaterThan(30);
      expect(r.expectedOutcome).toBeTruthy();
      expect(r.nextStep).toBeTruthy();
      expect(r.whyNow).toBeTruthy();
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.target.label).toBeTruthy();
      expect(r.estimatedHours).toBeGreaterThan(0);
      for (const n of [r.impact, r.effort, r.urgency, r.strategic]) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(5);
      }
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("gives every recommendation a unique fingerprint and returns them best-first", () => {
    expect(new Set(recs.map((r) => r.fingerprint)).size).toBe(recs.length);
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].priorityScore).toBeGreaterThanOrEqual(recs[i].priorityScore);
  });

  it("ranks the conversion-tracking anomaly first: it is the most urgent, highest-impact item", () => {
    expect(recs[0].ruleKey).toBe("conversion_tracking_anomaly");
    expect(recs[0].propertyId).toBe(ids.airport);
  });

  it("flags the authority's sustained year-over-year loss and names the pages that lost the most", () => {
    const [r] = rule("yoy_traffic_decline");
    expect(r.propertyId).toBe(ids.authority);
    expect(r.title).toMatch(/−\d+% year over year/);
    expect(r.evidence.some((e) => e.label.startsWith("Largest page decline · /notices") || e.label.startsWith("Largest page decline · /tenders"))).toBe(true);
    expect(rule("yoy_traffic_decline")).toHaveLength(1); // ferry and airport are growing
  });

  it("finds the ferry's wasted paid keywords and the budget imbalance, and only there", () => {
    const [waste] = rule("paid_keywords_no_conversions");
    expect(waste.propertyId).toBe(ids.ferry);
    expect(waste.evidence.map((e) => e.label).join(" ")).toMatch(/cheap boat rides/);
    const [imb] = rule("campaign_budget_imbalance");
    expect(imb.propertyId).toBe(ids.ferry);
    expect(imb.title).toMatch(/Brand — Ferry Tickets/);
  });

  it("suppresses the landing-page conversion rule for a property whose tracking is broken", () => {
    const lp = rule("landing_page_conversion_decline");
    expect(lp.every((r) => r.propertyId !== ids.airport)).toBe(true);
    expect(lp.some((r) => r.propertyId === ids.ferry && r.title.includes("/book"))).toBe(true);
  });

  it("does not raise false anomalies for seasonal or gradual movement", () => {
    const rows = (id: string) => snapshots.filter((s) => s.propertyId === id);
    expect(detectAnomalies(rows(ids.ferry), ids.ferry, LATEST)).toEqual([]);
    expect(detectAnomalies(rows(ids.authority), ids.authority, LATEST)).toEqual([]);
    expect(detectAnomalies(rows(ids.airport), ids.airport, LATEST).some((a) => a.target.metric === "conversions" && a.severity === "high")).toBe(true);
  });

  it("weights strategic relevance: the same problem ranks higher on a more strategic property", () => {
    const a = generateRecommendations({ properties: properties.map((p) => ({ ...p, strategicWeight: p.id === ids.ferry ? 5 : 5 })), snapshots });
    const b = generateRecommendations({ properties: properties.map((p) => ({ ...p, strategicWeight: p.id === ids.ferry ? 1 : 5 })), snapshots });
    const pick = (x: typeof a) => x.recommendations.find((r) => r.fingerprint.startsWith(`low_ctr:${ids.ferry}:ferry schedule`))!.priorityScore;
    expect(pick(a)).toBeGreaterThan(pick(b));
  });

  it("returns nothing (and doesn't crash) when there is no data", () => {
    expect(generateRecommendations({ properties, snapshots: [] })).toEqual({ period: null, recommendations: [] });
  });

  it("returns no recommendations from a healthy property", () => {
    const healthy: Snapshot[] = [];
    for (let i = 0; i < 24; i++) {
      const p = `${2024 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, "0")}-01`;
      healthy.push({ propertyId: "h", periodStart: p, channel: "organic", dimension: "property", key: "", secondaryKey: null, impressions: 100000, clicks: 5000, sessions: 5000, conversions: 100, cost: 0, avgPosition: null, attrs: {} });
    }
    const out = generateRecommendations({ properties: [{ id: "h", name: "Healthy", kind: "other", strategicWeight: 3 }], snapshots: healthy });
    expect(out.recommendations).toEqual([]);
  });
});
