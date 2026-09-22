import { addMonths, formatDay, formatMonth, lastYear } from "./dates";
import {
  comparePeriods,
  formatMetricValue,
  formatPct,
  sentiment,
  type Anomaly,
  type Sentiment,
} from "./metrics";
import { EVIDENCE_LABEL, VERDICT_LABEL, type EvidenceStrength, type Verdict } from "./outcomes";
import type { MetricId, MetricTarget, Snapshot } from "./types";

export interface KpiLine {
  label: string;
  metric: MetricId;
  value: string;
  mom: string;
  yoy: string;
  yoyRaw: number | null;
  momSentiment: Sentiment;
  yoySentiment: Sentiment;
}

export interface PropertyBrief {
  propertyId: string;
  name: string;
  kpis: KpiLine[];
  /** One sentence in plain English. */
  takeaway: string;
}

export interface CompletedBrief {
  title: string;
  property: string;
  hours: number;
  completedOn: string;
  /** False for routine work with no metric attached, which can never be "awaiting data". */
  hasMetric: boolean;
  outcome: null | {
    metric: string;
    baseline: string;
    current: string;
    change: string;
    verdict: Verdict;
    evidence: EvidenceStrength;
  };
}

export interface DecisionBrief {
  title: string;
  property: string;
  decision: string;
  rationale: string;
  by: string;
  on: string;
}

export interface BlockedBrief {
  title: string;
  property: string;
  reason: string;
  owner: string;
  needsLeadership: boolean;
}

export interface NextWeekBrief {
  week: string;
  committedHours: number;
  plannableHours: number;
  status: "committed" | "draft" | "none";
  items: { title: string; property: string; owner: string; hours: number }[];
}

export interface LeadershipAsk {
  title: string;
  property: string;
  detail: string;
}

export interface BriefContent {
  orgName: string;
  period: string;
  performanceWindow: string;
  activityWindow: string;
  headline: string;
  summary: string[];
  properties: PropertyBrief[];
  wins: string[];
  declines: string[];
  /** Metrics far outside their own recent range — reported separately from year-over-year moves. */
  anomalies: string[];
  completed: CompletedBrief[];
  decisions: DecisionBrief[];
  blocked: BlockedBrief[];
  nextWeek: NextWeekBrief;
  leadershipAsks: LeadershipAsk[];
  caveats: string[];
  sources: string[];
}

export interface BriefInput {
  orgName: string;
  period: string;
  snapshots: Snapshot[];
  properties: { id: string; name: string; conversionLabel: string }[];
  anomalies: (Anomaly & { propertyName: string })[];
  activityFrom: string;
  activityTo: string;
  completed: CompletedBrief[];
  decisions: DecisionBrief[];
  blocked: BlockedBrief[];
  nextWeek: NextWeekBrief;
  openDecisionCount: number;
  sources: string[];
}

/** A year-over-year move smaller than this is noise, not a win or a decline. */
const MATERIAL_MOVE = 0.05;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const KPI_TARGETS: { label: string; target: Omit<MetricTarget, "label"> }[] = [
  { label: "Organic sessions", target: { metric: "sessions", channel: "organic", dimension: "property", key: "" } },
  { label: "Conversions", target: { metric: "conversions", channel: "all", dimension: "property", key: "" } },
  { label: "Paid cost per conversion", target: { metric: "cpa", channel: "paid", dimension: "property", key: "" } },
];

function kpiLines(rows: Snapshot[], propertyId: string, period: string): KpiLine[] {
  const lines: KpiLine[] = [];
  for (const k of KPI_TARGETS) {
    const cmp = comparePeriods(rows, propertyId, { ...k.target, label: k.label }, period);
    if (cmp.current == null) continue;
    lines.push({
      label: k.label,
      metric: k.target.metric,
      value: formatMetricValue(k.target.metric, cmp.current),
      mom: formatPct(cmp.mom),
      yoy: formatPct(cmp.yoy),
      yoyRaw: cmp.yoy,
      momSentiment: sentiment(k.target.metric, cmp.mom),
      yoySentiment: sentiment(k.target.metric, cmp.yoy),
    });
  }
  return lines;
}

function takeaway(name: string, lines: KpiLine[]): string {
  if (!lines.length) return `${name} has no data for this month yet.`;
  const bad = lines.filter((l) => l.yoySentiment === "bad" || l.momSentiment === "bad");
  const good = lines.filter((l) => l.yoySentiment === "good" || l.momSentiment === "good");
  if (bad.length && (!good.length || bad.some((l) => l.yoySentiment === "bad"))) {
    const l = bad.find((x) => x.yoySentiment === "bad") ?? bad[0];
    return `Pressure point at ${name}: ${l.label} ${l.mom} month over month, ${l.yoy} year over year.`;
  }
  if (good.length) {
    const l = good[0];
    return `Bright spot at ${name}: ${l.label} ${l.mom} month over month, ${l.yoy} year over year.`;
  }
  return `${name} is steady month over month.`;
}

/** Composes the brief from already-loaded data. Pure and deterministic; every claim traces to an input. */
export function buildBrief(input: BriefInput): BriefContent {
  const { period, snapshots } = input;
  const monthName = formatMonth(period);

  const properties: PropertyBrief[] = input.properties.map((p) => {
    const kpis = kpiLines(snapshots, p.id, period);
    return { propertyId: p.id, name: p.name, kpis, takeaway: takeaway(p.name, kpis) };
  });

  const wins: string[] = [];
  const declines: string[] = [];
  const anomalies: string[] = [];
  for (const p of properties) {
    for (const k of p.kpis) {
      // Only material year-over-year moves are reported as wins or declines.
      if (k.yoyRaw == null || Math.abs(k.yoyRaw) < MATERIAL_MOVE) continue;
      if (k.yoySentiment === "good") wins.push(`${p.name}: ${k.label} ${k.yoy} year over year (${k.value} in ${monthName}).`);
      if (k.yoySentiment === "bad") declines.push(`${p.name}: ${k.label} ${k.yoy} year over year (${k.value} in ${monthName}).`);
    }
  }
  for (const a of input.anomalies) {
    if (a.sentiment === "bad") {
      anomalies.push(
        `${a.propertyName}: ${a.target.label} was ${formatMetricValue(a.target.metric, a.current)} against a recent norm of ${formatMetricValue(a.target.metric, a.expected)} (${formatPct(a.deviation)}).`,
      );
    }
  }

  const measuredWins = input.completed.filter((c) => c.outcome?.verdict === "improved").length;
  const measuredOther = input.completed.filter((c) => c.outcome && (c.outcome.verdict === "declined" || c.outcome.verdict === "flat")).length;
  const pending = input.completed.filter((c) => c.hasMetric && (!c.outcome || c.outcome.verdict === "pending")).length;
  const routine = input.completed.filter((c) => !c.hasMetric).length;

  const leadershipAsks: LeadershipAsk[] = input.blocked
    .filter((b) => b.needsLeadership)
    .map((b) => ({ title: `Unblock: ${b.title}`, property: b.property, detail: b.reason }));
  for (const a of input.anomalies.filter((x) => x.severity === "high" && x.sentiment === "bad")) {
    if (!leadershipAsks.some((l) => l.property === a.propertyName)) {
      leadershipAsks.push({
        title: `Attention: ${a.target.label} at ${a.propertyName}`,
        property: a.propertyName,
        detail: `${formatPct(a.deviation)} versus its recent range in ${monthName}. The team is investigating; sponsor support may be needed if a fix depends on other teams.`,
      });
    }
  }

  const totalCompletedHours = Math.round(input.completed.reduce((s, c) => s + c.hours, 0) * 10) / 10;
  const n = input.properties.length;
  const summary: string[] = [];
  summary.push(
    `${monthName}: ${plural(wins.length, "year-over-year improvement")}, ${plural(declines.length, "year-over-year decline")} and ${plural(anomalies.length, "anomaly", "anomalies")} across ${plural(n, "property", "properties")}.`,
  );
  if (input.completed.length) {
    const parts = [
      measuredWins ? `${measuredWins} with a measured improvement` : null,
      measuredOther ? `${measuredOther} with no clear change or a decline` : null,
      pending ? `${pending} awaiting enough data to measure` : null,
      routine ? `${routine} routine (no metric attached)` : null,
    ].filter(Boolean);
    summary.push(`The team completed ${plural(input.completed.length, "item")} (${totalCompletedHours}h): ${parts.join(", ")}.`);
  } else {
    summary.push("No work was completed in the reporting window.");
  }
  summary.push(
    leadershipAsks.length
      ? `${plural(leadershipAsks.length, "item")} ${leadershipAsks.length === 1 ? "needs" : "need"} leadership attention (below).`
      : "Nothing currently requires leadership intervention.",
  );

  const lead = leadershipAsks[0];
  const headline = lead
    ? `${monthName}: ${lead.property} needs leadership attention`
    : declines.length > wins.length
      ? `${monthName}: more declines than improvements — recovery work is under way`
      : `${monthName}: performance is ${wins.length ? "improving" : "steady"} and the plan is on track`;

  const caveats = [
    "Outcomes marked “Correlated” moved after the work shipped but are not proven to be caused by it; only controlled tests are labelled “Proven”.",
    "Year-over-year comparisons use the same calendar month one year earlier; seasonality is not otherwise adjusted.",
  ];

  return {
    orgName: input.orgName,
    period,
    performanceWindow: `${monthName} vs. ${formatMonth(addMonths(period, -1))} and ${formatMonth(lastYear(period))}`,
    activityWindow: `${formatDay(input.activityFrom)} – ${formatDay(input.activityTo, { year: true })}`,
    headline,
    summary,
    properties,
    wins,
    declines,
    anomalies,
    completed: input.completed,
    decisions: input.decisions,
    blocked: input.blocked,
    nextWeek: input.nextWeek,
    leadershipAsks,
    caveats,
    sources: input.sources,
  };
}

/** Markdown suitable for pasting into email, Notion, or a slide's notes. */
export function briefToMarkdown(b: BriefContent, note = ""): string {
  const out: string[] = [];
  out.push(`# ${b.orgName} — Leadership brief`);
  out.push(`**${b.headline}**`);
  out.push(`_Performance: ${b.performanceWindow} · Activity: ${b.activityWindow}_`);
  if (note.trim()) out.push(`> ${note.trim().replace(/\n/g, "\n> ")}`);
  out.push("## Summary");
  out.push(b.summary.map((s) => `- ${s}`).join("\n"));

  out.push("## What changed");
  for (const p of b.properties) {
    out.push(`**${p.name}** — ${p.takeaway}`);
    out.push(b.properties.length ? p.kpis.map((k) => `- ${k.label}: ${k.value} (MoM ${k.mom}, YoY ${k.yoy})`).join("\n") : "");
  }
  if (b.declines.length) out.push("**Declines (year over year)**\n" + b.declines.map((d) => `- ${d}`).join("\n"));
  if ((b.anomalies ?? []).length) out.push("**Anomalies**\n" + (b.anomalies ?? []).map((d) => `- ${d}`).join("\n"));
  if (b.wins.length) out.push("**Improvements (year over year)**\n" + b.wins.map((d) => `- ${d}`).join("\n"));

  out.push("## What the team completed");
  out.push(
    b.completed.length
      ? b.completed
          .map((c) => {
            const o = c.outcome;
            const tail =
              o && o.verdict !== "pending"
                ? ` → ${o.metric}: ${o.baseline} to ${o.current} (${o.change}), ${VERDICT_LABEL[o.verdict].toLowerCase()} · ${EVIDENCE_LABEL[o.evidence].short}`
                : c.hasMetric
                  ? " → outcome awaiting data"
                  : "";
            return `- ${c.title} (${c.property}, ${c.hours}h)${tail}`;
          })
          .join("\n")
      : "- Nothing completed in this window.",
  );

  out.push("## Decisions made");
  out.push(
    b.decisions.length
      ? b.decisions.map((d) => `- ${d.decision}: ${d.title} (${d.property})${d.rationale ? ` — “${d.rationale}”` : ""}`).join("\n")
      : "- No decisions recorded in this window.",
  );

  out.push("## Blocked");
  out.push(b.blocked.length ? b.blocked.map((x) => `- ${x.title} (${x.property}) — ${x.reason}`).join("\n") : "- Nothing is blocked.");

  out.push("## Where leadership attention is needed");
  out.push(b.leadershipAsks.length ? b.leadershipAsks.map((x) => `- **${x.title}** (${x.property}) — ${x.detail}`).join("\n") : "- Nothing this period.");

  out.push(`## What happens next (${b.nextWeek.week})`);
  out.push(
    b.nextWeek.items.length
      ? `Committed ${b.nextWeek.committedHours}h of ${b.nextWeek.plannableHours}h available capacity${b.nextWeek.status === "draft" ? " (draft — not yet committed)" : ""}.\n` +
          b.nextWeek.items.map((i) => `- ${i.title} (${i.property}, ${i.owner}, ${i.hours}h)`).join("\n")
      : "- No plan committed yet.",
  );

  out.push("## How to read this");
  out.push(b.caveats.map((c) => `- ${c}`).join("\n") + `\n- Data: ${b.sources.join("; ")}.`);
  return out.filter(Boolean).join("\n\n");
}

