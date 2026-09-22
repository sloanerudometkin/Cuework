"use client";

import { Ban, CalendarCheck, CheckCircle2, Link2, Play, RotateCcw, Timer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CategoryBadge, EvidenceBadge, VerdictBadge } from "@/components/domain/badges";
import { PriorityChip } from "@/components/domain/priority";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Eyebrow } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { workAction } from "@/lib/actions/workspace";
import { formatMetricValue, formatPct } from "@/lib/domain/metrics";
import { VERDICT_LABEL, type EvidenceStrength, type Verdict } from "@/lib/domain/outcomes";
import type { Category, MetricTarget } from "@/lib/domain/types";
import { formatDay, formatMonth } from "@/lib/domain/dates";
import { useAction } from "@/lib/use-action";
import { cn, hoursLabel } from "@/lib/utils";

export type Status = "backlog" | "committed" | "in_progress" | "blocked" | "complete";

export interface BoardItem {
  id: string;
  title: string;
  status: Status;
  category: Category;
  propertyName: string;
  assigneeName: string | null;
  estimatedHours: number;
  hoursSpent: number;
  priorityScore: number;
  weekStart: string | null;
  blockedReason: string | null;
  needsLeadership: boolean;
  objective: string;
  expectedOutcome: string;
  target: MetricTarget | null;
  completedOn: string | null;
  recommendation: null | {
    id: string;
    rationale: string;
    nextStep: string;
    whyNow: string;
    basedOnPeriod: string;
    evidence: { id: string; label: string; value: string; comparison: string | null }[];
  };
  outcome: null | {
    baselineValue: number | null;
    baselinePeriod: string | null;
    currentValue: number | null;
    currentPeriod: string | null;
    changePct: number | null;
    verdict: Verdict;
    evidenceStrength: EvidenceStrength;
    note: string;
  };
}

const COLUMNS: { id: Status; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Accepted, not yet scheduled" },
  { id: "committed", label: "Committed", hint: "Planned for a week" },
  { id: "in_progress", label: "In progress", hint: "Being worked on" },
  { id: "blocked", label: "Blocked", hint: "Waiting on something" },
  { id: "complete", label: "Complete", hint: "Recently finished" },
];

const initials = (name: string | null) => (name ? name.split(" ").map((p) => p[0]).slice(0, 2).join("") : "?");

function Card({ item, onOpen }: { item: BoardItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border bg-surface p-3.5 text-left shadow-card transition-all hover:-translate-y-px hover:shadow-lift",
        item.status === "blocked" ? "border-brick/40" : "border-line",
      )}
    >
      <span className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug">{item.title}</span>
        <PriorityChip score={item.priorityScore} size="sm" showLabel={false} />
      </span>
      <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={item.category} />
        <span className="text-xs text-muted">{item.propertyName.replace("Harborline ", "")}</span>
      </span>
      <span className="mt-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-sunken text-[10px] font-semibold text-soft" aria-hidden>{initials(item.assigneeName)}</span>
          <span className="sr-only">Owner: {item.assigneeName ?? "unassigned"}</span>
          <span className="tabular text-xs text-muted">
            {item.status === "in_progress" || item.status === "complete" ? `${hoursLabel(item.hoursSpent)} / ` : ""}
            {hoursLabel(item.estimatedHours)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {item.needsLeadership ? <Badge tone="cue">Leadership</Badge> : null}
          {item.status === "complete" && item.outcome ? <VerdictBadge verdict={item.outcome.verdict} /> : null}
        </span>
      </span>
      {item.status === "blocked" && item.blockedReason ? <span className="mt-2.5 line-clamp-2 block text-xs text-soft">{item.blockedReason}</span> : null}
    </button>
  );
}

export function WorkBoard({ items, openId }: { items: BoardItem[]; openId: string | null }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(openId);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div className="grid min-w-[1180px] grid-cols-5 gap-4 lg:min-w-0 lg:gap-3 xl:gap-4">
          {COLUMNS.map((col) => {
            const list = items.filter((i) => i.status === col.id);
            return (
              <section key={col.id} aria-labelledby={`col-${col.id}`} className="min-w-0">
                <header className="mb-3 flex items-baseline justify-between px-1">
                  <div>
                    <h2 id={`col-${col.id}`} className="text-sm font-semibold">{col.label}</h2>
                    <p className="text-xs text-muted">{col.hint}</p>
                  </div>
                  <span className="tabular rounded-full bg-sunken px-2 text-xs font-semibold leading-5 text-soft">{list.length}</span>
                </header>
                <ul className="min-h-24 space-y-2.5 rounded-xl bg-sunken/60 p-2">
                  {list.map((it) => (
                    <li key={it.id}>
                      <Card item={it} onOpen={() => setSelectedId(it.id)} />
                    </li>
                  ))}
                  {!list.length ? <li className="px-2 py-6 text-center text-xs text-muted">Nothing here</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <Detail key={selected?.id ?? "none"} item={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}

function Detail({ item, onClose }: { item: BoardItem | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [mode, setMode] = React.useState<"none" | "block" | "complete">("none");
  const [reason, setReason] = React.useState("");
  const [leadership, setLeadership] = React.useState(false);
  const [actual, setActual] = React.useState("");
  const [logHours, setLogHours] = React.useState("1");
  const [error, setError] = React.useState<string | null>(null);

  if (!item) return null;
  const go = (action: Parameters<typeof workAction>[1], success: string, after?: () => void) =>
    run(() => workAction(item.id, action), { success, onOk: () => { setMode("none"); setError(null); after?.(); }, onError: setError });

  const o = item.outcome;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent side="right" title={item.title} description={`${item.propertyName} · ${item.assigneeName ?? "Unassigned"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={item.category} />
          <Badge tone={item.status === "blocked" ? "bad" : item.status === "complete" ? "good" : item.status === "in_progress" ? "info" : "outline"}>{COLUMNS.find((c) => c.id === item.status)!.label}</Badge>
          {item.weekStart ? <Badge tone="outline"><CalendarCheck className="size-3" aria-hidden />Week of {formatDay(item.weekStart)}</Badge> : null}
          <PriorityChip score={item.priorityScore} size="sm" />
        </div>

        {/* Actions */}
        <div className="mt-5 rounded-xl border border-line bg-sunken/50 p-4">
          {item.status === "backlog" ? (
            <div>
              <p className="text-sm text-soft">This item is accepted but not scheduled. Work only starts once it is in a committed weekly plan, so capacity is checked first.</p>
              <Link href="/plan" className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink-3">
                <CalendarCheck className="size-4" aria-hidden /> Schedule in the weekly plan
              </Link>
            </div>
          ) : null}
          {item.status === "committed" ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => go({ type: "start" }, "Started. Log time as you go.")} disabled={pending}><Play className="size-4" aria-hidden /> Start work</Button>
              <Button variant="secondary" onClick={() => setMode("block")}><Ban className="size-4" aria-hidden /> Block</Button>
            </div>
          ) : null}
          {item.status === "in_progress" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Log time (hours)" htmlFor="log" className="w-32">
                  <Input id="log" type="number" inputMode="decimal" step="0.5" min="0.5" max="40" value={logHours} onChange={(e) => setLogHours(e.target.value)} className="h-9" />
                </Field>
                <Button variant="secondary" size="md" disabled={pending} onClick={() => go({ type: "log_hours", hours: Number(logHours) }, `Logged ${logHours}h.`)}><Timer className="size-4" aria-hidden /> Log</Button>
                <span className="tabular pb-2.5 text-sm text-muted">{hoursLabel(item.hoursSpent)} of {hoursLabel(item.estimatedHours)} used</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="cue" onClick={() => { setActual(String(Math.max(item.hoursSpent, item.estimatedHours))); setMode("complete"); }}><CheckCircle2 className="size-4" aria-hidden /> Mark complete</Button>
                <Button variant="secondary" onClick={() => setMode("block")}><Ban className="size-4" aria-hidden /> Block</Button>
              </div>
            </div>
          ) : null}
          {item.status === "blocked" ? (
            <div>
              <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-brick" aria-hidden /><span>{item.blockedReason}</span></p>
              {item.needsLeadership ? <p className="mt-2 text-xs font-medium text-cue-700">Flagged for leadership attention — it will appear in the leadership brief.</p> : null}
              <Button className="mt-3" disabled={pending} onClick={() => go({ type: "unblock" }, "Unblocked and back in progress.")}><Play className="size-4" aria-hidden /> Unblock</Button>
            </div>
          ) : null}
          {item.status === "complete" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-soft">Completed{item.completedOn ? ` on ${formatDay(item.completedOn, { year: true })}` : ""} · {hoursLabel(item.hoursSpent)} logged.</p>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => go({ type: "reopen" }, "Reopened. Its outcome will be re-measured when you complete it again.")}><RotateCcw className="size-3.5" aria-hidden /> Reopen</Button>
            </div>
          ) : null}

          {mode === "block" ? (
            <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); go({ type: "block", reason, needsLeadership: leadership }, "Marked as blocked."); }}>
              <Field label="What is it waiting on?" htmlFor="reason" error={error}>
                <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Web team must publish the tag container." required autoFocus />
              </Field>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={leadership} onChange={(e) => setLeadership(e.target.checked)} className="mt-1 size-4 accent-[var(--color-ink)]" />
                <span>Needs leadership attention<span className="block text-xs text-muted">Shown on the Command Center and in the leadership brief.</span></span>
              </label>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setMode("none")}>Cancel</Button><Button type="submit" variant="danger" disabled={pending}>Mark blocked</Button></div>
            </form>
          ) : null}
          {mode === "complete" ? (
            <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); go({ type: "complete", actualHours: Number(actual) }, "Completed. Cuework captured a baseline and will measure the outcome as new data arrives."); }}>
              <Field label="Actual hours spent" htmlFor="actual" hint="Used to keep future estimates and capacity honest." error={error}>
                <Input id="actual" type="number" inputMode="decimal" step="0.5" min="0" max="200" value={actual} onChange={(e) => setActual(e.target.value)} className="w-40" required autoFocus />
              </Field>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setMode("none")}>Cancel</Button><Button type="submit" variant="cue" disabled={pending}>Complete</Button></div>
            </form>
          ) : null}
        </div>

        {/* Traceability */}
        <div className="mt-7 space-y-6">
          <section>
            <Eyebrow>Strategic objective</Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed">{item.objective || "—"}</p>
          </section>
          <section>
            <Eyebrow>Expected outcome</Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed text-soft">{item.expectedOutcome || "—"}</p>
            {item.target ? <p className="mt-1.5 text-xs text-muted">Metric: <span className="font-medium text-soft">{item.target.label}</span></p> : null}
          </section>

          <section aria-labelledby="actual-outcome">
            <Eyebrow id="actual-outcome">Actual outcome</Eyebrow>
            {o && item.target ? (
              <div className="mt-2 rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={o.verdict} />
                  <EvidenceBadge strength={o.evidenceStrength} />
                </div>
                {o.verdict !== "pending" ? (
                  <p className="tabular mt-3 text-lg font-semibold">
                    {formatMetricValue(item.target.metric, o.baselineValue)} → {formatMetricValue(item.target.metric, o.currentValue)}
                    <span className={cn("ml-2 text-sm", o.verdict === "improved" ? "text-moss" : o.verdict === "declined" ? "text-brick" : "text-muted")}>{formatPct(o.changePct)}</span>
                  </p>
                ) : (
                  <p className="tabular mt-3 text-sm">Baseline: <strong>{formatMetricValue(item.target.metric, o.baselineValue)}</strong> {o.baselinePeriod ? `(${formatMonth(o.baselinePeriod)})` : ""}</p>
                )}
                <p className="mt-2 text-xs text-muted">
                  {o.verdict === "pending" ? "Awaiting the next month of data." : `${o.baselinePeriod ? formatMonth(o.baselinePeriod) : ""} → ${o.currentPeriod ? formatMonth(o.currentPeriod) : ""}.`} {o.note}
                </p>
                {o.verdict !== "pending" && o.evidenceStrength !== "experiment" ? <p className="mt-2 text-xs text-muted">{VERDICT_LABEL[o.verdict]} after the work shipped — this is not proof the work caused it.</p> : null}
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-muted">{item.status === "complete" ? "No metric was attached to this item, so there is nothing to measure." : "Recorded when the work is completed."}</p>
            )}
          </section>

          {item.recommendation ? (
            <section aria-labelledby="origin">
              <Eyebrow id="origin">Original recommendation &amp; evidence</Eyebrow>
              <p className="mt-1.5 text-sm leading-relaxed text-soft">{item.recommendation.rationale}</p>
              <dl className="mt-3 divide-y divide-line rounded-xl border border-line">
                {item.recommendation.evidence.map((e) => (
                  <div key={e.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5 text-sm">
                    <dt className="text-soft">{e.label}</dt>
                    <dd><span className="tabular font-semibold">{e.value}</span>{e.comparison ? <span className="ml-2 text-xs text-muted">{e.comparison}</span> : null}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/recommendations?tab=converted&r=${item.recommendation.id}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink underline underline-offset-4">
                <Link2 className="size-3.5" aria-hidden /> View in the recommendation inbox
              </Link>
            </section>
          ) : (
            <p className="text-xs text-muted">This is routine work added by the team, not from a recommendation.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
