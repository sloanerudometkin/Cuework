import { addMonths, formatMonth, lastYear } from "../dates";
import {
  evaluateTarget,
  filterRows,
  formatPct,
  metricFromTotals,
  pctChange,
  sumRows,
  type Anomaly,
} from "../metrics";
import type { EvidenceDraft, PropertyLite, RecommendationDraft, Snapshot } from "../types";

export interface RuleContext {
  property: PropertyLite;
  /** All snapshot rows for this property. */
  rows: Snapshot[];
  /** Latest complete month in the data (YYYY-MM-01). */
  period: string;
  /** Anomalies already detected for this property/period (rules can down-weight around them). */
  anomalies: Anomaly[];
}

export type Rule = (ctx: RuleContext) => RecommendationDraft[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Approximate organic CTR by average position. A coarse industry-style
 * benchmark used only to spot *relative* underperformance; it is labelled as
 * an estimate wherever it is shown.
 */
const CTR_BY_POSITION = [0.28, 0.15, 0.1, 0.07, 0.055, 0.045, 0.038, 0.032, 0.027, 0.024];
export function expectedCtr(position: number): number {
  const i = Math.max(1, Math.round(position)) - 1;
  return CTR_BY_POSITION[Math.min(i, CTR_BY_POSITION.length - 1)];
}

/** Map a magnitude onto the 1–5 scale using ascending thresholds [t2, t3, t4, t5]. */
function scale(value: number, thresholds: [number, number, number, number]): number {
  let level = 1;
  thresholds.forEach((t, i) => {
    if (value >= t) level = i + 2;
  });
  return level;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

function hasAnomaly(ctx: RuleContext, metric: string): boolean {
  return ctx.anomalies.some((a) => a.target.metric === metric && a.direction === "down" && a.sentiment === "bad");
}

// ---------------------------------------------------------------------------
// 1. High impressions, low organic CTR
// ---------------------------------------------------------------------------
export const lowCtrHighImpressions: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const queries = filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "query" });
  const totalClicks = sumRows(filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "property" })).clicks;

  const candidates = queries
    .filter((q) => q.impressions >= 2500 && q.avgPosition != null && q.avgPosition <= 8)
    .map((q) => {
      const ctr = q.clicks / q.impressions;
      const expected = expectedCtr(q.avgPosition!);
      // Only claim the gap to 80% of benchmark — we are not promising the moon.
      const attainable = expected * 0.8;
      return { q, ctr, expected, missedClicks: Math.max(0, (attainable - ctr) * q.impressions) };
    })
    .filter((c) => c.ctr < c.expected * 0.6)
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, 2);

  return candidates.map(({ q, ctr, expected, missedClicks }): RecommendationDraft => {
    const prev = evaluateTarget(rows, property.id, { metric: "ctr", channel: "organic", dimension: "query", key: q.key, label: "" }, addMonths(period, -2));
    const persistent = prev != null && prev < expected * 0.65;
    const share = totalClicks > 0 ? missedClicks / totalClicks : 0;
    const page = q.secondaryKey ?? "the ranking page";
    return {
      ruleKey: "low_ctr_high_impressions",
      fingerprint: `low_ctr:${property.id}:${q.key}`,
      propertyId: property.id,
      category: "seo",
      title: `Rewrite the search snippet for “${q.key}” on ${page}`,
      rationale: `“${q.key}” is shown ${int(q.impressions)} times a month at position ${q.avgPosition!.toFixed(1)}, but only ${pct1(ctr)} of searchers click. Pages at that position typically earn around ${pct1(expected)}. The page is visible — the title and description aren't earning the click.`,
      expectedOutcome: `Recover roughly ${int(missedClicks * 0.6)}–${int(missedClicks)} organic clicks per month by lifting CTR toward ${pct1(expected * 0.8)}.`,
      nextStep: `Rewrite the title tag and meta description for ${page} to match the query's intent, lead with the user's task, and ship it as a tracked change so CTR can be compared before and after.`,
      whyNow: persistent
        ? `The gap has persisted for 3 months, so every month of delay forfeits ≈${int(missedClicks)} clicks.`
        : `Position is already strong — this is the cheapest way to convert existing visibility into visits.`,
      target: { metric: "ctr", channel: "organic", dimension: "query", key: q.key, label: `Organic CTR · “${q.key}”` },
      impact: scale(share, [0.008, 0.02, 0.04, 0.07]),
      effort: 2,
      urgency: persistent ? 4 : 3,
      confidence: persistent ? 0.82 : 0.72,
      estimatedHours: 4,
      suggestedOwnerRole: "coordinator",
      evidence: [
        { label: "Monthly impressions", value: int(q.impressions), comparison: formatMonth(period) },
        { label: "Average position", value: q.avgPosition!.toFixed(1) },
        { label: "Observed CTR", value: pct1(ctr), comparison: `benchmark ≈ ${pct1(expected)} at this position (estimate)` },
        { label: "Clicks left on the table", value: `≈${int(missedClicks)}/mo`, comparison: `${(share * 100).toFixed(1)}% of ${property.name}'s organic clicks` },
      ],
    };
  });
};

// ---------------------------------------------------------------------------
// 2. Paid keywords spending without converting
// ---------------------------------------------------------------------------
export const paidKeywordsNoConversions: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const from = addMonths(period, -2);
  const keywords = filterRows(rows, { propertyId: property.id, from, to: period, channel: "paid", dimension: "keyword" });
  const byKey = new Map<string, { campaign: string; cost: number; clicks: number; conversions: number }>();
  for (const r of keywords) {
    const k = r.key;
    const cur = byKey.get(k) ?? { campaign: r.secondaryKey ?? "Unassigned campaign", cost: 0, clicks: 0, conversions: 0 };
    cur.cost += r.cost;
    cur.clicks += r.clicks;
    cur.conversions += r.conversions;
    byKey.set(k, cur);
  }
  const wasted = [...byKey.entries()]
    .map(([keyword, v]) => ({ keyword, ...v }))
    .filter((k) => k.cost >= 250 && k.conversions === 0 && k.clicks >= 40)
    .sort((a, b) => b.cost - a.cost);
  if (!wasted.length) return [];

  const totalPaid = sumRows(filterRows(rows, { propertyId: property.id, from, to: period, channel: "paid", dimension: "property" })).cost;
  const waste = wasted.reduce((s, k) => s + k.cost, 0);
  const share = totalPaid > 0 ? waste / totalPaid : 0;
  const trackingSuspect = hasAnomaly(ctx, "conversions");
  const top = wasted.slice(0, 4);

  const evidence: EvidenceDraft[] = top.map((k) => ({
    label: `“${k.keyword}”`,
    value: `${money(k.cost)} · 0 conversions`,
    comparison: `${int(k.clicks)} clicks · ${k.campaign}`,
  }));
  evidence.push({ label: "Share of paid spend (90 days)", value: `${(share * 100).toFixed(1)}%`, comparison: `${money(waste)} of ${money(totalPaid)}` });

  return [
    {
      ruleKey: "paid_keywords_no_conversions",
      fingerprint: `paid_waste:${property.id}`,
      propertyId: property.id,
      category: "sem",
      title: `Pause or negate ${wasted.length} non-converting keyword${wasted.length > 1 ? "s" : ""} (${money(waste)} in 90 days)`,
      rationale: `${wasted.length} keyword${wasted.length > 1 ? "s have" : " has"} spent ${money(waste)} over the last three months with ${int(wasted.reduce((s, k) => s + k.clicks, 0))} clicks and zero conversions. That is ${(share * 100).toFixed(0)}% of paid spend buying traffic that isn't converting.${
        trackingSuspect ? " Caution: this property also shows a conversion-tracking anomaly, so confirm tracking before pausing." : ""
      }`,
      expectedOutcome: `Redirect about ${money(waste / 3)} per month to converting terms and reduce blended cost per conversion.`,
      nextStep: `Add the terms as negative keywords (or pause them), review the search-terms report for close variants, and move the budget to the campaign with the lowest cost per conversion.`,
      whyNow: `Spend recurs every month at roughly ${money(waste / 3)}; it is the fastest efficiency gain available.`,
      target: { metric: "cpa", channel: "paid", dimension: "property", key: "", label: "Paid cost per conversion" },
      impact: scale(share, [0.03, 0.07, 0.12, 0.2]),
      effort: 1,
      urgency: 4,
      confidence: trackingSuspect ? 0.6 : 0.86,
      estimatedHours: 2.5,
      suggestedOwnerRole: "manager",
      evidence,
    },
  ];
};

// ---------------------------------------------------------------------------
// 3. Landing pages with declining conversion
// ---------------------------------------------------------------------------
export const landingPageConversionDecline: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  // If site-wide conversions collapsed, this is a tracking issue, not a CRO one.
  if (hasAnomaly(ctx, "conversions") || hasAnomaly(ctx, "conversion_rate")) return [];

  const curFrom = addMonths(period, -2);
  const prevFrom = addMonths(period, -5);
  const prevTo = addMonths(period, -3);
  const pages = new Set(
    filterRows(rows, { propertyId: property.id, from: curFrom, to: period, channel: "organic", dimension: "page" }).map((r) => r.key),
  );

  const drafts: RecommendationDraft[] = [];
  for (const page of pages) {
    const cur = sumRows(filterRows(rows, { propertyId: property.id, from: curFrom, to: period, channel: "organic", dimension: "page", key: page }));
    const prev = sumRows(filterRows(rows, { propertyId: property.id, from: prevFrom, to: prevTo, channel: "organic", dimension: "page", key: page }));
    if (cur.sessions < 1500 || prev.sessions < 1500) continue;
    const curRate = cur.conversions / cur.sessions;
    const prevRate = prev.conversions / prev.sessions;
    const rel = pctChange(curRate, prevRate);
    if (rel == null || rel > -0.2 || prevRate - curRate < 0.004) continue;
    const lostPerMonth = ((prevRate - curRate) * cur.sessions) / 3;
    drafts.push({
      ruleKey: "landing_page_conversion_decline",
      fingerprint: `lp_decline:${property.id}:${page}`,
      propertyId: property.id,
      category: "analytics",
      title: `Diagnose the conversion decline on ${page} (${formatPct(rel)})`,
      rationale: `${page} still receives about ${int(cur.sessions / 3)} sessions a month, but its conversion rate fell from ${pct1(prevRate)} to ${pct1(curRate)} over the last three months versus the three before. Traffic quality, page changes, and form/checkout friction are all candidates — session recordings and funnel steps will separate them.`,
      expectedOutcome: `Recover up to ≈${int(lostPerMonth)} conversions per month if the drop is fixable on the page.`,
      nextStep: `Compare the funnel before/after the decline, review recent releases touching ${page}, then test one change (form length, CTA clarity, page speed) with a clear success metric.`,
      whyNow: `${int(lostPerMonth)} conversions a month are being lost on one of the property's most visited pages, and the trend hasn't reversed.`,
      target: { metric: "conversion_rate", channel: "organic", dimension: "page", key: page, label: `Conversion rate · ${page}` },
      impact: scale(lostPerMonth, [15, 40, 90, 180]),
      effort: 3,
      urgency: 4,
      confidence: 0.66,
      estimatedHours: 8,
      suggestedOwnerRole: "manager",
      evidence: [
        { label: "Conversion rate, last 3 months", value: pct1(curRate), comparison: `was ${pct1(prevRate)} in the prior 3 months` },
        { label: "Relative change", value: formatPct(rel) },
        { label: "Sessions per month", value: int(cur.sessions / 3) },
        { label: "Estimated conversions lost", value: `≈${int(lostPerMonth)}/mo` },
      ],
    });
  }
  return drafts.sort((a, b) => b.impact - a.impact).slice(0, 1);
};

// ---------------------------------------------------------------------------
// 4. Significant year-over-year organic traffic decline
// ---------------------------------------------------------------------------
export const yoyTrafficDecline: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const target = { metric: "sessions", channel: "organic", dimension: "property", key: "", label: "Organic sessions" } as const;
  const cur = evaluateTarget(rows, property.id, target, period);
  const ly = evaluateTarget(rows, property.id, target, lastYear(period));
  const yoy = pctChange(cur, ly);
  if (yoy == null || yoy > -0.1) return [];

  // Sustained? Compare trailing three months to the same three a year earlier.
  const t3 = sumRows(filterRows(rows, { propertyId: property.id, from: addMonths(period, -2), to: period, channel: "organic", dimension: "property" })).sessions;
  const l3 = sumRows(filterRows(rows, { propertyId: property.id, from: addMonths(lastYear(period), -2), to: lastYear(period), channel: "organic", dimension: "property" })).sessions;
  const yoy3 = pctChange(t3, l3);
  if (yoy3 == null || yoy3 > -0.08) return [];

  // Which pages lost the most?
  const pageKeys = new Set(filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "page" }).map((r) => r.key));
  const losers = [...pageKeys]
    .map((page) => {
      const c = evaluateTarget(rows, property.id, { ...target, dimension: "page", key: page }, period) ?? 0;
      const l = evaluateTarget(rows, property.id, { ...target, dimension: "page", key: page }, lastYear(period)) ?? 0;
      return { page, c, l, loss: l - c };
    })
    .filter((p) => p.loss > 0)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 3);

  const lost = (ly ?? 0) - (cur ?? 0);
  const evidence: EvidenceDraft[] = [
    { label: `Organic sessions, ${formatMonth(period)}`, value: int(cur ?? 0), comparison: `${int(ly ?? 0)} a year earlier (${formatPct(yoy)})` },
    { label: "Trailing 3 months vs. same 3 months last year", value: formatPct(yoy3), comparison: `${int(t3)} vs ${int(l3)} sessions` },
    ...losers.map((p) => ({ label: `Largest page decline · ${p.page}`, value: `−${int(p.loss)} sessions`, comparison: `${int(p.c)} vs ${int(p.l)} last year` })),
  ];

  return [
    {
      ruleKey: "yoy_traffic_decline",
      fingerprint: `yoy_decline:${property.id}`,
      propertyId: property.id,
      category: "seo",
      title: `Run a traffic-loss diagnostic: organic sessions are ${formatPct(yoy)} year over year`,
      rationale: `Organic traffic to ${property.name} is ${int(lost)} sessions a month below last year and the decline is sustained across the last three months, not a one-month dip. ${
        losers[0] ? `${losers[0].page} accounts for the largest share of the loss.` : ""
      } Sustained declines like this usually trace to lost rankings on a few page groups, redirect/URL changes, or content that was consolidated or removed.`,
      expectedOutcome: `Identify the 2–3 causes behind the decline and recover a first tranche of ≈${int(lost * 0.25)} monthly sessions.`,
      nextStep: `Compare Search Console clicks by page and query against the same period last year, check redirects and indexation for the top losing pages, and produce a ranked fix list.`,
      whyNow: `Every month at the current run-rate forfeits ≈${int(lost)} sessions, and the loss is concentrated enough to be fixable.`,
      target,
      impact: scale(Math.abs(yoy), [0.1, 0.15, 0.22, 0.3]),
      effort: 4,
      urgency: 4,
      confidence: 0.7,
      estimatedHours: 10,
      suggestedOwnerRole: "manager",
      evidence,
    },
  ];
};

// ---------------------------------------------------------------------------
// 5. Strong queries without matching content
// ---------------------------------------------------------------------------
export const queryContentGap: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const gaps = filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "query" })
    .filter((q) => q.secondaryKey == null && q.impressions >= 1200 && q.attrs.intent !== "question")
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3);
  if (!gaps.length) return [];

  const impressions = gaps.reduce((s, g) => s + g.impressions, 0);
  const totalImpressions = sumRows(filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "property" })).impressions;
  const share = totalImpressions > 0 ? impressions / totalImpressions : 0;
  const potential = impressions * 0.04;
  const first = gaps[0];

  return [
    {
      ruleKey: "query_content_gap",
      fingerprint: `content_gap:${property.id}`,
      propertyId: property.id,
      category: "content",
      title: `Publish dedicated content for ${gaps.length} high-demand queries with no matching page`,
      rationale: `People search for these topics ${int(impressions)} times a month and Google is showing us anyway, but there is no page built to answer them — impressions land on loosely related pages that rarely earn the click. Purpose-built pages usually turn this demand into traffic.`,
      expectedOutcome: `Capture ≈${int(potential * 0.5)}–${int(potential)} additional organic clicks a month once the pages rank.`,
      nextStep: `Brief and publish one page per query, starting with “${first.key}”; align each to the intent behind the search and link from the closest existing hub page.`,
      whyNow: `Demand is already proven at ${int(first.impressions)} impressions a month for the top query alone; content takes weeks to rank, so start early.`,
      target: { metric: "clicks", channel: "organic", dimension: "query", key: first.key, label: `Organic clicks · “${first.key}”` },
      impact: scale(share, [0.004, 0.01, 0.02, 0.04]),
      effort: 4,
      urgency: 2,
      confidence: 0.6,
      estimatedHours: 12,
      suggestedOwnerRole: "coordinator",
      evidence: gaps.map((g) => ({
        label: `“${g.key}”`,
        value: `${int(g.impressions)} impressions/mo`,
        comparison: `avg. position ${g.avgPosition?.toFixed(1) ?? "n/a"} · no dedicated page`,
      })),
    },
  ];
};

// ---------------------------------------------------------------------------
// 6. Answer-engine (AEO) content gaps
// ---------------------------------------------------------------------------
export const aeoAnswerGap: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const questions = filterRows(rows, { propertyId: property.id, period, channel: "organic", dimension: "query" })
    .filter((q) => q.attrs.intent === "question" && q.attrs.answerReady === false && q.impressions >= 700)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4);
  if (questions.length < 2) return [];

  const impressions = questions.reduce((s, q) => s + q.impressions, 0);
  return [
    {
      ruleKey: "aeo_answer_gap",
      fingerprint: `aeo_gap:${property.id}`,
      propertyId: property.id,
      category: "aeo",
      title: `Add direct, structured answers for ${questions.length} question-style searches`,
      rationale: `${questions.length} question searches generate ${int(impressions)} impressions a month, but the pages that rank don't give a concise, quotable answer or FAQ markup. Answer engines and AI summaries favour pages that state the answer plainly and mark it up. Note: answer-engine visibility isn't directly measurable in Search Console, so this estimate is based on question demand, not AI citations.`,
      expectedOutcome: `Become the cited source for these questions and lift clicks on the rankings that already exist; track question-query impressions and clicks as the proxy.`,
      nextStep: `For each question, add a 40–60 word direct answer near the top of the best page, add FAQ/HowTo structured data where appropriate, and link to the detailed process below it.`,
      whyNow: `Low effort, and question queries are where answer engines are replacing clicks — being the source now compounds.`,
      target: { metric: "impressions", channel: "organic", dimension: "query", key: questions[0].key, label: `Impressions · “${questions[0].key}”` },
      impact: 3,
      effort: 2,
      urgency: 3,
      confidence: 0.58,
      estimatedHours: 5,
      suggestedOwnerRole: "coordinator",
      evidence: questions.map((q) => ({
        label: `“${q.key}”`,
        value: `${int(q.impressions)} impressions/mo`,
        comparison: `position ${q.avgPosition?.toFixed(1) ?? "n/a"} · no direct-answer block or FAQ markup`,
      })),
    },
  ];
};

// ---------------------------------------------------------------------------
// 7. Campaign budget imbalance
// ---------------------------------------------------------------------------
export const campaignBudgetImbalance: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const from = addMonths(period, -2);
  const campaignRows = filterRows(rows, { propertyId: property.id, from, to: period, channel: "paid", dimension: "campaign" });
  const names = [...new Set(campaignRows.map((r) => r.key))];
  const stats = names
    .map((name) => {
      const rs = campaignRows.filter((r) => r.key === name);
      const t = sumRows(rs);
      const latest = rs.find((r) => r.periodStart === period);
      return {
        name,
        cost: t.cost,
        conversions: t.conversions,
        cpa: metricFromTotals("cpa", t),
        budgetLimited: latest?.attrs.budgetLimited === true,
      };
    })
    .filter((c) => c.cpa != null && c.conversions >= 15);
  if (stats.length < 2) return [];

  const totalCost = stats.reduce((s, c) => s + c.cost, 0);
  const best = [...stats].filter((c) => c.budgetLimited).sort((a, b) => a.cpa! - b.cpa!)[0];
  const worst = [...stats].sort((a, b) => b.cpa! - a.cpa!)[0];
  if (!best || !worst || best.name === worst.name) return [];
  if (worst.cpa! < best.cpa! * 1.8 || worst.cost / totalCost < 0.25) return [];

  const shift = (worst.cost / 3) * 0.2; // move 20% of the weakest campaign's monthly spend
  const gained = shift / best.cpa! - shift / worst.cpa!;
  const evidence: EvidenceDraft[] = [
    { label: `${best.name}`, value: `${money(best.cpa!)} per conversion`, comparison: `Limited by budget — ${money(best.cost / 3)}/mo spent` },
    { label: `${worst.name}`, value: `${money(worst.cpa!)} per conversion`, comparison: `${((worst.cost / totalCost) * 100).toFixed(0)}% of paid spend (${money(worst.cost / 3)}/mo)` },
    { label: "CPA gap", value: `${(worst.cpa! / best.cpa!).toFixed(1)}×` },
    { label: "Modelled shift", value: `${money(shift)}/mo`, comparison: `≈ +${int(gained)} conversions/mo at equal spend (assumes some diminishing returns)` },
  ];

  return [
    {
      ruleKey: "campaign_budget_imbalance",
      fingerprint: `budget_imbalance:${property.id}`,
      propertyId: property.id,
      category: "sem",
      title: `Shift ≈${money(shift)}/mo from “${worst.name}” to budget-limited “${best.name}”`,
      rationale: `“${best.name}” converts at ${money(best.cpa!)} but is capped by budget, while “${worst.name}” takes ${((worst.cost / totalCost) * 100).toFixed(0)}% of spend at ${money(worst.cpa!)} per conversion — ${(worst.cpa! / best.cpa!).toFixed(1)}× as expensive. The team has one budget; it is currently funding the weaker campaign first.`,
      expectedOutcome: `About ${int(gained)} more conversions a month at the same total spend, and a lower blended cost per conversion.`,
      nextStep: `Move 20% of the weaker campaign's budget to the capped campaign, watch impression share and CPA for two weeks, and scale further only if CPA holds.`,
      whyNow: `The imbalance repeats with every day of spend; budget changes take effect immediately.`,
      target: { metric: "cpa", channel: "paid", dimension: "property", key: "", label: "Paid cost per conversion" },
      impact: scale(gained, [8, 20, 45, 90]),
      effort: 2,
      urgency: 4,
      confidence: 0.7,
      estimatedHours: 3,
      suggestedOwnerRole: "manager",
      evidence,
    },
  ];
};

// ---------------------------------------------------------------------------
// 8. Conversion-tracking anomaly
// ---------------------------------------------------------------------------
export const conversionTrackingAnomaly: Rule = (ctx) => {
  const { property, rows, period } = ctx;
  const conv = { metric: "conversions", channel: "all", dimension: "property", key: "", label: "Total conversions" } as const;
  const sess = { metric: "sessions", channel: "all", dimension: "property", key: "", label: "Total sessions" } as const;
  const cur = evaluateTarget(rows, property.id, conv, period);
  const curSessions = evaluateTarget(rows, property.id, sess, period);
  if (cur == null || curSessions == null) return [];

  const baseConv: number[] = [];
  const baseSess: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const c = evaluateTarget(rows, property.id, conv, addMonths(period, -i));
    const s = evaluateTarget(rows, property.id, sess, addMonths(period, -i));
    if (c != null) baseConv.push(c);
    if (s != null) baseSess.push(s);
  }
  if (baseConv.length < 3 || baseSess.length < 3) return [];
  const avgConv = baseConv.reduce((a, b) => a + b, 0) / baseConv.length;
  const avgSess = baseSess.reduce((a, b) => a + b, 0) / baseSess.length;
  const convChange = pctChange(cur, avgConv);
  const sessChange = pctChange(curSessions, avgSess);
  // Conversions collapsed while traffic held steady => measurement, not demand.
  if (convChange == null || sessChange == null || convChange > -0.5 || Math.abs(sessChange) > 0.15) return [];

  const lostConv = avgConv - cur;
  return [
    {
      ruleKey: "conversion_tracking_anomaly",
      fingerprint: `tracking_anomaly:${property.id}`,
      propertyId: property.id,
      category: "analytics",
      title: `Investigate a ${Math.abs(Math.round(convChange * 100))}% conversion drop with steady traffic — likely a tracking break`,
      rationale: `Recorded conversions fell to ${int(cur)} in ${formatMonth(period)} from a 3-month average of ${int(avgConv)}, while sessions moved only ${formatPct(sessChange)}. Real demand rarely falls by more than half while traffic holds, so this looks like a broken tag, changed form, or consent/config issue. Until it's fixed, reports understate results and automated bidding is optimising on bad data.`,
      expectedOutcome: `Restore accurate conversion counts (≈${int(lostConv)} conversions/month are currently unrecorded) and stop distortions in paid bidding and reporting.`,
      nextStep: `Check the conversion tag in Tag Manager and recent site releases, test the conversion path end-to-end with a real submission, then annotate the gap in analytics so historical comparisons stay honest.`,
      whyNow: `Every day of missing data corrupts month-over-month reporting and any smart-bidding campaign learning from it.`,
      target: conv,
      impact: 5,
      effort: 2,
      urgency: 5,
      confidence: 0.8,
      estimatedHours: 4,
      suggestedOwnerRole: "manager",
      evidence: [
        { label: `Conversions, ${formatMonth(period)}`, value: int(cur), comparison: `3-month average ${int(avgConv)} (${formatPct(convChange)})` },
        { label: "Sessions over the same window", value: formatPct(sessChange), comparison: "traffic is steady, so demand did not drop" },
        { label: "Unrecorded conversions (est.)", value: `≈${int(lostConv)}/mo` },
      ],
    },
  ];
};

export const ALL_RULES: Rule[] = [
  conversionTrackingAnomaly,
  yoyTrafficDecline,
  lowCtrHighImpressions,
  paidKeywordsNoConversions,
  landingPageConversionDecline,
  queryContentGap,
  aeoAnswerGap,
  campaignBudgetImbalance,
];
