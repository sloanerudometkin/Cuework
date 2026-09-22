"use client";

import { Check, Copy, Printer, Save } from "lucide-react";
import * as React from "react";
import { EvidenceBadge, VerdictBadge } from "@/components/domain/badges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveBriefAction } from "@/lib/actions/workspace";
import { formatMonth } from "@/lib/domain/dates";
import type { Sentiment } from "@/lib/domain/metrics";
import { briefToMarkdown, type BriefContent } from "@/lib/domain/reporting";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";

const TONE: Record<Sentiment, string> = { good: "text-moss", bad: "text-brick", neutral: "text-muted" };

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-9 border-b border-line pb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted print:mt-6">{children}</h2>;
}

export function BriefView({ brief, savedNote, readOnly }: { brief: BriefContent; savedNote?: string; readOnly?: boolean }) {
  const toast = useToast();
  const { run, pending } = useAction();
  const [note, setNote] = React.useState(savedNote ?? "");
  const [copied, setCopied] = React.useState(false);
  const markdown = React.useMemo(() => briefToMarkdown(brief, note), [brief, note]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      toast.success("Copied. Paste it into an email, a doc or your slide notes.");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Your browser blocked copying. Select the text in the brief and copy it manually.");
    }
  };

  return (
    <div>
      {!readOnly ? (
        <div className="no-print mb-6 rounded-xl border border-line bg-surface p-4 shadow-card">
          <label htmlFor="note" className="mb-1.5 block text-[13px] font-medium">Note for leadership <span className="font-normal text-muted">(optional — appears at the top of the brief)</span></label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1500} placeholder="e.g. Two things I need from you this month are the IT ticket and approval to shift $2.8k of budget." className="min-h-20" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy for email"}</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print / save as PDF</Button>
            <Button variant="secondary" disabled={pending} onClick={() => run(() => saveBriefAction(note), { success: "Saved as a new version." })}><Save className="size-4" aria-hidden /> {pending ? "Saving…" : "Save this version"}</Button>
          </div>
        </div>
      ) : (
        <div className="no-print mb-6 flex flex-wrap gap-2">
          <Button onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy for email"}</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print / save as PDF</Button>
        </div>
      )}

      <article className="rounded-2xl border border-line bg-surface px-6 py-8 shadow-card sm:px-10 sm:py-10 print-plain" aria-label="Leadership brief">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{brief.orgName} · Leadership brief</p>
        <h1 className="mt-2 text-2xl leading-tight sm:text-[1.9rem]">{brief.headline}</h1>
        <p className="mt-3 text-sm text-muted">Performance: {brief.performanceWindow}<br />Activity: {brief.activityWindow}</p>

        {note.trim() ? <blockquote className="mt-6 border-l-4 border-cue pl-4 text-[15px] italic text-soft">{note.trim()}</blockquote> : null}

        <H>Summary</H>
        <ul className="space-y-2 text-[15px] leading-relaxed">
          {brief.summary.map((s, i) => (
            <li key={i} className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />{s}</li>
          ))}
        </ul>

        <H>What changed</H>
        <div className="space-y-5">
          {brief.properties.map((p) => (
            <div key={p.propertyId} className="rounded-xl border border-line p-4 print:break-inside-avoid">
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-sm text-soft">{p.takeaway}</p>
              {p.kpis.length ? (
                <table className="tabular mt-3 w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th scope="col" className="pb-1 text-left font-medium">Metric</th><th scope="col" className="pb-1 text-right font-medium">{formatMonth(brief.period, { short: true })}</th><th scope="col" className="pb-1 text-right font-medium">vs. last month</th><th scope="col" className="pb-1 text-right font-medium">vs. last year</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {p.kpis.map((k) => (
                      <tr key={k.label}><th scope="row" className="py-1.5 text-left font-normal text-soft">{k.label}</th><td className="py-1.5 text-right font-semibold">{k.value}</td><td className={cn("py-1.5 text-right", TONE[k.momSentiment])}>{k.mom}</td><td className={cn("py-1.5 text-right", TONE[k.yoySentiment])}>{k.yoy}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))}
        </div>
        {brief.declines.length ? (<><p className="mb-1.5 mt-5 text-sm font-semibold">Declines (year over year)</p><ul className="list-disc space-y-1 pl-5 text-sm text-soft marker:text-brick">{brief.declines.map((d, i) => <li key={i}>{d}</li>)}</ul></>) : null}
        {(brief.anomalies ?? []).length ? (<><p className="mb-1.5 mt-5 text-sm font-semibold">Anomalies</p><ul className="list-disc space-y-1 pl-5 text-sm text-soft marker:text-cue-700">{(brief.anomalies ?? []).map((d, i) => <li key={i}>{d}</li>)}</ul></>) : null}
        {brief.wins.length ? (<><p className="mb-1.5 mt-5 text-sm font-semibold">Improvements (year over year)</p><ul className="list-disc space-y-1 pl-5 text-sm text-soft marker:text-moss">{brief.wins.map((d, i) => <li key={i}>{d}</li>)}</ul></>) : null}

        <H>What the team completed</H>
        {brief.completed.length ? (
          <ul className="space-y-4">
            {brief.completed.map((c, i) => (
              <li key={i} className="print:break-inside-avoid">
                <p className="text-[15px] font-medium leading-snug">{c.title}</p>
                <p className="mt-0.5 text-sm text-muted">{c.property} · {c.hours}h · finished {c.completedOn}</p>
                {c.outcome && c.outcome.verdict !== "pending" ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular">{c.outcome.metric}: {c.outcome.baseline} → <strong>{c.outcome.current}</strong> ({c.outcome.change})</span>
                    <VerdictBadge verdict={c.outcome.verdict} />
                    <EvidenceBadge strength={c.outcome.evidence} />
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-muted">{c.hasMetric !== false ? "Outcome awaiting enough data to measure." : "Routine work — no metric attached."}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing was completed in this window.</p>
        )}

        <H>Decisions made</H>
        {brief.decisions.length ? (
          <ul className="space-y-2.5 text-sm">
            {brief.decisions.map((d, i) => (
              <li key={i}><strong className="font-semibold">{d.decision}:</strong> {d.title} <span className="text-muted">({d.property}, {d.on})</span>{d.rationale ? <span className="block text-soft">“{d.rationale}”</span> : null}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No decisions were recorded in this window.</p>
        )}

        <H>Blocked</H>
        {brief.blocked.length ? (
          <ul className="space-y-2.5 text-sm">
            {brief.blocked.map((b, i) => (
              <li key={i}><strong className="font-semibold">{b.title}</strong> <span className="text-muted">({b.property}, owner {b.owner})</span><span className="block text-soft">{b.reason}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing is blocked.</p>
        )}

        <H>Where leadership attention is needed</H>
        {brief.leadershipAsks.length ? (
          <ul className="space-y-3">
            {brief.leadershipAsks.map((a, i) => (
              <li key={i} className="rounded-xl border border-cue/40 bg-cue-soft px-4 py-3 print:break-inside-avoid"><p className="font-semibold">{a.title}</p><p className="mt-0.5 text-sm text-soft"><span className="font-medium text-ink">{a.property}.</span> {a.detail}</p></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing needs leadership intervention this period.</p>
        )}

        <H>What happens next — {brief.nextWeek.week}</H>
        {brief.nextWeek.items.length ? (
          <>
            <p className="mb-2 text-sm text-soft">{brief.nextWeek.committedHours}h of {brief.nextWeek.plannableHours}h available capacity {brief.nextWeek.status === "committed" ? "committed" : "planned (draft — not yet committed)"}.</p>
            <ul className="space-y-1.5 text-sm">
              {brief.nextWeek.items.map((it, i) => (<li key={i} className="flex justify-between gap-4"><span>{it.title} <span className="text-muted">({it.property}, {it.owner})</span></span><span className="tabular shrink-0 text-muted">{it.hours}h</span></li>))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">No plan has been committed for the coming week.</p>
        )}

        <H>How to read this</H>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
          {brief.caveats.map((c, i) => <li key={i}>{c}</li>)}
          <li>Data: {brief.sources.join("; ")}.</li>
        </ul>
      </article>
    </div>
  );
}
