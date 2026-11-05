import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "./helpers/db";
import type { Handle } from "@/lib/db/connect";
import { recommendations } from "@/lib/db/schema";
import { seedDemoWorkspace } from "@/lib/seed/demo";
import { DEMO_PROPERTIES, generateDemoSnapshots, type DemoKey } from "@/lib/seed/generator";
import { modelAvailability, significantNumbers } from "@/lib/services/local-model";
import { agentStatus, investigateLead, investigatePending, runCheck, type Lead } from "@/lib/services/recommendation-agent";
import { countOpen, getInbox, refreshRecommendations } from "@/lib/services/recommendations";

const NOW = new Date("2026-09-14T12:00:00Z");
const config = { url: "http://ollama.test", model: "m" };
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

// --- One lead -------------------------------------------------------------------------------
const lead: Lead = {
  code: "L1",
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
  impact_change: 1,
  urgency_change: 0,
  confidence_change: 0,
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
    expect(v).toMatchObject({ verdict: "keep", impactChange: 1, checks: [{ check: "trend", thought: "Is this seasonal?" }] });
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

  it("rejects invented numbers, empty rewrites and unusable replies", async () => {
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, expected_outcome: "Win back 9,999 sessions." }) }).fetchImpl })).rejects.toThrow(/9999/);
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => ({ ...keep, next_step: "" }) }).fetchImpl })).rejects.toThrow(/empty/);
    await expect(investigateLead(args, { config, fetchImpl: fakeModel({ decide: () => "not json" }).fetchImpl })).rejects.toThrow(/valid JSON/);
  });
});

describe("modelAvailability", () => {
  it("is quiet when there is no Ollama, explains a missing model, and respects the off switch", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await modelAvailability({}, down)).toEqual({ ok: false, reason: "Ollama isn't running.", configured: false });
    const other = (async () => reply({ models: [{ name: "llama3.2:3b" }] })) as unknown as typeof fetch;
    const missing = await modelAvailability({}, other);
    expect(!missing.ok && missing.reason).toMatch(/ollama pull qwen3:4b/);
    const ready = (async () => reply({ models: [{ name: "qwen3:4b" }] })) as unknown as typeof fetch;
    expect(await modelAvailability({}, ready)).toEqual({ ok: true });
    expect((await modelAvailability({ CUEWORK_AI_AGENT: "off" }, ready)).ok).toBe(false);
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
    const firstTitle = before.open[0].title;

    // Drop the highest-priority lead; every other lead gets an unusable reply.
    const m = fakeModel({
      decide: (msgs) => (msgs[1].content.includes(firstTitle) ? { ...keep, ...blank, verdict: "drop", reason: "Too small to matter this month." } : "{"),
    });
    const status = await investigatePending(h.db, orgId, { config, fetchImpl: m.fetchImpl });
    expect(status).toMatchObject({ running: false, done: 1, failed: openBefore - 1 });
    expect(agentStatus(orgId)?.running).toBe(false);

    const after = await getInbox(h.db, orgId);
    expect(after.open).toHaveLength(openBefore - 1);
    expect(after.setAside.map((r) => r.title)).toEqual([firstTitle]);
    expect(after.setAside[0].agentNote).toMatch(/Too small/);
    expect(await countOpen(h.db, orgId)).toBe(openBefore - 1);

    // Same data → same leads → the verdict sticks; only the failed leads still await the agent.
    const refreshed = await refreshRecommendations(h.db, orgId, NOW);
    expect(refreshed.awaitingAgent).toBe(openBefore - 1);
    const [still] = await h.db.select().from(recommendations).where(eq(recommendations.id, after.setAside[0].id));
    expect(still.agentVerdict).toBe("drop");
  });
});
