import { ArrowLeft, CircleCheck, Inbox, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, SourceBadge } from "@/components/domain/badges";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { LevelDots, PriorityChip } from "@/components/domain/priority";
import { RecommendationActions } from "@/components/recommendation-actions";
import { RefreshAnalysis } from "@/components/refresh-analysis";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardBody, Eyebrow } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { formatDay, formatMonth, toISODate, weekStart } from "@/lib/domain/dates";
import { getPlan } from "@/lib/domain/entitlements";
import { explainPriority } from "@/lib/domain/prioritization";
import { getWeekPlan } from "@/lib/services/planning";
import { getDecisionLog, getInbox, type RecommendationView } from "@/lib/services/recommendations";
import { loadWorkspace, propertySourceStatus } from "@/lib/services/workspace";
import { cn, hoursLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Recommendations" };

const TABS = [
  { id: "open", label: "Needs a decision" },
  { id: "deferred", label: "Deferred" },
  { id: "dismissed", label: "Dismissed" },
  { id: "converted", label: "In work" },
  { id: "log", label: "Decision log" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "cue" | "good" | "info" | "outline" }> = {
  new: { label: "New", tone: "cue" },
  refining: { label: "Being refined", tone: "info" },
  accepted: { label: "Accepted", tone: "good" },
  converted: { label: "In work", tone: "good" },
  deferred: { label: "Deferred", tone: "outline" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

const DECISION_LABEL: Record<string, string> = { accept: "Accepted", convert: "Converted to work", defer: "Deferred", dismiss: "Dismissed", refine: "Refinement requested" };

export default async function RecommendationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; r?: string }> }) {
  const sp = await searchParams;
  const { db, orgId } = await requireWorkspace();
  const now = new Date();
  const [ws, inbox, plan] = await Promise.all([loadWorkspace(db, orgId), getInbox(db, orgId), getWeekPlan(db, orgId, weekStart(now))]);
  const tab: TabId = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : "open";
  const lists: Record<Exclude<TabId, "log">, RecommendationView[]> = { open: inbox.open, deferred: inbox.deferred, dismissed: inbox.dismissed, converted: inbox.converted };
  const list = tab === "log" ? [] : lists[tab];
  // A stale ?r= (e.g. the item was just decided and left this list) falls through to the top item.
  const requested = tab === "log" ? null : (list.find((r) => r.id === sp.r) ?? null);
  const selected = requested ?? (tab === "log" ? null : (list[0] ?? null));
  const showDetailOnMobile = Boolean(requested);
  const log = tab === "log" ? await getDecisionLog(db, orgId) : [];
  const counts = { open: inbox.open.length, deferred: inbox.deferred.length, dismissed: inbox.dismissed.length, converted: inbox.converted.length, log: 0 };
  const plan_ = getPlan(ws.planKey);
  const memberByRole = (role: string) => ws.team.find((t) => t.roleKey === role) ?? ws.team[0];

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Recommendation inbox"
        title="What should we do next?"
        description="Every recommendation shows its evidence, why it matters now, and whether your team can realistically take it on."
        actions={<RefreshAnalysis />}
      />

      <nav aria-label="Recommendation views" className="thin-scroll -mx-4 mb-6 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/recommendations?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "bg-ink text-white" : "text-soft hover:bg-sunken hover:text-ink",
            )}
          >
            {t.label}
            {t.id !== "log" ? <span className={cn("tabular ml-1.5 text-xs", tab === t.id ? "text-white/70" : "text-muted")}>{counts[t.id]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "log" ? (
        <Card>
          <CardBody className="p-0">
            {log.length ? (
              <ul className="divide-y divide-line">
                {log.map((d) => (
                  <li key={d.id} className="grid gap-1 px-5 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
                    <div>
                      <Badge tone={d.decision === "dismiss" ? "neutral" : d.decision === "defer" ? "outline" : "good"}>{DECISION_LABEL[d.decision]}</Badge>
                      <p className="mt-1.5 text-xs text-muted">{formatDay(toISODate(d.createdAt), { year: true })}</p>
                      <p className="text-xs text-muted">{d.decidedByName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-snug">{d.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{d.propertyName}</p>
                      {d.rationale ? <p className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-soft">“{d.rationale}”</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-6"><EmptyState icon={Inbox} title="No decisions yet">Accept, defer or dismiss a recommendation and the reasoning is kept here as your team&apos;s memory.</EmptyState></div>
            )}
          </CardBody>
        </Card>
      ) : !ws.period ? (
        <EmptyState
          icon={Inbox}
          title="No recommendations yet"
          action={
            <Link href={ws.properties.length ? "/import" : "/settings#properties"} className={buttonStyles({})}>
              {ws.properties.length ? "Import data" : "Add a property"}
            </Link>
          }
        >
          Cuework generates recommendations from your data. {ws.properties.length ? "Import a CSV export from Search Console, Google Ads or GA4 to get your first prioritised list." : "Add a property, then import its data to get your first prioritised list."}
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === "open" ? CircleCheck : Inbox}
          title={tab === "open" ? "You're caught up" : `Nothing ${tab === "converted" ? "in work" : tab} yet`}
          action={tab === "open" ? <RefreshAnalysis /> : undefined}
        >
          {tab === "open"
            ? "There are no recommendations waiting for a decision. Import newer data or re-run the analysis to check for new opportunities."
            : "Items appear here as you make decisions in the inbox."}
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {/* List */}
          <div className={cn(showDetailOnMobile && "hidden lg:block")}>
            <ul className="space-y-2">
              {list.map((r) => {
                const active = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/recommendations?tab=${tab}&r=${r.id}`}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex gap-3 rounded-xl border p-3.5 transition-all",
                        active ? "border-ink bg-surface shadow-lift" : "border-line bg-surface shadow-card hover:border-line-strong",
                      )}
                    >
                      <PriorityChip score={r.priorityScore} size="sm" showLabel={false} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{r.title}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <CategoryBadge category={r.category} />
                          {r.status === "refining" ? <Badge tone="info">Refining</Badge> : null}
                          {r.status === "accepted" ? <Badge tone="good">Accepted</Badge> : null}
                          <span className="text-xs text-muted">
                            {r.propertyName.replace("Harborline ", "")} · {hoursLabel(r.estimatedHours)}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {tab === "open" && inbox.hiddenByPlan > 0 ? (
              <Card className="mt-3 border-cue/40 bg-cue-soft">
                <CardBody className="flex items-start gap-3 py-4">
                  <Lock className="mt-0.5 size-4 shrink-0 text-cue-700" aria-hidden />
                  <div className="text-sm">
                    <p className="font-medium text-cue-700">{inbox.hiddenByPlan} more recommendations are hidden</p>
                    <p className="mt-0.5 text-soft">The {plan_.name} plan shows your top {plan_.limits.openRecommendations}. Upgrade to see everything Cuework found.</p>
                    <Link href="/settings#plan" className="mt-2 inline-block font-medium text-ink underline underline-offset-4">See plans →</Link>
                  </div>
                </CardBody>
              </Card>
            ) : null}
          </div>

          {/* Detail */}
          <div className={cn(!showDetailOnMobile && "hidden lg:block")}>
            {selected ? (
              <Detail
                key={selected.id}
                rec={selected}
                ws={ws}
                plan={plan}
                ownerId={memberByRole(selected.suggestedOwnerRole)?.id ?? null}
                ownerName={memberByRole(selected.suggestedOwnerRole)?.name ?? "Unassigned"}
                tab={tab}
              />
            ) : (
              <EmptyState icon={Inbox} title="That recommendation isn't in this list">
                It may have been decided already. <Link href={`/recommendations?tab=${tab}`} className="font-medium text-ink underline">Back to the list</Link>
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  rec,
  ws,
  plan,
  ownerId,
  ownerName,
  tab,
}: {
  rec: RecommendationView;
  ws: Awaited<ReturnType<typeof loadWorkspace>>;
  plan: Awaited<ReturnType<typeof getWeekPlan>>;
  ownerId: string | null;
  ownerName: string;
  tab: TabId;
}) {
  const drivers = explainPriority({ impact: rec.impact, urgency: rec.urgency, strategic: rec.strategic, confidence: rec.confidence, effort: rec.effort });
  const owner = plan.summary.members.find((m) => m.memberId === ownerId);
  const after = owner && owner.plannable > 0 ? (owner.planned + rec.estimatedHours) / owner.plannable : null;
  const fit =
    !owner || after == null
      ? null
      : after > 1
        ? { tone: "bad" as const, text: `${owner.name} has ${hoursLabel(Math.max(owner.remaining, 0))} unplanned this week; this needs ${hoursLabel(rec.estimatedHours)}. It won't fit without moving something out, so it would join the backlog for a later week.` }
        : after > 1 - plan.buffer
          ? { tone: "warn" as const, text: `Fits, but tight: ${owner.name} would be at ${Math.round(after * 100)}% of their week (${hoursLabel(owner.remaining)} unplanned, this needs ${hoursLabel(rec.estimatedHours)}).` }
          : { tone: "good" as const, text: `Fits this week: ${owner.name} has ${hoursLabel(owner.remaining)} unplanned and this needs ${hoursLabel(rec.estimatedHours)}, leaving them at ${Math.round(after * 100)}%.` };

  const status = STATUS_LABEL[rec.status];
  const sourceStatus = propertySourceStatus(ws, rec.propertyId);
  const today = toISODate(new Date());
  const members = plan.members.map((m) => ({ id: m.id, name: m.name, roleKey: m.roleKey, remaining: plan.summary.members.find((x) => x.memberId === m.id)?.remaining ?? 0 }));

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-5 sm:px-7">
        <Link href={`/recommendations?tab=${tab}`} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-soft hover:text-ink lg:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All recommendations
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={rec.category} />
          <Badge tone="outline">{rec.propertyName}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
          <SourceBadge status={sourceStatus} />
        </div>
        <h2 className="mt-3 text-xl leading-snug sm:text-[1.4rem]">{rec.title}</h2>
        <div className="mt-5">
          <RecommendationActions
            id={rec.id}
            title={rec.title}
            status={rec.status}
            estimatedHours={rec.estimatedHours}
            suggestedOwnerId={ownerId}
            members={members}
            workItemId={rec.workItemId}
            today={today}
          />
        </div>
      </div>

      <div className="space-y-7 px-5 py-6 sm:px-7">
        {fit && rec.status !== "converted" ? (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm leading-relaxed",
              fit.tone === "good" && "border-moss/30 bg-moss-soft text-ink",
              fit.tone === "warn" && "border-cue/40 bg-cue-soft text-ink",
              fit.tone === "bad" && "border-brick/30 bg-brick-soft text-ink",
            )}
          >
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Can the team realistically do it?</p>
            {fit.text}
          </div>
        ) : null}

        <div className="grid gap-6 sm:grid-cols-2">
          <section>
            <Eyebrow>What we should do</Eyebrow>
            <p className="mt-1.5 leading-relaxed">{rec.nextStep}</p>
          </section>
          <section>
            <Eyebrow>Why it matters</Eyebrow>
            <p className="mt-1.5 leading-relaxed text-soft">{rec.rationale}</p>
          </section>
          <section>
            <Eyebrow>Why now</Eyebrow>
            <p className="mt-1.5 leading-relaxed text-soft">{rec.whyNow}</p>
          </section>
          <section>
            <Eyebrow>Expected outcome</Eyebrow>
            <p className="mt-1.5 leading-relaxed text-soft">{rec.expectedOutcome}</p>
            <p className="mt-2 text-xs text-muted">
              Measured by: <span className="font-medium text-soft">{rec.target.label}</span>
            </p>
          </section>
        </div>

        <section aria-labelledby="evidence">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <Eyebrow id="evidence">Evidence</Eyebrow>
            <span className="text-xs text-muted">Based on {formatMonth(rec.basedOnPeriod)}</span>
          </div>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {rec.evidence.map((e) => (
              <div key={e.id} className="grid gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <dt className="text-sm text-soft">{e.label}</dt>
                <dd>
                  <span className="tabular text-sm font-semibold">{e.value}</span>
                  {e.comparison ? <span className="ml-2 text-[13px] text-muted">{e.comparison}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="scoring">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Eyebrow id="scoring">Priority</Eyebrow>
            <PriorityChip score={rec.priorityScore} />
          </div>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <ScoreRow label="Impact" note="How much the target metric could move"><LevelDots value={rec.impact} label="Impact" /></ScoreRow>
            <ScoreRow label="Urgency" note="Cost of waiting"><LevelDots value={rec.urgency} label="Urgency" tone="cue" /></ScoreRow>
            <ScoreRow label="Strategic fit" note={`Weight of ${rec.propertyName.replace("Harborline ", "")}`}><LevelDots value={rec.strategic} label="Strategic fit" /></ScoreRow>
            <ScoreRow label="Effort" note="Higher means more work"><LevelDots value={rec.effort} label="Effort" /></ScoreRow>
            <ScoreRow label="Confidence" note="How sure the evidence is"><span className="tabular text-sm font-semibold">{Math.round(rec.confidence * 100)}%</span></ScoreRow>
            <ScoreRow label="Estimate" note={`Suggested owner: ${ownerName}`}><span className="tabular text-sm font-semibold">{hoursLabel(rec.estimatedHours)}</span></ScoreRow>
          </div>
          <details className="mt-4 group">
            <summary className="cursor-pointer text-sm font-medium text-soft hover:text-ink">How the score is built</summary>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {drivers.map((d) => (
                <li key={d.label} className="flex items-center justify-between rounded-lg bg-sunken px-3 py-1.5">
                  <span>{d.label} <span className="text-muted">({d.note})</span></span>
                  <span className={cn("tabular font-medium", d.points > 0 ? "text-moss" : d.points < 0 ? "text-brick" : "text-muted")}>{d.points > 0 ? "+" : d.points < 0 ? "−" : ""}{Math.abs(d.points)} vs. neutral</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Score = 45% impact + 30% urgency + 25% strategic fit, discounted for low confidence and high effort.</p>
          </details>
        </section>

        {rec.decisions.length ? (
          <section aria-labelledby="history">
            <Eyebrow id="history">Decision history</Eyebrow>
            <ul className="mt-2 space-y-2">
              {rec.decisions.map((d) => (
                <li key={d.id} className="rounded-lg bg-sunken px-3.5 py-2.5 text-sm">
                  <span className="font-medium">{DECISION_LABEL[d.decision]}</span> <span className="text-muted">by {d.decidedByName} · {formatDay(toISODate(d.createdAt), { year: true })}{d.deferUntil ? ` · until ${formatDay(d.deferUntil)}` : ""}</span>
                  {d.rationale ? <p className="mt-1 text-soft">“{d.rationale}”</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}

function ScoreRow({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{note}</p>
      </div>
      {children}
    </div>
  );
}
