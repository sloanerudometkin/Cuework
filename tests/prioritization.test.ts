import { describe, expect, it } from "vitest";
import { comparePriority, explainPriority, priorityBand, scorePriority } from "@/lib/domain/prioritization";

const base = { impact: 3, urgency: 3, strategic: 3, confidence: 0.7, effort: 3 };

describe("scorePriority", () => {
  it("stays within 0–100 for any legal input, and clamps illegal input", () => {
    for (const impact of [1, 3, 5]) {
      for (const effort of [1, 3, 5]) {
        for (const confidence of [0, 0.5, 1]) {
          const s = scorePriority({ impact, urgency: 5, strategic: 5, confidence, effort });
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(100);
        }
      }
    }
    expect(scorePriority({ impact: 99, urgency: 99, strategic: 99, confidence: 9, effort: -4 })).toBeLessThanOrEqual(100);
    expect(scorePriority({ impact: -5, urgency: -5, strategic: -5, confidence: -1, effort: 99 })).toBeGreaterThanOrEqual(0);
  });

  it("rises with impact, urgency, strategic relevance and confidence", () => {
    const s = scorePriority(base);
    expect(scorePriority({ ...base, impact: 5 })).toBeGreaterThan(s);
    expect(scorePriority({ ...base, urgency: 5 })).toBeGreaterThan(s);
    expect(scorePriority({ ...base, strategic: 5 })).toBeGreaterThan(s);
    expect(scorePriority({ ...base, confidence: 1 })).toBeGreaterThan(s);
  });

  it("falls as effort grows, so quick wins beat heavy lifts of equal value", () => {
    expect(scorePriority({ ...base, effort: 1 })).toBeGreaterThan(scorePriority({ ...base, effort: 5 }));
  });

  it("discounts low-confidence ideas by at most 40%", () => {
    const sure = scorePriority({ ...base, confidence: 1 });
    const unsure = scorePriority({ ...base, confidence: 0 });
    expect(unsure / sure).toBeGreaterThanOrEqual(0.6 - 0.01);
    expect(unsure).toBeLessThan(sure);
  });

  it("weights impact more than urgency, and urgency more than strategic fit", () => {
    const low = { impact: 1, urgency: 1, strategic: 1, confidence: 0.7, effort: 3 };
    const gainImpact = scorePriority({ ...low, impact: 5 }) - scorePriority(low);
    const gainUrgency = scorePriority({ ...low, urgency: 5 }) - scorePriority(low);
    const gainStrategic = scorePriority({ ...low, strategic: 5 }) - scorePriority(low);
    expect(gainImpact).toBeGreaterThan(gainUrgency);
    expect(gainUrgency).toBeGreaterThan(gainStrategic);
  });
});

describe("priorityBand", () => {
  it("maps scores to bands at the documented cut-offs", () => {
    expect(priorityBand(62)).toBe("now");
    expect(priorityBand(61.9)).toBe("soon");
    expect(priorityBand(45)).toBe("soon");
    expect(priorityBand(44.9)).toBe("consider");
  });
});

describe("explainPriority", () => {
  it("attributes a positive lift to a high input and a negative one to a low input", () => {
    const d = explainPriority({ impact: 5, urgency: 1, strategic: 3, confidence: 0.6, effort: 3 });
    expect(d.find((x) => x.label === "Impact")!.points).toBeGreaterThan(0);
    expect(d.find((x) => x.label === "Urgency")!.points).toBeLessThan(0);
    expect(d.find((x) => x.label === "Strategic fit")!.points).toBe(0);
  });
});

describe("comparePriority", () => {
  it("orders by score, then lower effort, then title", () => {
    const list = [
      { priorityScore: 50, effort: 4, title: "b" },
      { priorityScore: 60, effort: 5, title: "z" },
      { priorityScore: 50, effort: 2, title: "c" },
      { priorityScore: 50, effort: 2, title: "a" },
    ].sort(comparePriority);
    expect(list.map((x) => x.title)).toEqual(["z", "a", "c", "b"]);
  });
});
