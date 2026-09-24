import { ArrowRight, Building2, CircleCheck, Inbox, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, EvidenceBadge, SourceBadge } from "@/components/domain/badges";
import { CapacityMeter } from "@/components/domain/capacity-meter";
import { Delta } from "@/components/domain/delta";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { PriorityChip } from "@/components/domain/priority";
import { Sparkline } from "@/components/domain/spark";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { addDays, formatDay, formatMonth, formatWeek } from "@/lib/domain/dates";
import { formatMetricValue, formatPct } from "@/lib/domain/metrics";
import { getPortfolio, type AttentionItem, type KpiView } from "@/lib/services/performance";
import { cn, hoursLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Command Center" };

const TONE_BAR: Record<AttentionItem["tone"], string> = { urgent: "bg-brick", decision: "bg-cue", risk: "bg-cue", info: "bg-line-strong" };
const TONE_LABEL: Record<AttentionItem["tone"], string> = { urgent: "Urgent", decision: "Decision needed", risk: "At risk", info: "Planning" };

function Kpi({ k }: { k: KpiView }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted">{k.label}</p>
      <p className="tabular mt-0.5 text-[24.64px] font-semibold leading-tight tracking-tight">{k.display}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3">
        <Delta value={k.mom} sentiment={k.momSentiment} label="MoM" />
        <Delta value={k.yoy} sentiment={k.yoySentiment} label="YoY" />
      </div>
      <Sparkline
        className="mt-2"
        values={k.series.map((p) => p.value)}
        tone={k.yoySentiment === "neutral" ? "ink" : k.yoySentiment}
        label={`${k.label}, last 12 months`}
      />
    </div>
  );
}

export default async function OverviewPage() {
  const { db, orgId, name } = await requireWorkspace();
  const p = await getPortfolio(db, orgId);
  const first = name.split(" ")[0];
  const { plan } = p;

  if (!p.properties.length) {
    return (
      <>
        <PageHeader title="Command Center" description="Your brands, priorities and capacity in one place." />
        <EmptyState
          icon={Building2}
          title="Add your first property"
          action={
            <Link href="/settings" className={buttonStyles({})}>
              Add a property
            </Link>
          }
        >
          Cuework starts with a brand or website. Add one, then import a CSV export from Search Console, Google Ads or GA4 to get your first recommendations.
        </EmptyState>
      </>
    );
  }

  const committed = plan.commitment?.status === "committed";
  const rate = plan.history.rate;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={`Week of ${formatWeek(plan.weekStart)}`}
        title={`Hello, ${first}`}
        description={`${p.properties.length} ${p.properties.length === 1 ? "property" : "properties"}, ${plan.members.length} ${plan.members.length === 1 ? "person" : "people"}, ${hoursLabel(plan.summary.totalPlannable)} of plannable time this week. Here's what matters.`}
      />

      {/* What needs attention today? */}
      <section aria-labelledby="attention" className="mb-8">
        <Card>
          <CardHeader className="items-center">
            <CardTitle className="text-lg" >
              <span id="attention">What needs attention today?</span>
            </CardTitle>
            <Badge tone={p.attention.length ? "cue" : "good"}>{p.attention.length ? `${p.attention.length} item${p.attention.length === 1 ? "" : "s"}` : "All clear"}</Badge>
          </CardHeader>
          <CardBody className="pt-3">
            {p.attention.length ? (
              <ol className="divide-y divide-line">
                {p.attention.map((a) => (
                  <li key={a.id} className="flex flex-col gap-3 py-4 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 gap-4">
                      <span className={cn("mt-1 w-1 shrink-0 self-stretch rounded-full", TONE_BAR[a.tone])} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.32px] font-semibold uppercase tracking-[0.08em] text-muted">{TONE_LABEL[a.tone]}</p>
                        <p className="mt-0.5 font-medium leading-snug">{a.title}</p>
                        <p className="mt-1 text-sm text-soft">{a.detail}</p>
                      </div>
                    </div>
                    <Link href={a.href} className={cn(buttonStyles({ variant: a.tone === "urgent" ? "primary" : "secondary", size: "sm" }), "ml-5 self-start sm:ml-0 sm:self-center")}>
                      {a.cta}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="flex items-center gap-2 text-sm text-soft">
                <CircleCheck className="size-5 text-moss" aria-hidden /> Nothing needs a decision right now. The plan is committed and nothing is blocked.
              </p>
            )}
          </CardBody>
        </Card>
      </section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-8">
          {/* Portfolio */}
          <section aria-labelledby="portfolio">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="portfolio" className="text-lg">Portfolio</h2>
              <Link href="/performance" className="text-sm font-medium text-soft underline-offset-4 hover:text-ink hover:underline">
                Full performance →
              </Link>
            </div>
            <div className="space-y-4">
              {p.properties.map((pr) => (
                <Card key={pr.property.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
                    <div>
                      <h3 className="text-base font-semibold">{pr.property.name}</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {pr.property.domain}
                        {pr.period ? ` · ${formatMonth(pr.period)} vs. prior month and year` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SourceBadge status={pr.sourceStatus} />
                      {pr.openRecs > 0 ? (
                        <Link href="/recommendations" className="rounded-full">
                          <Badge tone="cue">
                            <Inbox className="size-3" aria-hidden />
                            {pr.openRecs} to decide
                          </Badge>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <CardBody>
                    {pr.kpis.length ? (
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">{pr.kpis.map((k) => <Kpi key={k.id} k={k} />)}</div>
                    ) : (
                      <p className="text-sm text-muted">No data yet. <Link className="font-medium text-ink underline" href="/import">Import a CSV</Link> to see performance here.</p>
                    )}
                    {pr.anomalies.length ? (
                      <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
                        {pr.anomalies.slice(0, 2).map((a) => (
                          <li key={a.target.label} className="flex items-start gap-2 text-sm">
                            <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", a.sentiment === "bad" ? "text-brick" : "text-slate")} aria-hidden />
                            <span>
                              <strong className="font-medium">{a.target.label}</strong> is {formatMetricValue(a.target.metric, a.current, { compact: true })}, {formatPct(a.deviation)} against a normal of about{" "}
                              {formatMetricValue(a.target.metric, a.expected, { compact: true })}.
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Capacity */}
          <Card>
            <CardHeader>
              <div>
                <Eyebrow>This week&apos;s capacity</Eyebrow>
                <CardTitle className="mt-1 text-base">
                  {committed ? "Committed" : "No committed plan yet"}
                </CardTitle>
              </div>
              <Link href="/plan" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Open plan
              </Link>
            </CardHeader>
            <CardBody className="space-y-4">
              <CapacityMeter planned={plan.summary.totalPlanned} plannable={plan.summary.totalPlannable} status={plan.summary.status} buffer={plan.buffer} label="Team capacity this week" />
              <ul className="space-y-3 border-t border-line pt-4">
                {plan.summary.members.map((m) => (
                  <li key={m.memberId}>
                    <div className="mb-1.5 flex items-baseline justify-between text-[14.56px]">
                      <span className="font-medium">{m.name}</span>
                      <span className="tabular text-muted">{hoursLabel(m.planned)} / {hoursLabel(m.plannable)}</span>
                    </div>
                    <CapacityMeter planned={m.planned} plannable={m.plannable} status={m.status} buffer={plan.buffer} size="sm" label={`${m.name}'s capacity`} />
                  </li>
                ))}
              </ul>
              {rate != null ? (
                <p className="rounded-lg bg-sunken px-3 py-2.5 text-[14.56px] leading-snug text-soft">
                  Over the last {plan.history.weeks} weeks the team finished <strong className="font-semibold text-ink">{Math.round(rate * 100)}%</strong> of what it committed. Cuework plans to {Math.round((1 - plan.buffer) * 100)}% of capacity to leave room for the unexpected.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {/* Decisions */}
          <Card>
            <CardHeader>
              <CardTitle>Needs a decision</CardTitle>
              <Link href="/recommendations" className="text-sm font-medium text-soft underline-offset-4 hover:text-ink hover:underline">All {p.open.length}</Link>
            </CardHeader>
            <CardBody className="pt-2">
              {p.open.length ? (
                <ul className="divide-y divide-line">
                  {p.open.slice(0, 3).map((r) => (
                    <li key={r.id}>
                      <Link href={`/recommendations?r=${r.id}`} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-sunken">
                        <PriorityChip score={r.priorityScore} size="sm" showLabel={false} />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium leading-snug">{r.title}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <CategoryBadge category={r.category} />
                            <span className="text-xs text-muted">{p.properties.find((x) => x.property.id === r.propertyId)?.property.name.replace("Harborline ", "")} · {hoursLabel(r.estimatedHours)}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-sm text-muted">The inbox is clear. New recommendations appear when data changes.</p>
              )}
            </CardBody>
          </Card>

          {/* At risk */}
          {p.atRisk.length ? (
            <Card>
              <CardHeader>
                <CardTitle>At-risk work</CardTitle>
                <Badge tone="bad">{p.atRisk.length}</Badge>
              </CardHeader>
              <CardBody className="pt-2">
                <ul className="divide-y divide-line">
                  {p.atRisk.map(({ w, reason, kind }) => (
                    <li key={w.id} className="py-3">
                      <p className="text-sm font-medium leading-snug">{w.title}</p>
                      <p className="mt-1 text-[14.56px] text-soft">{reason}</p>
                      <div className="mt-2 flex gap-1.5">
                        <Badge tone="bad">{kind === "blocked" ? "Blocked" : "Over estimate"}</Badge>
                        {w.needsLeadership ? <Badge tone="cue">Needs leadership</Badge> : null}
                      </div>
                    </li>
                  ))}
                </ul>
                <Link href="/work" className="mt-1 inline-block text-sm font-medium text-soft underline-offset-4 hover:text-ink hover:underline">
                  Open work board →
                </Link>
              </CardBody>
            </Card>
          ) : null}

          {/* Wins */}
          <Card>
            <CardHeader>
              <CardTitle>Recent wins</CardTitle>
              <Link href="/performance#outcomes" className="text-sm font-medium text-soft underline-offset-4 hover:text-ink hover:underline">Outcomes</Link>
            </CardHeader>
            <CardBody className="pt-2">
              {p.wins.length ? (
                <ul className="divide-y divide-line">
                  {p.wins.map((o) => (
                    <li key={o.id} className="py-3">
                      <p className="text-sm font-medium leading-snug">{o.workTitle}</p>
                      <p className="mt-1 text-[14.56px] text-soft">
                        {o.target.label}: {formatMetricValue(o.target.metric, o.baselineValue)} → {formatMetricValue(o.target.metric, o.currentValue)} <span className="font-medium text-moss">({formatPct(o.changePct)})</span>
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <EvidenceBadge strength={o.evidenceStrength} />
                        <span className="text-xs text-muted">{o.completedAt ? `Completed ${formatDay(o.completedAt.toISOString().slice(0, 10))}` : ""}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-sm text-muted">Wins appear here once completed work shows a measured improvement.</p>
              )}
              {p.outcomesPending > 0 ? <p className="mt-2 text-xs text-muted">{p.outcomesPending} more {p.outcomesPending === 1 ? "outcome is" : "outcomes are"} waiting for enough data.</p> : null}
            </CardBody>
          </Card>
        </div>
      </div>
      <p className="mt-10 text-xs text-muted">Week runs {formatDay(plan.weekStart, { weekday: true })} – {formatDay(addDays(plan.weekStart, 6), { weekday: true })}. Capacity is plannable hours after standing meetings and time off.</p>
    </div>
  );
}
