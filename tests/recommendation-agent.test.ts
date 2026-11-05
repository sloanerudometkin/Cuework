import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "./helpers/db";
import type { Handle } from "@/lib/db/connect";
import { recommendations } from "@/lib/db/schema";
import { seedDemoWorkspace } from "@/lib/seed/demo";
import { DEMO_PROPERTIES, generateDemoSnapshots, type DemoKey } from "@/lib/seed/generator";
import { modelAvailability, significantNumbers } from "@/lib/services/ai-model";
import { agentStatus, checksFor, investigateLead, investigatePending, leadKind, runCheck, type Lead } from "@/lib/services/recommendation-agent";
import { countOpen, getInbox, refreshRecommendations } from "@/lib/services/recommendations";

const NOW = new Date("2026-09-14T12:00:00Z");
const config = { kind: "ollama" as const, url: "http://ollama.test", model: "m" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Msg = { role: string; content: string };
/** A fake Ollama: `step(messages)` answers investigation turns, `decide(messages)` answers the verdict turn. */
function fakeModel(handlers: { step?: (m: Msg[], turn: number) => unknown; decide: (m: Msg[]) => unknown }) {
  const calls: Msg[][] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const messages = JSON.parse(init.body as string).messages as Msg[];
    calls.push(messages);
    const last = messages.at(-1)!.content;
    const turn = messages.filter((m) => m.role === "assistant").length;
    const body = last.startsWith("Now give your verdict") ? handlers.decide(messages) : (handlers.step?.(messages, turn) ?? { thought: "Enough.", action: "decide" });
    return reply({ message: { role: "assistant", content: typeof body === "string" ? body : JSON.stringify(body) } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// --- Pure checks over the demo data ---------------------------------------------------------
const LATEST = "2026-08-01";
const ids = { authority: "auth", ferry: "ferr", airport: "airp" } as Record<DemoKey, string>;
const rows = generateDemoSnapshots({ propertyIds: ids, dataSourceIds: { authority: "s1", ferry: "s2", airport: "s3" } as Record<DemoKey, string>, latest: LATEST });
const ferry = DEMO_PROPERTIES.find((p) => p.key === "ferry")!;
const property = { id: "ferr", name: ferry.name, goal: ferry.goal, conversionLabel: ferry.conversionLabel };
const sessionsTarget = { metric: "sessions" as const, channel: "organic" as const, dimension: "property" as const, key: "", label: "Organic sessions" };

describe("agent checks", () => {
  it("each check returns readable, number-bearing text", () => {
    for (const check of ["trend", "compare_last_year", "breakdown", "tracking_check"] as const) {
      const out = runCheck(check, { rows, propertyId: "ferr", period: LATEST, target: sessionsTarget });
      expect(out.length).toBeGreaterThan(40);
      expect(significantNumbers(out).size).toBeGreaterThan(0);
    }
    expect(runCheck("trend", { rows, propertyId: "ferr", period: LATEST, target: sessionsTarget })).toMatch(/a year earlier/);
  });
});

describe("scoping checks to the lead", () => {
  const ctrTarget = { metric: "ctr" as const, channel: "organic" as const, dimension: "query" as const, key: "harbour cruise times", label: "Organic CTR" };
  const convTarget = { metric: "conversions" as const, channel: "all" as const, dimension: "property" as const, key: "", label: "Total conversions" };

  it("keeps property-wide conversions out of non-conversion leads", () => {
    const out = runCheck("compare_last_year", { rows, propertyId: "ferr", period: LATEST, target: ctrTarget });
    expect(out).not.toMatch(/conversion/i);
    expect(out).toMatch(/Organic channel impressions/);
    expect(checksFor({ category: "seo", target: ctrTarget })).not.toContain("tracking_check");
  });

  it("gives conversion leads the property-wide view and the tracking check", () => {
    expect(runCheck("compare_last_year", { rows, propertyId: "ferr", period: LATEST, target: convTarget })).toMatch(/Property conversions/);
    expect(checksFor({ category: "analytics", target: convTarget })).toContain("tracking_check");
  });
});

// --- One lead -------------------------------------------------------------------------------
const lead: Lead = {
  code: "L1",
  kind: "decline",
  category: "seo",
  text: {
    title: "Recover organic sessions on the ferry site",
    rationale: "Organic sessions fell 18.4% versus last year to 41,200.",
    expectedOutcome: "Win back 3,000–5,000 sessions a month.",
    nextStep: "Audit the top landing pages for lost rankings.",
    whyNow: "The decline has lasted 3 months.",
  },
  evidence: [{ label: "Organic sessions", value: "41,200", comparison: "−18.4% year over year" }],
  target: sessionsTarget,
  impact: 3,
  urgency: 3,
  confidence: 0.7,
};
const other: Lead = { ...lead, code: "L2", text: { ...lead.text, title: "Fix rankings on /timetables" } };
const keep = {
  verdict: "keep",
  merge_with: "",
  reason: "The drop is not seasonal: sessions were 41,200 against far more a year earlier.",
  lower_confidence: false,
  title: "Find out why organic visits to the ferry site fell",
  rationale: "Organic sessions are down 18.4% on last year, to 41,200 a month.",
  expected_outcome: "Win back 3,000–5,000 sessions a month.",
  next_step: "Check which landing pages lost rankings and fix the biggest first.",
  why_now: "This has gone on for 3 months.",
};
const blank = { title: "", rationale: "", expected_outcome: "", next_step: "", why_now: "" };
const args = { lead, others: [other], property, rows, period: LATEST };

describe("investigateLead", () => {
  it("runs the checks it asks for, then keeps the lead with new wording", async () => {
    const m = fakeModel({
      step: (_m, turn) => (turn === 0 ? { thought: "Is this seasonal?", action: "trend" } : { thought: "Seasonality ruled out.", action: "decide" }),
      decide: () => keep,
    });
    const v = await investigateLead(args, { config, fetchImpl: m.fetchImpl });
    expect(v).toMatchObject({ verdict: "keep", confidenceChange: 0, checks: [{ check: "trend", thought: "Is this seasonal?" }] });
    expect(v.text?.title).toBe(keep.title);
    // The check's result was fed back to the model before it decided.
    expect(m.calls[1].at(-1)?.content).toMatch(/^Result of trend:/);
  });

  it("stops after the check budget and refuses repeated checks", async () => {
    const m = fakeModel({ step: () => ({ thought: "Again.", action: "trend" }), decide: () => keep });
    const v = await investigateLead(args, { config, fetchImpl: m.fetchImpl });
    expect(v.checks).toHaveLength(1);
    expect(m.calls).toHaveLength(4); // 3 investigation turns + the verdict
  });

  it("can drop or merge, but only into a lead that exists", async () => {
    const drop = await investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, ...blank, verdict: "drop", reason: "This is the usual autumn dip." }) }).fetchImpl });
    expect(drop).toMatchObject({ verdict: "drop", text: null });
    const merge = await investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, ...blank, verdict: "merge", merge_with: "l2", reason: "Same ranking problem as L2." }) }).fetchImpl });
    expect(merge).toMatchObject({ verdict: "merge", mergeWith: "L2" });
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, ...blank, verdict: "merge", merge_with: "L9", reason: "Same as L9 here." }) }).fetchImpl })).rejects.toThrow(/unknown lead/);
  });

  it("can only lower confidence, never raise scores", async () => {
    const lowered = await investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, lower_confidence: true }) }).fetchImpl });
    expect(lowered.confidenceChange).toBe(-1);
    // The old score-raising fields aren't part of the reply shape; only lower_confidence counts.
    const tried = await investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, impact_change: 1, urgency_change: 1 }) }).fetchImpl });
    expect(tried).not.toHaveProperty("impactChange");
    expect(tried.confidenceChange).toBe(0);
  });

  it("allows numbers from its own instructions, like the 13 in a 13-month trend", async () => {
    const v = await investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, reason: "The 13-month trend shows sessions at 41,200, not a seasonal dip." }) }).fetchImpl });
    expect(v.verdict).toBe("keep");
  });

  it("won't set aside a lead whose metric is clearly worse than last year", async () => {
    // A query whose CTR halved versus the same month last year.
    const q = (period: string, clicks: number) => ({
      propertyId: "ferr", periodStart: period, channel: "organic" as const, dimension: "query" as const, key: "ferry times", secondaryKey: null,
      impressions: 10_000, clicks, sessions: 0, conversions: 0, cost: 0, avgPosition: 3, attrs: {},
    });
    const declining: Lead = { ...lead, target: { metric: "ctr", channel: "organic", dimension: "query", key: "ferry times", label: "Organic CTR · ferry times" } };
    const synthetic = [q(LATEST, 200), q("2025-08-01", 400)];
    const dropIt = fakeModel({ decide: () => ({ ...keep, ...blank, verdict: "drop", reason: "Looks seasonal to me." }) });
    await expect(investigateLead({ ...args, lead: declining, rows: synthetic }, { config, fetchImpl: dropIt.fetchImpl })).rejects.toThrow(/-50.0% vs last year/);
    // The same reply on a lead that's fine year over year is accepted.
    expect((await investigateLead({ ...args, lead: declining, rows: [q(LATEST, 400), q("2025-08-01", 400)] }, { config, fetchImpl: dropIt.fetchImpl })).verdict).toBe("drop");
  });

  it("never lets a gap or opportunity lead be set aside", async () => {
    const gap: Lead = { ...lead, kind: "gap" };
    const m = fakeModel({ decide: () => ({ ...keep, ...blank, verdict: "drop", reason: "No decline vs last year." }) });
    await expect(investigateLead({ ...args, lead: gap }, { config, fetchImpl: m.fetchImpl })).rejects.toThrow(/Unexpected reply shape/);
    // The model is told what kind of lead it is, and "drop" isn't on offer.
    expect(m.calls[0][1].content).toMatch(/standing gap or opportunity/);
    expect(m.calls.at(-1)!.at(-1)!.content).not.toMatch(/verdict "drop"/);
    expect(leadKind("low_ctr_high_impressions")).toBe("gap");
    expect(leadKind("yoy_traffic_decline")).toBe("decline");
    expect(leadKind("something_new")).toBe("gap");
  });

  it("rejects invented numbers, empty rewrites and unusable replies", async () => {
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, expected_outcome: "Win back 9,999 sessions." }) }).fetchImpl })).rejects.toThrow(/9999/);
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, next_step: "" }) }).fetchImpl })).rejects.toThrow(/empty/);
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => "not json" }).fetchImpl })).rejects.toThrow(/valid JSON/);
  });
});

describe("modelAvailability (local)", () => {
  it("is quiet when there is no Ollama, explains a missing model, and respects the off switch", async () => {
    const demo = { isDemo: true };
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await modelAvailability(demo, {}, down)).toEqual({ ok: false, reason: "Ollama isn't running.", configured: false });
    const other = (async () => reply({ models: [{ name: "llama3.2:3b" }] })) as unknown as typeof fetch;
    const missing = await modelAvailability(demo, {}, other);
    expect(!missing.ok && missing.reason).toMatch(/ollama pull qwen3:4b/);
    const ready = (async () => reply({ models: [{ name: "qwen3:4b" }] })) as unknown as typeof fetch;
    expect(await modelAvailability(demo, {}, ready)).toMatchObject({ ok: true, config: { kind: "ollama" } });
    expect((await modelAvailability(demo, { CUEWORK_AI_AGENT: "off" }, ready)).ok).toBe(false);
  });
  it("normalises numbers for the invented-number guard", () => {
    expect([...significantNumbers("12,400 views, 1.80% CTR, 3 months, $1,200")].sort()).toEqual(["1.8", "1200", "12400"]);
  });
});

// --- A whole workspace ----------------------------------------------------------------------
describe("investigatePending", () => {
  let h: Handle;
  let orgId: string;
  beforeAll(async () => {
    h = await openTestDb();
    orgId = (await seedDemoWorkspace(h.db, NOW)).orgId;
  });
  afterAll(async () => h?.close());

  it("sets aside what the agent drops, keeps its verdicts through a refresh, and leaves failures as the rules wrote them", async () => {
    const before = await getInbox(h.db, orgId);
    const openBefore = before.open.length;
    expect(openBefore).toBeGreaterThan(2);
    // Set aside the top lead by merging it into another lead of the same property (allowed for any
    // kind of lead), keep that other lead with lowered confidence, and give every other lead an
    // unusable reply.
    const top = before.open[0];
    const second = before.open.find((r) => r.id !== top.id && r.propertyId === top.propertyId)!;
    expect(second).toBeDefined();
    const firstTitle = top.title;
    const m = fakeModel({
      decide: (msgs) => {
        const own = /^Lead L\d+ · [^:]+: (.*)$/m.exec(msgs[1].content)?.[1];
        if (own === firstTitle) {
          const code = new RegExp(`^- (L\\d+): ${second.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").exec(msgs[1].content)?.[1];
          return { ...keep, ...blank, verdict: "merge", merge_with: code ?? "", reason: "Same underlying issue as the other lead." };
        }
        if (own === second.title)
          return { ...keep, lower_confidence: true, reason: "A check weakened this lead.", title: second.title, rationale: second.rationale, expected_outcome: second.expectedOutcome, next_step: second.nextStep, why_now: second.whyNow };
        return "{";
      },
    });
    const status = await investigatePending(h.db, orgId, { config, fetchImpl: m.fetchImpl });
    expect(status).toMatchObject({ running: false, done: 2, failed: openBefore - 2 });

    const [kept] = await h.db.select().from(recommendations).where(eq(recommendations.id, second.id));
    expect(kept).toMatchObject({ agentVerdict: "keep", impact: second.impact, urgency: second.urgency });
    expect(kept.confidence).toBeCloseTo(second.confidence - 0.1);
    expect(kept.priorityScore).toBeLessThan(second.priorityScore);
    expect(kept.agentScoreChanges).toEqual([{ score: "confidence", from: second.confidence, to: kept.confidence }]);
    expect(agentStatus(orgId)?.running).toBe(false);

    const after = await getInbox(h.db, orgId);
    expect(after.open).toHaveLength(openBefore - 1);
    expect(after.setAside.map((r) => r.title)).toEqual([firstTitle]);
    expect(after.setAside[0].agentNote).toMatch(/Same underlying issue/);
    expect(after.setAside[0].agentVerdict).toBe("merge");
    expect(await countOpen(h.db, orgId)).toBe(openBefore - 1);

    // Same data → same leads → the verdict sticks; only the failed leads still await the agent.
    const refreshed = await refreshRecommendations(h.db, orgId, NOW);
    expect(refreshed.awaitingAgent).toBe(openBefore - 2);
    const [still] = await h.db.select().from(recommendations).where(eq(recommendations.id, after.setAside[0].id));
    expect(still.agentVerdict).toBe("merge");
  });
});
