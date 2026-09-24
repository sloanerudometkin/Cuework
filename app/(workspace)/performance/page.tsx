import { ChartLine, Lock, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EvidenceBadge, SourceBadge, VerdictBadge } from "@/components/domain/badges";
import { ComparisonChart } from "@/components/domain/line-chart";
import { Delta } from "@/components/domain/delta";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { RemeasureButton } from "@/components/remeasure";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { formatDay, formatMonth, toISODate } from "@/lib/domain/dates";
import { hasFeature } from "@/lib/domain/entitlements";
import { formatMetricValue, formatPct } from "@/lib/domain/metrics";
import { EVIDENCE_LABEL } from "@/lib/domain/outcomes";
import { getPerformance, KPI_BLOCKS } from "@/lib/services/performance";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance" };

/** A year-over-year move smaller than this is noise, not a win or a decline. */
const MATERIAL = 0.05;

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const { db, orgId } = await requireWorkspace();
  const data = await getPerformance(db, orgId);
  const tracking = hasFeature(data.ws.planKey, "outcomeTracking");

  if (!data.properties.length) {
    return (
      <>
        <PageHeader title="Performance" description="Month-over-month and year-over-year movement, tied to the work that could have moved it." />
        <EmptyState icon={ChartLine} title="No performance data yet" action={<Link href="/import" className={buttonStyles({})}>Import a CSV</Link>}>
          Import site totals, search queries or paid data and Cuework will chart every property against last month and last year.
        </EmptyState>
      </>
    );
  }

  const current = data.properties.find((p) => p.property.id === sp.p) ?? data.properties[0];
  const short = (n: string) => n.replace("Harborline ", "");

  const wins: string[] = [];
  const declines: string[] = [];
  const anomalies: { text: string; bad: boolean }[] = [];
  for (const p of data.properties) {
    for (const k of p.kpis) {
      // Only material moves count, and spend is a budget decision rather than a win or a loss.
      if (k.id === "paid_cost" || k.yoy == null || Math.abs(k.yoy) < MATERIAL) continue;
      if (k.yoySentiment === "good") wins.push(`${short(p.property.name)}: ${k.label} ${formatPct(k.yoy)} YoY`);
      if (k.yoySentiment === "bad") declines.push(`${short(p.property.name)}: ${k.label} ${formatPct(k.yoy)} YoY`);
    }
    for (const a of p.anomalies) anomalies.push({ bad: a.sentiment === "bad", text: `${short(p.property.name)}: ${a.target.label} ${formatPct(a.deviation)} vs. its normal range` });
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Performance & outcomes"
        title="What changed, and did our work matter?"
        description="Month-over-month and year-over-year movement for every property, next to the work that could have moved it — with correlation clearly separated from proof."
      />

      <section aria-label="Summary of changes" className="mb-8 grid gap-4 md:grid-cols-3">
        {[
          { title: "Wins", tone: "good" as const, list: wins.map((t) => ({ text: t, bad: false })), empty: "No year-over-year improvements this month." },
          { title: "Declines", tone: "bad" as const, list: declines.map((t) => ({ text: t, bad: true })), empty: "Nothing declined year over year." },
          { title: "Anomalies", tone: "cue" as const, list: anomalies, empty: "No metric is outside its normal range." },
        ].map((c) => (
          <Card key={c.title}>
            <CardHeader className="items-center">
              <CardTitle>{c.title}</CardTitle>
              <Badge tone={c.tone}>{c.list.length}</Badge>
            </CardHeader>
            <CardBody className="pt-3">
              {c.list.length ? (
                <ul className="space-y-2">
                  {c.list.slice(0, 5).map((l, i) => (
                    <li key={i} className="flex gap-2 text-[14.56px] leading-snug">
                      {c.title === "Anomalies" ? <TriangleAlert className={cn("mt-0.5 size-3.5 shrink-0", l.bad ? "text-brick" : "text-slate")} aria-hidden /> : <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", c.tone === "good" ? "bg-moss" : "bg-brick")} aria-hidden />}
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{c.empty}</p>
              )}
            </CardBody>
          </Card>
        ))}
      </section>

      <nav aria-label="Property" className="thin-scroll -mx-4 mb-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {data.properties.map((p) => (
          <Link
            key={p.property.id}
            href={`/performance?p=${p.property.id}`}
            aria-current={p.property.id === current.property.id ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors", p.property.id === current.property.id ? "bg-ink text-white" : "text-soft hover:bg-sunken hover:text-ink")}
          >
            {p.property.name}
          </Link>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg">{current.property.name}</h2>
        <SourceBadge status={current.sourceStatus} />
        <span className="text-sm text-muted">{formatMonth(current.period)} · compared with the prior month and the same month last year</span>
      </div>

      {current.anomalies.length ? (
        <div className="mb-5 space-y-2">
          {current.anomalies.map((a) => (
            <div key={a.target.label} role="note" className={cn("flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm", a.sentiment === "bad" ? "border-brick/30 bg-brick-soft" : "border-slate/30 bg-slate-soft")}>
              <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", a.sentiment === "bad" ? "text-brick" : "text-slate")} aria-hidden />
              <p>
                <strong className="font-semibold">{a.target.label}</strong> is {formatMetricValue(a.target.metric, a.current)} — {formatPct(a.deviation)} against a normal of about {formatMetricValue(a.target.metric, a.expected)} (seasonally adjusted).
                {a.severity === "high" ? " Check for a measurement problem before acting on this." : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        {current.kpis.map((k) => {
          const def = KPI_BLOCKS.find((b) => b.id === k.id)!;
          const related = current.relatedOutcomes[k.id] ?? [];
          return (
            <Card key={k.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Eyebrow>{k.label}</Eyebrow>
                    <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{formatMetricValue(k.metric, k.current)}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <div><Delta value={k.mom} sentiment={k.momSentiment} label="vs. last month" /></div>
                    <div><Delta value={k.yoy} sentiment={k.yoySentiment} label="vs. last year" /></div>
                  </div>
                </div>
                <div className="mt-4">
                  <ComparisonChart metric={k.metric} current={k.series} previous={k.previousYearSeries.slice(-k.series.length)} name={`${current.property.name} ${k.label}`} />
                </div>
                <div className="mt-4 border-t border-line pt-4">
                  <p className="mb-2 text-[12.32px] font-semibold uppercase tracking-[0.08em] text-muted">Completed work that targeted this ({def.label.toLowerCase()})</p>
                  {!tracking ? (
                    <p className="flex items-center gap-2 text-[14.56px] text-muted"><Lock className="size-3.5" aria-hidden /> Outcome tracking is included in Growth and above.</p>
                  ) : related.length ? (
                    <ul className="space-y-2.5">
                      {related.map((o) => (
                        <li key={o.id} className="text-[14.56px] leading-snug">
                          <p className="font-medium">{o.workTitle}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
                            {o.completedAt ? <span>Done {formatDay(toISODate(o.completedAt))}</span> : null}
                            <VerdictBadge verdict={o.verdict} />
                            <EvidenceBadge strength={o.evidenceStrength} />
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[14.56px] text-muted">No completed work has targeted this metric yet.</p>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Outcomes */}
      <section id="outcomes" aria-labelledby="outcomes-h" className="mt-12 scroll-mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="outcomes-h" className="text-lg">Outcomes of completed work</h2>
            <p className="mt-1 max-w-2xl text-sm text-soft">Each result compares the metric the work targeted before and after it shipped. Cuework never calls a result proven unless a controlled test backs it.</p>
          </div>
          {tracking ? <RemeasureButton /> : null}
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {(["correlation", "corroborated", "experiment"] as const).map((s) => (
            <div key={s} className="rounded-xl border border-line bg-surface p-4">
              <EvidenceBadge strength={s} />
              <p className="mt-2 text-[14.56px] leading-snug text-soft">{EVIDENCE_LABEL[s].long}</p>
            </div>
          ))}
        </div>

        {!tracking ? (
          <Card>
            <CardBody className="flex items-start gap-3">
              <Lock className="mt-0.5 size-5 text-cue-700" aria-hidden />
              <div>
                <p className="font-medium">Outcome tracking is part of the Growth plan</p>
                <p className="mt-1 text-sm text-soft">Connect completed work to metric movement and see what your team&apos;s effort actually changed.</p>
                <Link href="/settings#plan" className="mt-2 inline-block text-sm font-medium underline underline-offset-4">Compare plans →</Link>
              </div>
            </CardBody>
          </Card>
        ) : data.outcomes.length ? (
          <Card className="overflow-hidden">
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line bg-sunken/60 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Completed work</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Metric</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Before → after</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Result</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.outcomes.map((o) => (
                    <tr key={o.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium leading-snug">{o.workTitle}</p>
                        <p className="mt-0.5 text-xs text-muted">{short(o.propertyName)}{o.completedAt ? ` · ${formatDay(toISODate(o.completedAt))}` : ""}</p>
                      </td>
                      <td className="px-4 py-3 text-soft">{o.target.label}</td>
                      <td className="tabular px-4 py-3 text-right">
                        {o.verdict === "pending" ? <span className="text-muted">Baseline {formatMetricValue(o.target.metric, o.baselineValue)}</span> : <>{formatMetricValue(o.target.metric, o.baselineValue)} → <strong>{formatMetricValue(o.target.metric, o.currentValue)}</strong> <span className={cn("ml-1 text-xs font-medium", o.verdict === "improved" ? "text-moss" : o.verdict === "declined" ? "text-brick" : "text-muted")}>{formatPct(o.changePct)}</span></>}
                      </td>
                      <td className="px-4 py-3"><VerdictBadge verdict={o.verdict} /></td>
                      <td className="px-4 py-3"><EvidenceBadge strength={o.evidenceStrength} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState icon={ChartLine} title="No completed work to measure yet">Complete an item on the work board and Cuework captures a baseline, then measures the metric as new data arrives.</EmptyState>
        )}
      </section>
    </div>
  );
}
