import { ArrowRight, CalendarCheck, FileText, Inbox, Layers, Scale } from "lucide-react";
import Link from "next/link";
import { CapacityMeter } from "@/components/domain/capacity-meter";
import { PriorityChip } from "@/components/domain/priority";
import { PublicFooter, PublicHeader } from "@/components/public-chrome";
import { buttonStyles } from "@/components/ui/button";

const LOOP = ["Data", "Recommendation", "Priority", "Weekly commitment", "Completed work", "Leadership report"];

const FEATURES = [
  { icon: Inbox, title: "Recommendations with receipts", body: "Deterministic analysis of your search, paid and analytics data produces expert-style actions — each with its evidence, rationale, confidence, effort and the metric it should move." },
  { icon: Scale, title: "Prioritisation under constraints", body: "Impact, urgency, strategic fit, confidence and effort become one explainable score, then meet the one thing dashboards ignore: how many hours your team actually has." },
  { icon: CalendarCheck, title: "A plan that refuses to overcommit", body: "Set capacity per person per week. Cuework shows hours used and left, warns as you approach the limit, and won't let you commit a week your team can't finish." },
  { icon: Layers, title: "Work connected to outcomes", body: "Every task keeps its link to the evidence that justified it. When it ships, Cuework measures the metric — and says plainly whether that is correlation or proof." },
  { icon: FileText, title: "Reports that write themselves from facts", body: "A leadership brief assembled from performance, decisions, completed work, blockers and next week's plan. Copy it into an email or print it." },
];

export function LandingPage() {
  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:py-24">
            <div>
              <p className="text-[12.32px] font-semibold uppercase tracking-[0.1em] text-cue">Marketing operating system</p>
              <h1 className="mt-4 text-4xl leading-[1.08] sm:text-5xl lg:text-[3.4rem]">Turn scattered marketing data into work your team can <span className="text-cue">actually finish.</span></h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-side-text">For small teams running several brands. Cuework turns fragmented data into expert priorities, realistic weekly commitments, completed work and leadership-ready reporting — in one place.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className={buttonStyles({ variant: "cue", size: "lg" })}>Explore the demo <ArrowRight className="size-4" aria-hidden /></Link>
                <Link href="/pricing" className={buttonStyles({ variant: "onDark", size: "lg" })}>See pricing</Link>
              </div>
              <p className="mt-4 text-sm text-side-muted">The demo uses clearly labelled fictional data. No integration is live.</p>
            </div>

            <div className="rounded-2xl bg-surface p-6 text-ink shadow-pop" aria-label="Illustration of the weekly plan">
              <p className="text-[12.32px] font-semibold uppercase tracking-[0.08em] text-muted">Illustration · a week that can&apos;t be over-committed</p>
              <div className="mt-4 space-y-4">
                {[{ n: "Maya", p: 26.5, c: 28, s: "tight" as const }, { n: "Jordan", p: 31, c: 26, s: "over" as const }].map((m) => (
                  <div key={m.n}>
                    <p className="mb-1.5 text-sm font-medium">{m.n}</p>
                    <CapacityMeter planned={m.p} plannable={m.c} status={m.s} label={`${m.n}'s capacity`} />
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-brick/30 bg-brick-soft px-3.5 py-2.5 text-sm">Jordan is over capacity by 5h. <strong>Commit is blocked</strong> until the plan fits.</div>
              <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
                <PriorityChip score={91} size="sm" showLabel={false} />
                <p className="text-sm leading-snug">Investigate a 71% conversion drop with steady traffic</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8" aria-labelledby="loop">
          <h2 id="loop" className="text-center text-2xl">One connected loop, not five tools</h2>
          <ol className="mt-8 flex flex-wrap justify-center gap-x-2 gap-y-3">
            {LOOP.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium shadow-card">{s}</span>
                {i < LOOP.length - 1 ? <ArrowRight className="size-4 text-muted" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span className="grid size-10 place-items-center rounded-lg bg-sunken"><f.icon className="size-5" aria-hidden /></span>
                <h3 className="mt-4 text-[19.04px]">{f.title}</h3>
                <p className="mt-2 text-[16.8px] leading-relaxed text-soft">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line bg-sunken/60 px-5 py-16 text-center sm:px-8">
          <h2 className="mx-auto max-w-2xl text-3xl">The strategic clarity of a much larger team.</h2>
          <p className="mx-auto mt-3 max-w-xl text-soft">Built for the marketing manager and coordinator who own SEO, AEO, paid media, analytics and reporting across several brands.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={buttonStyles({ size: "lg" })}>Create a workspace</Link>
            <Link href="/pricing" className={buttonStyles({ variant: "secondary", size: "lg" })}>Compare plans</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
