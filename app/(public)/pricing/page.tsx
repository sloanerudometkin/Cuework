import type { Metadata } from "next";
import Link from "next/link";
import { ComparisonTable, PricingCards } from "@/components/pricing-cards";
import { buttonStyles } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Three plans for marketing teams: Starter for one brand, Growth for multi-brand teams, Scale for agencies and larger portfolios.",
};

const FAQ = [
  { q: "What counts as a property?", a: "One brand or website — for example a ferry site, an airport site or an authority site. Each gets its own data, recommendations and KPIs, and they roll up into one portfolio view." },
  { q: "Do I need Google integrations to start?", a: "No. Import CSV exports from Search Console, Google Ads or GA4 today. Direct connections are on the roadmap; every number is labelled Demo, Imported or Connected so you always know where it came from." },
  { q: "What happens if I hit a limit?", a: "Cuework tells you exactly which limit you reached and what the next plan adds. It never deletes data, and it won't let you downgrade to a plan your current usage doesn't fit." },
  { q: "Is billing live?", a: "Not in this version. Plan changes are simulated: limits are enforced for real, but no card is collected. A payment provider will plug in behind the same plan-change function." },
];

export default function PricingPage() {
  return (
    <div className="animate-rise">
      <section className="mx-auto max-w-6xl px-5 pb-6 pt-16 text-center sm:px-8 sm:pt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-cue-700">Pricing</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl leading-tight sm:text-5xl">Priced for the team you have, not the department you don&apos;t.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-soft">A two-person team should get the strategic clarity of a much larger SEO, AEO and paid-media group. Pick the plan that matches how many brands you run.</p>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8"><PricingCards /></section>

      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8" aria-labelledby="compare">
        <h2 id="compare" className="mb-6 text-2xl">Compare plans</h2>
        <ComparisonTable />
      </section>

      <section className="mx-auto max-w-3xl px-5 pb-20 sm:px-8" aria-labelledby="faq">
        <h2 id="faq" className="mb-6 text-2xl">Questions</h2>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium"><span>{f.q}</span><span aria-hidden className="text-xl leading-none text-muted transition-transform group-open:rotate-45">+</span></summary>
              <p className="mt-3 leading-relaxed text-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="bg-ink px-5 py-16 text-center sm:px-8">
        <h2 className="mx-auto max-w-2xl text-3xl text-white">See the whole loop with sample data first.</h2>
        <p className="mx-auto mt-3 max-w-xl text-side-text">Explore a fictional three-property workspace: recommendations, a capacity-checked weekly plan, completed work and a leadership brief.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/login" className={buttonStyles({ variant: "cue", size: "lg" })}>Explore the demo</Link>
          <Link href="/signup" className={buttonStyles({ variant: "onDark", size: "lg" })}>Create a workspace</Link>
        </div>
      </section>
    </div>
  );
}
