"use client";

import { ArrowDown, ArrowUp, Ban, Lock, Plus, Scissors, TriangleAlert, Wand2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CategoryBadge } from "@/components/domain/badges";
import { CapacityMeter } from "@/components/domain/capacity-meter";
import { PriorityChip } from "@/components/domain/priority";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Eyebrow } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { savePlanAction } from "@/lib/actions/workspace";
import { autoFit, computePlan, moveItem, trimToCapacity, type PlanItem } from "@/lib/domain/capacity";
import { formatDay } from "@/lib/domain/dates";
import type { PlanItemView, WeekPlanView } from "@/lib/services/planning";
import { useAction } from "@/lib/use-action";
import { cn, hoursLabel, plural } from "@/lib/utils";

interface CapInput {
  memberId: string;
  totalHours: string;
  reservedHours: string;
  note: string;
}

const STATUS_TEXT: Record<PlanItemView["status"], string> = { backlog: "Backlog", committed: "Committed", in_progress: "In progress", blocked: "Blocked", complete: "Complete" };

export function PlanBuilder({ plan, readOnly }: { plan: WeekPlanView; readOnly: boolean }) {
  const { run, pending } = useAction();
  const [items, setItems] = React.useState<PlanItemView[]>(plan.items);
  const [caps, setCaps] = React.useState<CapInput[]>(
    plan.members.map((m) => ({ memberId: m.id, totalHours: String(m.totalHours), reservedHours: String(m.reservedHours), note: m.note })),
  );
  const [notice, setNotice] = React.useState<string | null>(null);

  const numeric = (v: string) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : NaN);
  const capacityErrors = caps.filter((c) => {
    const t = numeric(c.totalHours);
    const r = numeric(c.reservedHours);
    return !(t >= 0 && t <= 80 && r >= 0 && r <= t);
  });

  const members = plan.members.map((m) => {
    const c = caps.find((x) => x.memberId === m.id)!;
    const total = numeric(c.totalHours);
    const reserved = numeric(c.reservedHours);
    const plannable = Number.isNaN(total) || Number.isNaN(reserved) ? 0 : Math.max(0, total - reserved);
    return { ...m, plannable, total, reserved };
  });

  const planItems: PlanItem[] = items.map((i) => ({ id: i.id, title: i.title, assigneeId: i.assigneeId, hours: i.hours, priorityScore: i.priorityScore, locked: i.locked }));
  const summary = computePlan(
    members.map((m) => ({ id: m.id, name: m.name, plannableHours: m.plannable })),
    planItems,
    { buffer: plan.buffer },
  );

  const inPlan = new Set(items.map((i) => i.id));
  const candidates = plan.candidates.filter((c) => !inPlan.has(c.id));
  const wasCommitted = plan.commitment?.status === "committed";

  const dirty =
    JSON.stringify(items.map((i) => [i.id, i.assigneeId])) !== JSON.stringify(plan.items.map((i) => [i.id, i.assigneeId])) ||
    caps.some((c, idx) => {
      const m = plan.members[idx];
      return numeric(c.totalHours) !== m.totalHours || numeric(c.reservedHours) !== m.reservedHours || c.note !== m.note;
    });

  const projected = (c: PlanItemView) => {
    const owner = members.find((m) => m.id === c.assigneeId) ?? [...members].sort((a, b) => (summary.members.find((s) => s.memberId === b.id)!.remaining) - summary.members.find((s) => s.memberId === a.id)!.remaining)[0];
    if (!owner || owner.plannable <= 0) return null;
    const load = summary.members.find((s) => s.memberId === owner.id)!;
    const after = (load.planned + c.hours) / owner.plannable;
    return { owner, after, status: after > 1 ? ("over" as const) : after > 1 - plan.buffer ? ("tight" as const) : ("healthy" as const) };
  };

  const add = (c: PlanItemView) => {
    const p = projected(c);
    setNotice(null);
    setItems((cur) => [...cur, { ...c, assigneeId: c.assigneeId ?? p?.owner.id ?? null }]);
  };

  const suggest = () => {
    const fit = autoFit(
      members.map((m) => ({ id: m.id, name: m.name, plannableHours: m.plannable })),
      planItems,
      candidates.map((c) => ({ id: c.id, hours: c.hours, priorityScore: c.priorityScore, preferredAssigneeId: c.assigneeId })),
      { buffer: plan.buffer },
    );
    if (!fit.selected.length) {
      setNotice("Nothing else fits within your planning buffer. Free up capacity or drop something first.");
      return;
    }
    setItems((cur) => [
      ...cur,
      ...fit.selected.map((s) => {
        const c = candidates.find((x) => x.id === s.id)!;
        return { ...c, assigneeId: s.assigneeId };
      }),
    ]);
    setNotice(
      `Added ${plural(fit.selected.length, "item")} by priority, leaving a ${Math.round(plan.buffer * 100)}% buffer.${fit.skipped.length ? ` ${plural(fit.skipped.length, "item")} didn't fit and stay in the backlog.` : ""}`,
    );
  };

  const trim = () => {
    const { kept, dropped } = trimToCapacity(
      members.map((m) => ({ id: m.id, name: m.name, plannableHours: m.plannable })),
      planItems,
      { buffer: plan.buffer },
    );
    const keepIds = new Set(kept.map((k) => k.id));
    setItems((cur) => cur.filter((i) => keepIds.has(i.id)));
    setNotice(dropped.length ? `Removed ${plural(dropped.length, "lowest-priority item")}: ${dropped.map((d) => `“${d.title.slice(0, 44)}${d.title.length > 44 ? "…" : ""}”`).join(", ")}.` : "The plan already fits.");
  };

  const save = (commit: boolean) => {
    run(
      () =>
        savePlanAction({
          weekStart: plan.weekStart,
          commit,
          items: items.map((i) => ({ id: i.id, assigneeId: i.assigneeId })),
          capacity: caps.map((c) => ({ memberId: c.memberId, totalHours: numeric(c.totalHours), reservedHours: numeric(c.reservedHours), note: c.note })),
        }),
      { success: commit ? (wasCommitted ? "Commitment updated." : "Plan committed. Work is now on the board.") : "Draft saved." },
    );
  };

  const blockMessage = capacityErrors.length ? "Fix the capacity hours first." : summary.blockReason;
  const canCommit = summary.canCommit && capacityErrors.length === 0 && !pending;

  return (
    <div className="pb-28">
      {/* Capacity */}
      <section aria-labelledby="capacity" className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id="capacity" className="text-lg">Team capacity</h2>
          <p className="text-sm text-muted">Plannable = weekly hours − meetings, BAU and time off</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {members.map((m) => {
            const load = summary.members.find((s) => s.memberId === m.id)!;
            const c = caps.find((x) => x.memberId === m.id)!;
            const idx = caps.indexOf(c);
            const setCap = (patch: Partial<CapInput>) => setCaps((cur) => cur.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
            const bad = capacityErrors.includes(c);
            return (
              <Card key={m.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{m.name}</p>
                      <p className="text-xs text-muted">{m.title}</p>
                    </div>
                    <Badge tone={load.status === "over" ? "bad" : load.status === "tight" ? "cue" : "good"}>{load.status === "over" ? "Over" : load.status === "tight" ? "Tight" : "Healthy"}</Badge>
                  </div>
                  <div className="mt-4">
                    <CapacityMeter planned={load.planned} plannable={m.plannable} status={load.status} buffer={plan.buffer} label={`${m.name}'s capacity`} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <label className="text-xs font-medium text-soft">
                      Weekly hours
                      <Input type="number" inputMode="decimal" min={0} max={80} step={0.5} className="mt-1 h-9" value={c.totalHours} disabled={readOnly} onChange={(e) => setCap({ totalHours: e.target.value })} aria-invalid={bad} />
                    </label>
                    <label className="text-xs font-medium text-soft">
                      Reserved (meetings, BAU)
                      <Input type="number" inputMode="decimal" min={0} max={80} step={0.5} className="mt-1 h-9" value={c.reservedHours} disabled={readOnly} onChange={(e) => setCap({ reservedHours: e.target.value })} aria-invalid={bad} />
                    </label>
                  </div>
                  <label className="mt-2.5 block text-xs font-medium text-soft">
                    Note
                    <Input className="mt-1 h-9" value={c.note} disabled={readOnly} maxLength={200} placeholder="e.g. Out Friday (−8h)" onChange={(e) => setCap({ note: e.target.value })} />
                  </label>
                  {bad ? <p role="alert" className="mt-2 text-xs font-medium text-brick">Reserved hours can&apos;t exceed weekly hours, and weekly hours can&apos;t exceed 80.</p> : null}
                </CardBody>
              </Card>
            );
          })}
          <Card className="bg-ink text-white lg:order-last">
            <CardBody className="flex h-full flex-col justify-between">
              <div>
                <Eyebrow className="text-side-muted">Team total</Eyebrow>
                <p className="tabular mt-2 text-4xl font-semibold tracking-tight">
                  {hoursLabel(summary.totalPlanned)}
                  <span className="ml-1.5 text-lg font-normal text-side-muted">of {hoursLabel(summary.totalPlannable)}</span>
                </p>
                <p className="tabular mt-1 text-sm text-side-text">
                  {summary.totalRemaining >= 0 ? `${hoursLabel(summary.totalRemaining)} unplanned` : `${hoursLabel(-summary.totalRemaining)} over`} · {Math.round((summary.utilization === Infinity ? 9.99 : summary.utilization) * 100)}% used
                </p>
              </div>
              {plan.history.rate != null ? (
                <p className="mt-5 border-t border-white/10 pt-4 text-[13px] leading-snug text-side-text">
                  Your team finished <strong className="text-white">{Math.round(plan.history.rate * 100)}%</strong> of what it committed over the last {plan.history.weeks} weeks. Aim for ≤ {Math.round((1 - plan.buffer) * 100)}%.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </section>

      {summary.warnings.length ? (
        <ul className="mb-8 space-y-2" aria-label="Plan warnings">
          {summary.warnings
            .filter((w) => !(w.kind === "empty" && items.length === 0 && !candidates.length))
            .map((w, i) => (
              <li
                key={i}
                role={w.severity === "block" ? "alert" : undefined}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-4 py-2.5 text-sm",
                  w.severity === "block" ? "border-brick/30 bg-brick-soft text-ink" : "border-cue/40 bg-cue-soft text-ink",
                )}
              >
                {w.severity === "block" ? <Ban className="mt-0.5 size-4 shrink-0 text-brick" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-cue-700" aria-hidden />}
                <span>{w.message}</span>
              </li>
            ))}
        </ul>
      ) : null}
      {notice ? <p role="status" className="mb-6 rounded-lg bg-sunken px-4 py-2.5 text-sm text-soft">{notice}</p> : null}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* The plan */}
        <section aria-labelledby="plan-list">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="plan-list" className="text-lg">This week&apos;s plan <span className="tabular text-base font-normal text-muted">· {plural(items.length, "item")}</span></h2>
            {!readOnly && summary.warnings.some((w) => w.kind === "member_over" || w.kind === "total_over") ? (
              <Button variant="secondary" size="sm" onClick={trim}>
                <Scissors className="size-3.5" aria-hidden /> Trim to capacity
              </Button>
            ) : null}
          </div>
          {items.length ? (
            <ol className="space-y-2.5">
              {items.map((it, idx) => {
                const owner = members.find((m) => m.id === it.assigneeId);
                const load = owner ? summary.members.find((s) => s.memberId === owner.id) : null;
                const ownerOver = load?.status === "over";
                return (
                  <li key={it.id} className={cn("rounded-xl border bg-surface p-4 shadow-card", ownerOver ? "border-brick/40" : "border-line")}>
                    <div className="flex items-start gap-3">
                      <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-soft" aria-label={`Priority ${idx + 1}`}>{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{it.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <CategoryBadge category={it.category} />
                          <span className="text-xs text-muted">{it.propertyName.replace("Harborline ", "")}</span>
                          <span className="tabular text-xs font-semibold">{hoursLabel(it.hours)}</span>
                          {it.locked ? (
                            <Badge tone={it.status === "blocked" ? "bad" : "info"}>
                              <Lock className="size-3" aria-hidden />
                              {STATUS_TEXT[it.status]}
                            </Badge>
                          ) : null}
                          {it.needsLeadership ? <Badge tone="cue">Needs leadership</Badge> : null}
                        </div>
                        {it.status === "blocked" && it.blockedReason ? <p className="mt-2 text-[13px] text-soft">{it.blockedReason}</p> : null}
                      </div>
                      <PriorityChip score={it.priorityScore} size="sm" showLabel={false} />
                    </div>
                    {!readOnly ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-soft">
                          Owner
                          <Select
                            aria-label={`Owner of ${it.title}`}
                            className={cn("h-8 w-40 text-[13px]", !it.assigneeId && "border-brick")}
                            value={it.assigneeId ?? ""}
                            disabled={it.status === "complete"}
                            onChange={(e) => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, assigneeId: e.target.value || null } : x)))}
                          >
                            <option value="">Choose an owner…</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                        {ownerOver ? <span className="text-xs font-medium text-brick">{owner?.name} is over capacity</span> : null}
                        <span className="ml-auto flex items-center gap-1">
                          <Button variant="ghost" size="icon" aria-label={`Move “${it.title}” up`} disabled={idx === 0} onClick={() => setItems((cur) => moveItem(cur, idx, idx - 1))}>
                            <ArrowUp className="size-4" aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Move “${it.title}” down`} disabled={idx === items.length - 1} onClick={() => setItems((cur) => moveItem(cur, idx, idx + 1))}>
                            <ArrowDown className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={it.locked ? `“${it.title}” is ${STATUS_TEXT[it.status].toLowerCase()} and stays in this week` : `Remove “${it.title}” from this week`}
                            disabled={it.locked && plan.items.some((p) => p.id === it.id)}
                            onClick={() => {
                              setItems((cur) => cur.filter((x) => x.id !== it.id));
                              setNotice(null);
                            }}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
              <p className="font-medium">Nothing planned for this week yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Add work from the list, or let Cuework suggest the highest-priority plan that fits your team&apos;s real capacity.</p>
            </div>
          )}
        </section>

        {/* Candidates */}
        <section aria-labelledby="ready">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ready" className="text-lg">Ready to plan <span className="tabular text-base font-normal text-muted">· {candidates.length}</span></h2>
            {!readOnly && candidates.length ? (
              <Button variant="secondary" size="sm" onClick={suggest}>
                <Wand2 className="size-3.5" aria-hidden /> Suggest a plan
              </Button>
            ) : null}
          </div>
          {candidates.length ? (
            <ul className="space-y-2.5">
              {candidates.map((c) => {
                const p = projected(c);
                const carried = c.status !== "backlog" || Boolean(c.recommendationId === null);
                return (
                  <li key={c.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                    <div className="flex items-start gap-3">
                      <PriorityChip score={c.priorityScore} size="sm" showLabel={false} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{c.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <CategoryBadge category={c.category} />
                          <span className="text-xs text-muted">{c.propertyName.replace("Harborline ", "")}</span>
                          <span className="tabular text-xs font-semibold">{hoursLabel(c.hours)}</span>
                          {carried ? <Badge tone="outline">Carried over</Badge> : null}
                        </div>
                        {p ? (
                          <p className={cn("mt-2 text-xs", p.status === "over" ? "font-medium text-brick" : p.status === "tight" ? "font-medium text-cue-700" : "text-muted")}>
                            {p.status === "over" ? `Would put ${p.owner.name} over capacity (${Math.round(p.after * 100)}%)` : `${p.owner.name} → ${Math.round(p.after * 100)}% of their week`}
                          </p>
                        ) : null}
                      </div>
                      {!readOnly ? (
                        <Button variant="secondary" size="sm" onClick={() => add(c)} aria-label={`Add “${c.title}” to this week`}>
                          <Plus className="size-3.5" aria-hidden /> Add
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-8 text-center text-sm text-muted">
              Everything accepted is already scheduled.
              {plan.openRecommendations > 0 ? (
                <>
                  {" "}
                  <Link href="/recommendations" className="font-medium text-ink underline underline-offset-4">
                    {plural(plan.openRecommendations, "recommendation")} still need a decision →
                  </Link>
                </>
              ) : null}
            </div>
          )}
          {candidates.length && plan.openRecommendations > 0 ? (
            <p className="mt-3 text-sm text-muted">
              <Link href="/recommendations" className="font-medium text-soft underline underline-offset-4 hover:text-ink">
                {plural(plan.openRecommendations, "more recommendation")} waiting for a decision →
              </Link>
            </p>
          ) : null}
        </section>
      </div>

      {/* Commit bar */}
      {!readOnly ? (
        <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-10">
            <div className="min-w-0 flex-1 basis-full sm:basis-0" aria-live="polite">
              {canCommit ? (
                <p className="text-sm">
                  <strong className="tabular font-semibold">{hoursLabel(summary.totalPlanned)}</strong> of {hoursLabel(summary.totalPlannable)} planned
                  <span className="text-muted"> · {summary.status === "tight" ? "tight — little room for surprises" : `${hoursLabel(summary.totalRemaining)} of headroom`}</span>
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm font-medium text-brick">
                  <Ban className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>Can&apos;t commit yet: {blockMessage}</span>
                </p>
              )}
              {plan.commitment?.committedAt ? (
                <p className="text-xs text-muted">Committed by {plan.commitment.committedByName} on {formatDay(plan.commitment.committedAt.slice(0, 10))}{dirty ? " · unsaved changes" : ""}</p>
              ) : dirty ? (
                <p className="text-xs text-muted">Unsaved changes</p>
              ) : null}
            </div>
            {!wasCommitted ? (
              <Button variant="secondary" className="flex-1 sm:flex-none" disabled={pending || !dirty || capacityErrors.length > 0} onClick={() => save(false)}>
                Save draft
              </Button>
            ) : null}
            <Button variant="cue" size="lg" className="flex-1 sm:flex-none" disabled={!canCommit || (wasCommitted && !dirty)} onClick={() => save(true)} aria-describedby="commit-help">
              {pending ? "Saving…" : wasCommitted ? "Update commitment" : "Commit plan"}
            </Button>
            <span id="commit-help" className="sr-only">
              {canCommit ? "Commits this plan and moves its work onto the board." : `Disabled: ${blockMessage}`}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlanHeaderStatus({ plan }: { plan: WeekPlanView }) {
  if (!plan.commitment) return <Badge tone="outline">Not started</Badge>;
  return plan.commitment.status === "committed" ? <Badge tone="good">Committed</Badge> : <Badge tone="cue">Draft</Badge>;
}
