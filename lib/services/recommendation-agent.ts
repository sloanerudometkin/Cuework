import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/db/connect";
import { properties, recommendationEvidence, recommendations, type AgentCheck } from "@/lib/db/schema";
import { addMonths, formatMonth, lastYear } from "@/lib/domain/dates";
import { evaluateTarget, filterRows, formatMetricValue, pctChange, propertyPeriods, sumRows, metricFromTotals } from "@/lib/domain/metrics";
import { scorePriority } from "@/lib/domain/prioritization";
import { CATEGORY_LABEL, type Category, type Dimension, type MetricId, type MetricTarget, type Snapshot } from "@/lib/domain/types";
import { chatJson, LocalModelError, significantNumbers, type CardText, type ChatMessage, type EvidenceLine, type ModelConfig } from "./local-model";
import { loadSnapshots } from "./workspace";

/**
 * The lead-investigator agent.
 *
 * Cuework's rules engine is the lead generator: every card it produces is a lead. For each
 * open lead, a small agent running on a free local model decides which checks to run
 * against the data (up to MAX_CHECKS), then returns a verdict:
 *   keep  — real and worth the team's time: rewritten in plain language, scores nudged ±1
 *   drop  — a false alarm (seasonal dip, tracking problem, too small): set aside with a reason
 *   merge — the same issue as another open lead: set aside, pointing at that lead
 *
 * Each lead is its own short conversation and every reply is constrained to a fixed JSON
 * shape, which is what keeps a 4B model reliable on a laptop. The code runs the checks;
 * the model only chooses them and judges the results. Anything unusable (bad JSON, an
 * invented number, a timeout) leaves that lead exactly as the rules engine wrote it.
 */

export const MAX_CHECKS = 3;

// ---------------------------------------------------------------------------
// Checks the agent can ask for (deterministic code over the property's data)
// ---------------------------------------------------------------------------

export const CHECKS = {
  trend: "The target metric for each of the last 13 months, next to the same month a year earlier. Use it to tell a real decline from seasonality.",
  compare_last_year: "The target metric and the property's total sessions and conversions this month vs the same month last year.",
  breakdown: "The rows behind the target: for a whole-property metric, the items that moved most since last month; for one query/page/keyword, its last 6 months in detail.",
  tracking_check: "Sessions, conversions and conversion rate for the whole property over the last 4 months. Use it to spot broken conversion tracking.",
} as const;
export type CheckName = keyof typeof CHECKS;

const fmt = (metric: MetricId, v: number | null) => formatMetricValue(metric, v);
const pct = (c: number | null, p: number | null) => {
  const d = pctChange(c, p);
  return d == null ? "n/a" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
};

const BREAKDOWN_DIMS: Record<string, { dimension: Dimension; metric: MetricId }[]> = {
  organic: [
    { dimension: "query", metric: "clicks" },
    { dimension: "page", metric: "sessions" },
  ],
  paid: [{ dimension: "campaign", metric: "cost" }],
  other: [{ dimension: "page", metric: "sessions" }],
  all: [{ dimension: "page", metric: "sessions" }],
};

export function runCheck(check: CheckName, ctx: { rows: Snapshot[]; propertyId: string; period: string; target: MetricTarget }): string {
  const { rows, propertyId, period, target } = ctx;
  const val = (t: MetricTarget, p: string) => evaluateTarget(rows, propertyId, t, p);
  const totals = (p: string) => sumRows(filterRows(rows, { propertyId, period: p, dimension: "property" }));

  if (check === "trend") {
    const lines = [];
    for (let i = 12; i >= 0; i--) {
      const p = addMonths(period, -i);
      const v = val(target, p);
      if (v == null) continue;
      const ly = val(target, lastYear(p));
      lines.push(`${formatMonth(p)}: ${fmt(target.metric, v)}${ly != null ? ` (a year earlier ${fmt(target.metric, ly)}, ${pct(v, ly)})` : ""}`);
    }
    return lines.length ? `${target.label}, by month:\n${lines.join("\n")}` : "No monthly values for this target.";
  }

  if (check === "compare_last_year") {
    const ly = lastYear(period);
    const now = totals(period);
    const then = totals(ly);
    const cur = val(target, period);
    const prev = val(target, ly);
    return [
      `${target.label}: ${fmt(target.metric, cur)} in ${formatMonth(period)} vs ${fmt(target.metric, prev)} in ${formatMonth(ly)} (${pct(cur, prev)}).`,
      `Property sessions: ${fmt("sessions", now.sessions)} vs ${fmt("sessions", then.sessions)} (${pct(now.sessions, then.sessions)}).`,
      `Property conversions: ${fmt("conversions", now.conversions)} vs ${fmt("conversions", then.conversions)} (${pct(now.conversions, then.conversions)}).`,
    ].join("\n");
  }

  if (check === "tracking_check") {
    const lines = [];
    for (let i = 3; i >= 0; i--) {
      const p = addMonths(period, -i);
      const t = totals(p);
      lines.push(`${formatMonth(p)}: sessions ${fmt("sessions", t.sessions)}, conversions ${fmt("conversions", t.conversions)}, conversion rate ${fmt("conversion_rate", metricFromTotals("conversion_rate", t))}`);
    }
    return `Whole property, all channels:\n${lines.join("\n")}`;
  }

  // breakdown
  if (target.dimension !== "property" && target.key) {
    const lines = [];
    for (let i = 5; i >= 0; i--) {
      const p = addMonths(period, -i);
      const t = sumRows(filterRows(rows, { propertyId, period: p, channel: target.channel, dimension: target.dimension, key: target.key }));
      if (!t.impressions && !t.sessions && !t.clicks && !t.cost) continue;
      const parts = [
        t.impressions ? `impressions ${fmt("impressions", t.impressions)}` : null,
        t.clicks ? `clicks ${fmt("clicks", t.clicks)}` : null,
        t.impressions ? `CTR ${fmt("ctr", metricFromTotals("ctr", t))}` : null,
        t.sessions ? `sessions ${fmt("sessions", t.sessions)}` : null,
        `conversions ${fmt("conversions", t.conversions)}`,
        t.cost ? `cost ${fmt("cost", t.cost)}` : null,
      ].filter(Boolean);
      lines.push(`${formatMonth(p)}: ${parts.join(", ")}`);
    }
    return lines.length ? `“${target.key}” (${target.channel} ${target.dimension}), last 6 months:\n${lines.join("\n")}` : "No rows for this item.";
  }
  const prevP = addMonths(period, -1);
  const out = [];
  for (const { dimension, metric } of BREAKDOWN_DIMS[target.channel] ?? BREAKDOWN_DIMS.all) {
    const channel = target.channel === "all" ? undefined : target.channel;
    const pick = (p: string) => {
      const m = new Map<string, number>();
      for (const r of filterRows(rows, { propertyId, period: p, channel, dimension })) m.set(r.key, (m.get(r.key) ?? 0) + (r[metric as "clicks" | "sessions" | "cost"] ?? 0));
      return m;
    };
    const cur = pick(period);
    const prev = pick(prevP);
    const moved = [...new Set([...cur.keys(), ...prev.keys()])]
      .map((k) => ({ k, c: cur.get(k) ?? 0, p: prev.get(k) ?? 0 }))
      .sort((a, b) => Math.abs(b.c - b.p) - Math.abs(a.c - a.p))
      .slice(0, 6);
    if (moved.length) out.push(`Biggest ${dimension} moves in ${metric}, ${formatMonth(prevP)} → ${formatMonth(period)}:\n${moved.map((m) => `${m.k}: ${fmt(metric, m.p)} → ${fmt(metric, m.c)} (${pct(m.c, m.p)})`).join("\n")}`);
  }
  return out.length ? out.join("\n\n") : "No item-level rows to break this down.";
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export interface Lead {
  code: string;
  category: Category;
  text: CardText;
  evidence: EvidenceLine[];
  target: MetricTarget;
  impact: number;
  urgency: number;
  confidence: number;
}

export interface Verdict {
  verdict: "keep" | "drop" | "merge";
  mergeWith: string | null;
  reason: string;
  text: CardText | null;
  impactChange: number;
  urgencyChange: number;
  confidenceChange: number;
  checks: AgentCheck[];
}

const STEP = z.object({
  thought: z.string().max(300).describe("One short sentence: what you want to find out next, or why you're ready to decide."),
  action: z.enum([...(Object.keys(CHECKS) as CheckName[]), "decide"]),
});

const DECISION = z.object({
  verdict: z.enum(["keep", "drop", "merge"]),
  merge_with: z.string().max(10).describe('Code of the other lead (e.g. "L2") when merging, otherwise ""'),
  reason: z.string().min(10).max(400).describe("One or two sentences citing what you found."),
  impact_change: z.number().int().min(-1).max(1),
  urgency_change: z.number().int().min(-1).max(1),
  confidence_change: z.number().int().min(-1).max(1),
  title: z.string().max(140),
  rationale: z.string().max(900),
  expected_outcome: z.string().max(400),
  next_step: z.string().max(500),
  why_now: z.string().max(400),
});

const SYSTEM = `You are Cuework's analyst agent. Cuework helps a small in-house marketing team decide what to work on. Cuework's rules flagged a lead from the team's data. Your job is to check whether it is a real, worthwhile issue before the team sees it, using a few data checks.

Available checks:
${Object.entries(CHECKS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
- decide: you know enough to give a verdict.

Each turn, reply with JSON: {"thought": "...", "action": "<check or decide>"}. Run at most ${MAX_CHECKS} checks; one or two is often enough. Do not repeat a check.

Common false alarms: a dip that also happened a year earlier (seasonality), conversions collapsing while traffic holds (broken tracking: the real issue is tracking), and volumes too small to matter.`;

const DECIDE_PROMPT = `Now give your verdict as JSON.
- verdict "keep": the lead is real and worth doing. Rewrite title, rationale, expected_outcome, next_step and why_now in plain, specific language (title starts with a verb and names the page, query, campaign or keyword).
- verdict "drop": it's a false alarm or not worth the team's time. Leave the text fields "".
- verdict "merge": it's the same issue as another listed lead; put its code in merge_with. Leave the text fields "".
- Only use numbers that appear in the lead or in your check results. Never invent figures.
- impact_change, urgency_change and confidence_change are -1, 0 or 1. Use 0 unless a check clearly justifies a change, and say why in reason.`;

function leadMessage(lead: Lead, property: { name: string; goal: string; conversionLabel: string }, others: Lead[]) {
  return [
    `Property: ${property.name}${property.goal ? ` (goal: ${property.goal})` : ""}. Conversions are “${property.conversionLabel}”.`,
    `Lead ${lead.code} · ${CATEGORY_LABEL[lead.category]}: ${lead.text.title}`,
    `Why it was flagged: ${lead.text.rationale}`,
    `Suggested action: ${lead.text.nextStep}`,
    `Expected outcome: ${lead.text.expectedOutcome}`,
    `Why now: ${lead.text.whyNow}`,
    `Evidence:\n${lead.evidence.map((e) => `- ${e.label}: ${e.value}${e.comparison ? ` (${e.comparison})` : ""}`).join("\n")}`,
    `Measured by: ${lead.target.label}`,
    `Current scores: impact ${lead.impact}/5, urgency ${lead.urgency}/5, confidence ${Math.round(lead.confidence * 100)}%.`,
    others.length ? `Other open leads for this property:\n${others.map((o) => `- ${o.code}: ${o.text.title}`).join("\n")}` : "There are no other open leads for this property.",
  ].join("\n\n");
}

export async function investigateLead(
  input: {
    lead: Lead;
    others: Lead[];
    property: { id: string; name: string; goal: string; conversionLabel: string };
    rows: Snapshot[];
    period: string;
  },
  opts: { config?: ModelConfig; fetchImpl?: typeof fetch } = {},
): Promise<Verdict> {
  const { lead, others, property, rows, period } = input;
  const first = leadMessage(lead, property, others);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: first },
  ];
  const checks: AgentCheck[] = [];
  let seen = first;

  for (let i = 0; i < MAX_CHECKS; i++) {
    const step = await chatJson(messages, STEP, { ...opts, maxTokens: 200 });
    messages.push({ role: "assistant", content: JSON.stringify(step) });
    if (step.action === "decide") break;
    const check = step.action as CheckName;
    if (checks.some((c) => c.check === check)) {
      messages.push({ role: "user", content: "You already ran that check. Choose a different one, or decide." });
      continue;
    }
    const result = runCheck(check, { rows, propertyId: property.id, period, target: lead.target });
    checks.push({ check, thought: step.thought });
    seen += `\n${result}`;
    messages.push({ role: "user", content: `Result of ${check}:\n${result}` });
  }

  messages.push({ role: "user", content: DECIDE_PROMPT });
  const d = await chatJson(messages, DECISION, { ...opts, maxTokens: 900 });

  const text: CardText = { title: d.title.trim(), rationale: d.rationale.trim(), expectedOutcome: d.expected_outcome.trim(), nextStep: d.next_step.trim(), whyNow: d.why_now.trim() };
  if (d.verdict === "keep") {
    const short = Object.entries(text).find(([, v]) => v.length < 8);
    if (short) throw new LocalModelError(`Kept the lead but left “${short[0]}” empty.`);
  }
  let mergeWith: string | null = null;
  if (d.verdict === "merge") {
    mergeWith = d.merge_with.trim().toUpperCase();
    if (!others.some((o) => o.code === mergeWith)) throw new LocalModelError(`Merged into unknown lead “${d.merge_with}”.`);
  }

  // Guard against invented numbers: everything significant must come from the lead or a check result.
  const allowed = significantNumbers(seen);
  const said = [d.reason, ...(d.verdict === "keep" ? Object.values(text) : [])].join(" ");
  const invented = [...significantNumbers(said)].filter((n) => !allowed.has(n));
  if (invented.length) throw new LocalModelError(`Introduced numbers not in the data: ${invented.join(", ")}`);

  return {
    verdict: d.verdict,
    mergeWith,
    reason: d.reason.trim(),
    text: d.verdict === "keep" ? text : null,
    impactChange: d.impact_change,
    urgencyChange: d.urgency_change,
    confidenceChange: d.confidence_change,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Background investigation for a workspace
// ---------------------------------------------------------------------------

export interface AgentStatus {
  running: boolean;
  total: number;
  done: number;
  failed: number;
}

/** Per-process progress, so the inbox can show "investigating…" and refresh itself. */
const g = globalThis as unknown as { __cueworkAgent?: Map<string, AgentStatus & { again: boolean }> };
const jobs = (g.__cueworkAgent ??= new Map());

export function agentStatus(orgId: string): AgentStatus | null {
  const j = jobs.get(orgId);
  return j ? { running: j.running, total: j.total, done: j.done, failed: j.failed } : null;
}

const OPEN = ["new", "refining"] as const;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Investigates every open, not-yet-investigated lead, highest priority first. Safe to call
 * while a run is in progress: the running job picks up the new work instead of starting another.
 */
export async function investigatePending(db: Db, orgId: string, opts: { config?: ModelConfig; fetchImpl?: typeof fetch } = {}): Promise<AgentStatus> {
  const existing = jobs.get(orgId);
  if (existing?.running) {
    existing.again = true;
    return agentStatus(orgId)!;
  }
  const job = { running: true, total: 0, done: 0, failed: 0, again: true };
  jobs.set(orgId, job);
  const failedIds = new Set<string>();

  try {
    while (job.again) {
      job.again = false;
      const open = await db
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.orgId, orgId), inArray(recommendations.status, [...OPEN])))
        .orderBy(desc(recommendations.priorityScore));
      const pending = open.filter((r) => r.agentVerdict == null && !failedIds.has(r.id));
      job.total = job.done + job.failed + pending.length;
      if (!pending.length) break;

      const props = await db.select().from(properties).where(eq(properties.orgId, orgId));
      const evidence = await db.select().from(recommendationEvidence).where(inArray(recommendationEvidence.recommendationId, open.map((r) => r.id)));
      const snapshots = await loadSnapshots(db, orgId);
      const periods = propertyPeriods(snapshots);
      const toLead = (r: (typeof open)[number], i: number): Lead => ({
        code: `L${i + 1}`,
        category: r.category as Category,
        text: { title: r.title, rationale: r.rationale, expectedOutcome: r.expectedOutcome, nextStep: r.nextStep, whyNow: r.whyNow },
        evidence: evidence.filter((e) => e.recommendationId === r.id).sort((a, b) => a.position - b.position),
        target: r.target,
        impact: r.impact,
        urgency: r.urgency,
        confidence: r.confidence,
      });
      const leads = new Map(open.map((r, i) => [r.id, toLead(r, i)]));
      const byCode = new Map(open.map((r) => [leads.get(r.id)!.code, r]));

      for (const rec of pending) {
        const prop = props.find((p) => p.id === rec.propertyId);
        const period = periods.get(rec.propertyId);
        if (!prop || !period) continue;
        // Leads already set aside aren't merge targets.
        const others = open.filter((o) => o.id !== rec.id && o.propertyId === rec.propertyId && o.agentVerdict !== "drop" && o.agentVerdict !== "merge").map((o) => leads.get(o.id)!);
        let v: Verdict;
        try {
          v = await investigateLead(
            {
              lead: leads.get(rec.id)!,
              others,
              property: { id: prop.id, name: prop.name, goal: prop.goal, conversionLabel: prop.conversionLabel },
              rows: snapshots.filter((s) => s.propertyId === prop.id),
              period,
            },
            opts,
          );
        } catch (e) {
          job.failed++;
          failedIds.add(rec.id);
          console.warn(`[ai-agent] left “${rec.title}” as the rules wrote it: ${e instanceof Error ? e.message : e}`);
          continue;
        }

        const impact = clamp(rec.impact + v.impactChange, 1, 5);
        const urgency = clamp(rec.urgency + v.urgencyChange, 1, 5);
        const confidence = clamp(Math.round((rec.confidence + v.confidenceChange * 0.1) * 100) / 100, 0.1, 0.95);
        const mergedInto = v.mergeWith ? byCode.get(v.mergeWith) : undefined;
        const note = mergedInto ? `${v.reason} (Same issue as “${mergedInto.title}”.)` : v.reason;
        await db
          .update(recommendations)
          .set({
            ...(v.text ? { ...v.text, aiWritten: true } : {}),
            impact,
            urgency,
            confidence,
            priorityScore: scorePriority({ impact, urgency, strategic: rec.strategic, confidence, effort: rec.effort }),
            agentVerdict: v.verdict,
            agentNote: note,
            agentChecks: v.checks,
          })
          // Only apply if a refresh hasn't replaced the lead meanwhile and it's still open.
          .where(
            and(
              eq(recommendations.id, rec.id),
              isNull(recommendations.agentVerdict),
              rec.sourceHash ? eq(recommendations.sourceHash, rec.sourceHash) : undefined,
              inArray(recommendations.status, [...OPEN]),
            ),
          );
        rec.agentVerdict = v.verdict;
        job.done++;
      }
    }
  } catch (e) {
    console.error("[ai-agent] stopped early", e);
  } finally {
    job.running = false;
  }
  return agentStatus(orgId)!;
}
