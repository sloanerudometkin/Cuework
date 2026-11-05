import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/db/connect";
import { properties, recommendationEvidence, recommendations, type AgentCheck, type AgentScoreChange } from "@/lib/db/schema";
import { addMonths, formatMonth, lastYear } from "@/lib/domain/dates";
import { evaluateTarget, filterRows, formatMetricValue, pctChange, propertyPeriods, sentiment, sumRows, metricFromTotals } from "@/lib/domain/metrics";
import { scorePriority } from "@/lib/domain/prioritization";
import { CATEGORY_LABEL, type Category, type Dimension, type MetricId, type MetricTarget, type Snapshot } from "@/lib/domain/types";
import { chatJson, inventedNumbers, ModelError, type CardText, type ChatMessage, type EvidenceLine, type ModelConfig } from "./ai-model";
import { loadSnapshots } from "./workspace";

/**
 * The lead-investigator agent.
 *
 * Cuework's rules engine is the lead generator: every card it produces is a lead. For each
 * open lead, a small agent running on a free local model decides which checks to run
 * against the data (up to MAX_CHECKS), then returns a verdict:
 *   keep  — real and worth the team's time: rewritten in plain language
 *   drop  — a false alarm (seasonal dip, tracking problem, too small): set aside with a reason
 *   merge — the same issue as another open lead: set aside, pointing at that lead
 *
 * Each lead is its own short conversation and every reply is constrained to a fixed JSON
 * shape, which is what keeps a 4B model reliable on a laptop. The code runs the checks;
 * the model only chooses them and judges the results. Anything unusable (bad JSON, an
 * invented number, a timeout) leaves that lead exactly as the rules engine wrote it.
 *
 * The agent can't raise a lead's priority: impact and urgency stay as the rules scored them,
 * and the only score it may touch is confidence, and only downwards, when a check undercuts
 * the lead. Its real levers are keep / drop / merge. (In live runs a 4B model raised scores on
 * muddled reasoning, so it isn't trusted with that.)
 */

export const MAX_CHECKS = 3;
/** A lead whose target is at least this much worse than last year can't be set aside as a false alarm. */
export const YOY_VETO = 0.1;

// ---------------------------------------------------------------------------
// Checks the agent can ask for (deterministic code over the property's data)
// ---------------------------------------------------------------------------

export const CHECKS = {
  trend: "The target metric for each of the last 13 months, next to the same month a year earlier. Use it to tell a real decline from seasonality.",
  compare_last_year: "The target metric this month vs the same month last year, next to the same comparison for its channel's overall traffic, so you can tell an item-specific change from a channel-wide one.",
  breakdown: "The rows behind the target: for a whole-property metric, the items that moved most since last month; for one query/page/keyword, its last 6 months in detail.",
  tracking_check: "Sessions, conversions and conversion rate for the whole property over the last 4 months. Use it to spot broken conversion tracking.",
} as const;
export type CheckName = keyof typeof CHECKS;

const CONVERSION_METRICS: MetricId[] = ["conversions", "conversion_rate", "cpa"];

/** Whether a lead is about conversions at all. Property-wide conversion data only confuses the others. */
export function isConversionLead(lead: { category: Category; target: MetricTarget }): boolean {
  return lead.category === "analytics" || CONVERSION_METRICS.includes(lead.target.metric);
}

/** The checks offered for a lead. tracking_check only makes sense for conversion leads. */
export function checksFor(lead: { category: Category; target: MetricTarget }): CheckName[] {
  const all = Object.keys(CHECKS) as CheckName[];
  return isConversionLead(lead) ? all : all.filter((c) => c !== "tracking_check");
}

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
    const cur = val(target, period);
    const prev = val(target, ly);
    const lines = [`${target.label}: ${fmt(target.metric, cur)} in ${formatMonth(period)} vs ${fmt(target.metric, prev)} in ${formatMonth(ly)} (${pct(cur, prev)}).`];
    if (CONVERSION_METRICS.includes(target.metric)) {
      // Conversion leads: compare against the whole property's traffic and conversions.
      const now = totals(period);
      const then = totals(ly);
      lines.push(
        `Property sessions: ${fmt("sessions", now.sessions)} vs ${fmt("sessions", then.sessions)} (${pct(now.sessions, then.sessions)}).`,
        `Property conversions: ${fmt("conversions", now.conversions)} vs ${fmt("conversions", then.conversions)} (${pct(now.conversions, then.conversions)}).`,
      );
    } else {
      // Everything else: compare only against the same channel's overall volume, never conversions.
      const channel = target.channel === "all" ? undefined : target.channel;
      const ch = (p: string) => sumRows(filterRows(rows, { propertyId, period: p, channel, dimension: "property" }));
      const now = ch(period);
      const then = ch(ly);
      const name = target.channel === "all" ? "All channels" : `${target.channel[0].toUpperCase()}${target.channel.slice(1)} channel`;
      const volume: MetricId = target.channel === "paid" ? "clicks" : target.metric === "impressions" || target.metric === "ctr" || target.metric === "avg_position" ? "impressions" : "sessions";
      lines.push(`${name} ${volume}: ${fmt(volume, now[volume as "clicks" | "impressions" | "sessions"])} vs ${fmt(volume, then[volume as "clicks" | "impressions" | "sessions"])} (${pct(now[volume as "clicks" | "impressions" | "sessions"], then[volume as "clicks" | "impressions" | "sessions"])}).`);
    }
    return lines.join("\n");
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

/**
 * What kind of claim a lead makes, from the rule that produced it:
 *  - decline: something got worse (can be a false alarm: seasonality, tracking)
 *  - gap: a standing shortfall or opportunity vs a benchmark or a missing page. A flat trend
 *    doesn't refute it, and the rules already require enough volume to matter, so the agent
 *    may keep or merge these but never set them aside. (On Groq the agent dropped two real gap
 *    leads because they showed "no decline vs last year".)
 */
export type LeadKind = "decline" | "gap";
const DECLINE_RULES = new Set(["yoy_traffic_decline", "landing_page_conversion_decline", "conversion_tracking_anomaly"]);
/** Unknown rules count as gaps, which is the safe side: they can't be set aside. */
export const leadKind = (ruleKey: string): LeadKind => (DECLINE_RULES.has(ruleKey) ? "decline" : "gap");

export interface Lead {
  code: string;
  kind: LeadKind;
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
  /** 0, or -1 to lower confidence by 10 points because a check undercut the lead. */
  confidenceChange: 0 | -1;
  checks: AgentCheck[];
}

/** Per lead, so the model can only pick checks that make sense for it. */
const stepSchema = (checks: CheckName[]) =>
  z.object({
    // Generous limit: a tight one makes constrained decoding cut thoughts off mid-sentence.
    thought: z.string().max(500).describe("Under 20 words: what you will check and why, or why you can decide now."),
    action: z.enum([...checks, "decide"]),
  });

/** Built per lead: gap leads can't choose "drop". */
const decisionSchema = (kind: LeadKind) =>
  z.object({
    verdict: kind === "decline" ? z.enum(["keep", "drop", "merge"]) : z.enum(["keep", "merge"]),
    merge_with: z.string().max(10).describe('Code of the other lead (e.g. "L2") when merging, otherwise ""'),
    reason: z.string().min(10).max(400).describe("One or two sentences citing what you found."),
    lower_confidence: z.boolean().describe("true only if a check contradicts or weakens the lead"),
    title: z.string().max(140),
    rationale: z.string().max(900),
    expected_outcome: z.string().max(400),
    next_step: z.string().max(500),
    why_now: z.string().max(400),
  });

function systemPrompt(checks: CheckName[], conversionLead: boolean, kind: LeadKind): string {
  return `You are Cuework's analyst agent. Cuework helps a small in-house marketing team decide what to work on. Cuework's rules flagged a lead from the team's data. Your job is to check whether it is a real, worthwhile issue before the team sees it, using a few data checks.

Available checks:
${checks.map((k) => `- ${k}: ${CHECKS[k]}`).join("\n")}
- decide: you know enough to give a verdict.

Each turn, reply with JSON: {"thought": "...", "action": "<check or decide>"}. The thought is under 20 words, saying what you will check and why. Don't summarise results in it.

Pick only checks that can change your verdict for this lead. Decide as soon as one check settles the question; run at most ${MAX_CHECKS}, and never repeat one.

${
    kind === "decline"
      ? "This lead claims something got worse. Common false alarms: a dip that also happened a year earlier (seasonality), and volumes too small to matter."
      : "This lead is about a standing gap or opportunity (for example a CTR below benchmark, a missing answer or page, or wasted spend), not a decline. A stable or rising trend does NOT make it a false alarm: the gap is the problem. Use checks to confirm the gap is real and current, and to sharpen the wording."
  }${conversionLead ? " For conversion leads, also watch for conversions collapsing while traffic holds: then the real issue is broken tracking." : " This lead is not about conversions, so judge it only on its own metric and channel."}`;
}

const decidePrompt = (kind: LeadKind) => `Now give your verdict as JSON.
- verdict "keep": the lead is real and worth doing. Rewrite title, rationale, expected_outcome, next_step and why_now in plain, specific language (title starts with a verb and names the page, query, campaign or keyword).
${kind === "decline" ? `- verdict "drop": it's a false alarm or not worth the team's time. Leave the text fields "".\n` : ""}- verdict "merge": it's the same issue as another listed lead; put its code in merge_with. Leave the text fields "".
- reason: say what your checks showed about THIS lead's own metric, in one or two sentences. Don't mention metrics the lead isn't about.
- Only use numbers that appear in the lead or in your check results. Never invent or calculate new figures.
- lower_confidence: true only if a check contradicts or weakens the lead${kind === "decline" ? " (for example the dip also happened last year)" : " (for example the gap is much smaller than the evidence says). A flat trend is not a reason"}. Otherwise false.`;

function leadMessage(lead: Lead, property: { name: string; goal: string; conversionLabel: string }, others: Lead[]) {
  return [
    `Property: ${property.name}${property.goal ? ` (goal: ${property.goal})` : ""}. Conversions are “${property.conversionLabel}”.`,
    `Lead ${lead.code} · ${CATEGORY_LABEL[lead.category]}: ${lead.text.title}`,
    `Lead type: ${lead.kind === "decline" ? "a decline (something got worse)" : "a standing gap or opportunity (not a decline)"}.`,
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
  const offered = checksFor(lead);
  const system = systemPrompt(offered, isConversionLead(lead), lead.kind);
  const DECIDE_PROMPT = decidePrompt(lead.kind);
  const first = leadMessage(lead, property, others);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: first },
  ];
  const checks: AgentCheck[] = [];
  let seen = first;

  for (let i = 0; i < MAX_CHECKS; i++) {
    const step = await chatJson(messages, stepSchema(offered), { ...opts, maxTokens: 200 });
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
  const reply = await chatJson(messages, decisionSchema(lead.kind), { ...opts, maxTokens: 900 });
  // The schema's verdict union depends on the lead kind; widen it so the checks below type-check.
  const d = { ...reply, verdict: reply.verdict as Verdict["verdict"] };

  const text: CardText = { title: d.title.trim(), rationale: d.rationale.trim(), expectedOutcome: d.expected_outcome.trim(), nextStep: d.next_step.trim(), whyNow: d.why_now.trim() };
  if (d.verdict === "keep") {
    const short = Object.entries(text).find(([, v]) => v.length < 8);
    if (short) throw new ModelError(`Kept the lead but left “${short[0]}” empty.`);
  }
  let mergeWith: string | null = null;
  if (d.verdict === "merge") {
    mergeWith = d.merge_with.trim().toUpperCase();
    if (!others.some((o) => o.code === mergeWith)) throw new ModelError(`Merged into unknown lead “${d.merge_with}”.`);
  }

  // A small model can't be trusted to call a problem "seasonal": only set a lead aside if the target
  // isn't also clearly worse than the same month last year. (In a live run it dropped a 43% YoY
  // conversion-rate decline as "seasonality".) Leads vetoed here keep their rules version.
  if (d.verdict === "drop") {
    const now = evaluateTarget(rows, property.id, lead.target, period);
    const then = evaluateTarget(rows, property.id, lead.target, lastYear(period));
    const yoy = pctChange(now, then);
    if (yoy != null && Math.abs(yoy) >= YOY_VETO && sentiment(lead.target.metric, yoy) === "bad") {
      throw new ModelError(`Tried to set aside a lead whose ${lead.target.label} is ${pct(now, then)} vs last year.`);
    }
  }

  // Guard against invented numbers: everything significant must come from the lead or a check result.
  // The agent's own instructions count as allowed too (e.g. the "13" in "13 months").
  const said = [d.reason, ...(d.verdict === "keep" ? Object.values(text) : [])].join(" ");
  // Rounded figures (706 → "about 700", 32,848 → "33k") pass; numbers with no close match don't.
  const invented = inventedNumbers(said, `${system}\n${DECIDE_PROMPT}\n${seen}`);
  if (invented.length) throw new ModelError(`Introduced numbers not in the data: ${invented.join(", ")}`);

  return {
    verdict: d.verdict,
    mergeWith,
    reason: d.reason.trim(),
    text: d.verdict === "keep" ? text : null,
    confidenceChange: d.lower_confidence ? -1 : 0,
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
        kind: leadKind(r.ruleKey),
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

        const confidence = v.confidenceChange < 0 ? clamp(Math.round((rec.confidence - 0.1) * 100) / 100, 0.1, 0.95) : rec.confidence;
        const mergedInto = v.mergeWith ? byCode.get(v.mergeWith) : undefined;
        const note = mergedInto ? `${v.reason} (Same issue as “${mergedInto.title}”.)` : v.reason;
        const scoreChanges: AgentScoreChange[] =
          confidence !== rec.confidence ? [{ score: "confidence", from: rec.confidence, to: confidence }] : [];
        await db
          .update(recommendations)
          .set({
            ...(v.text ? { ...v.text, aiWritten: true } : {}),
            confidence,
            priorityScore: scorePriority({ impact: rec.impact, urgency: rec.urgency, strategic: rec.strategic, confidence, effort: rec.effort }),
            agentVerdict: v.verdict,
            agentNote: note,
            agentChecks: v.checks,
            agentScoreChanges: scoreChanges,
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
