import { describe, expect, it } from "vitest";
import { addMonths, lastYear, monthRange, weekStart } from "@/lib/domain/dates";
import {
  comparePeriods,
  detectAnomalies,
  evaluateTarget,
  formatPct,
  latestPeriod,
  pctChange,
  sentiment,
  sumRows,
} from "@/lib/domain/metrics";
import type { MetricTarget, Snapshot } from "@/lib/domain/types";

const P = "p1";
const row = (periodStart: string, patch: Partial<Snapshot> = {}): Snapshot => ({
  propertyId: P,
  periodStart,
  channel: "organic",
  dimension: "property",
  key: "",
  secondaryKey: null,
  impressions: 0,
  clicks: 0,
  sessions: 0,
  conversions: 0,
  cost: 0,
  avgPosition: null,
  attrs: {},
  ...patch,
});

describe("dates", () => {
  it("shifts months across year boundaries", () => {
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(lastYear("2026-08-01")).toBe("2025-08-01");
    expect(monthRange("2026-06-01", "2026-08-01")).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });
  it("finds the Monday of any weekday, including Sunday", () => {
    expect(weekStart("2026-09-21")).toBe("2026-09-21"); // Monday
    expect(weekStart("2026-09-23")).toBe("2026-09-21");
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week that started Monday
  });
});

describe("pctChange / sentiment / formatPct", () => {
  it("handles missing or zero bases without dividing by zero", () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
    expect(pctChange(110, 100)).toBeCloseTo(0.1);
    expect(pctChange(-50, -100)).toBeCloseTo(0.5);
  });
  it("treats a fall in cost-like metrics as good and a fall in volume metrics as bad", () => {
    expect(sentiment("cpa", -0.2)).toBe("good");
    expect(sentiment("sessions", -0.2)).toBe("bad");
    expect(sentiment("sessions", 0.005)).toBe("neutral");
    expect(sentiment("cost", 0.3)).toBe("bad");
  });
  it("formats signed percentages with a true minus sign", () => {
    expect(formatPct(-0.14)).toBe("−14%");
    expect(formatPct(0.052)).toBe("+5.2%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("evaluateTarget", () => {
  const target: MetricTarget = { metric: "ctr", channel: "organic", dimension: "query", key: "ferry", label: "" };
  const rows = [
    row("2026-08-01", { dimension: "query", key: "ferry", impressions: 1000, clicks: 30 }),
    row("2026-08-01", { dimension: "query", key: "other", impressions: 1000, clicks: 500 }),
    row("2026-08-01", { propertyId: "p2", dimension: "query", key: "ferry", impressions: 10, clicks: 9 }),
  ];
  it("scopes by property, dimension and key, and derives ratios from sums", () => {
    expect(evaluateTarget(rows, P, target, "2026-08-01")).toBeCloseTo(0.03);
    expect(evaluateTarget(rows, P, target, "2026-07-01")).toBeNull();
  });
  it("returns null for CPA when there are no conversions", () => {
    const cpa: MetricTarget = { metric: "cpa", channel: "paid", dimension: "property", key: "", label: "" };
    expect(evaluateTarget([row("2026-08-01", { channel: "paid", cost: 100 })], P, cpa, "2026-08-01")).toBeNull();
  });
  it("weights average position by impressions", () => {
    const t = sumRows([row("2026-08-01", { impressions: 900, avgPosition: 2 }), row("2026-08-01", { impressions: 100, avgPosition: 12 })]);
    expect(t.avgPosition).toBeCloseTo(3);
  });
});

describe("comparePeriods / latestPeriod", () => {
  it("returns month-over-month and year-over-year movement", () => {
    const rows = [row("2025-08-01", { sessions: 200 }), row("2026-07-01", { sessions: 110 }), row("2026-08-01", { sessions: 100 })];
    const t: MetricTarget = { metric: "sessions", channel: "organic", dimension: "property", key: "", label: "" };
    const c = comparePeriods(rows, P, t, "2026-08-01");
    expect(c.mom).toBeCloseTo(-1 / 11);
    expect(c.yoy).toBeCloseTo(-0.5);
    expect(latestPeriod(rows)).toBe("2026-08-01");
  });
});

describe("detectAnomalies", () => {
  /** 24 months of steady conversions with a summer peak, so we can prove seasonality isn't flagged. */
  function series(current: number, seasonal = false) {
    const out: Snapshot[] = [];
    for (let i = 0; i < 24; i++) {
      const period = addMonths("2026-08-01", i - 23);
      const moy = Number(period.slice(5, 7));
      const factor = seasonal ? (moy >= 6 && moy <= 8 ? 1.6 : 0.7) : 1;
      const isCurrent = i === 23;
      out.push(
        row(period, {
          channel: "other",
          sessions: 10_000,
          conversions: isCurrent ? current : Math.round(400 * factor * (1 + ((i * 7) % 5) / 100)),
        }),
      );
    }
    return out;
  }

  it("flags a collapse in conversions with steady traffic", () => {
    const found = detectAnomalies(series(110), P, "2026-08-01");
    const conv = found.find((a) => a.target.metric === "conversions");
    expect(conv).toBeDefined();
    expect(conv!.direction).toBe("down");
    expect(conv!.sentiment).toBe("bad");
    expect(conv!.severity).toBe("high");
  });

  it("stays quiet for ordinary variation", () => {
    expect(detectAnomalies(series(410), P, "2026-08-01")).toEqual([]);
  });

  it("does not mistake a seasonal peak for an anomaly", () => {
    // August is naturally ~2.3x the spring baseline; last year's shape explains it.
    const rows = series(Math.round(400 * 1.6 * 1.05), true);
    expect(detectAnomalies(rows, P, "2026-08-01").filter((a) => a.target.metric === "conversions")).toEqual([]);
  });

  it("needs enough history to say anything", () => {
    expect(detectAnomalies(series(1).slice(-3), P, "2026-08-01")).toEqual([]);
  });
});
