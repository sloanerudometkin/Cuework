"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/domain/entitlements";
import { cn } from "@/lib/utils";

const CTA: Record<PlanKey, string> = { starter: "Start with Starter", growth: "Start with Growth", scale: "Start with Scale" };

export function PricingCards() {
  const [annual, setAnnual] = React.useState(true);
  return (
    <div>
      <div className="mb-10 flex justify-center">
        <div className="inline-flex rounded-full bg-sunken p-1" role="group" aria-label="Billing interval">
          {[false, true].map((a) => (
            <button key={String(a)} type="button" aria-pressed={annual === a} onClick={() => setAnnual(a)} className={cn("rounded-full px-4 py-2 text-sm font-medium transition-colors", annual === a ? "bg-surface text-ink shadow-card" : "text-soft hover:text-ink")}>
              {a ? "Annual" : "Monthly"}{a ? <span className="ml-1.5 text-xs font-semibold text-moss">save ~17%</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
        {PLAN_KEYS.map((k) => {
          const p = PLANS[k];
          const hi = Boolean(p.highlighted);
          const price = annual ? p.annualMonthlyPrice : p.monthlyPrice;
          return (
            <div key={k} className={cn("relative flex flex-col rounded-2xl p-7", hi ? "bg-ink text-white shadow-pop lg:-my-3 lg:py-10" : "border border-line bg-surface shadow-card")}>
              {hi ? <Badge tone="cue" className="absolute -top-3 left-7 bg-cue text-ink">Most popular for multi-brand teams</Badge> : null}
              <h3 className={cn("text-xl", hi ? "text-white" : "text-ink")}>{p.name}</h3>
              <p className={cn("mt-1 text-sm", hi ? "text-side-text" : "text-muted")}>{p.audience}</p>
              <p className="tabular mt-6 flex items-baseline gap-1">
                <span className="text-5xl font-semibold tracking-tight">${price}</span>
                <span className={cn("text-sm", hi ? "text-side-muted" : "text-muted")}>/ month{annual ? ", billed annually" : ""}</span>
              </p>
              <p className={cn("mt-4 text-[16.8px] leading-snug", hi ? "text-side-text" : "text-soft")}>{p.tagline}</p>
              <Link href="/signup" className={cn(buttonStyles({ variant: hi ? "cue" : "primary", size: "lg" }), "mt-6 w-full")}>{CTA[k]}</Link>
              <ul className="mt-7 space-y-3 border-t pt-6 text-sm" style={{ borderColor: hi ? "rgb(255 255 255 / 0.12)" : "var(--color-line)" }}>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5"><Check className={cn("mt-0.5 size-4 shrink-0", hi ? "text-cue" : "text-moss")} aria-hidden /><span className={hi ? "text-side-text" : "text-soft"}>{f}</span></li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const yes = (v: boolean | string) => (typeof v === "string" ? <span className="text-sm">{v}</span> : v ? <Check className="mx-auto size-4 text-moss" aria-label="Included" /> : <Minus className="mx-auto size-4 text-line-strong" aria-label="Not included" />);
const num = (n: number) => (Number.isFinite(n) ? String(n) : "Unlimited");

export function ComparisonTable() {
  const L = (k: PlanKey) => PLANS[k].limits;
  const rows: { label: string; values: (boolean | string)[] }[] = [
    { label: "Properties (brands / websites)", values: PLAN_KEYS.map((k) => num(L(k).properties)) },
    { label: "Team members", values: PLAN_KEYS.map((k) => num(L(k).teamMembers)) },
    { label: "CSV imports per month", values: PLAN_KEYS.map((k) => num(L(k).importsPerMonth)) },
    { label: "Open recommendations shown", values: PLAN_KEYS.map((k) => num(L(k).openRecommendations)) },
    { label: "Recommendation inbox with evidence", values: [true, true, true] },
    { label: "Weekly commitments that respect capacity", values: [true, true, true] },
    { label: "Work board linked to evidence", values: [true, true, true] },
    { label: "Basic performance reporting", values: [true, true, true] },
    { label: "Portfolio intelligence across brands", values: PLAN_KEYS.map((k) => L(k).portfolioIntelligence) },
    { label: "Outcome tracking (correlation vs. proof)", values: PLAN_KEYS.map((k) => L(k).outcomeTracking) },
    { label: "Leadership briefs", values: PLAN_KEYS.map((k) => L(k).leadershipBriefs) },
    { label: "Approval workflows", values: ["—", "—", "Coming soon"] },
    { label: "Custom reporting", values: ["—", "—", "Coming soon"] },
    { label: "Support", values: ["Email", "Email", "Priority"] },
  ];
  return (
    <div className="thin-scroll overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[640px] text-left">
        <caption className="sr-only">Plan comparison</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-4 text-sm font-semibold">Feature</th>
            {PLAN_KEYS.map((k) => (
              <th key={k} scope="col" className={cn("px-5 py-4 text-center text-sm font-semibold", PLANS[k].highlighted && "bg-sunken/60")}>{PLANS[k].name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="px-5 py-3 text-sm font-normal text-soft">{r.label}</th>
              {r.values.map((v, i) => (
                <td key={i} className={cn("tabular px-5 py-3 text-center", PLANS[PLAN_KEYS[i]].highlighted && "bg-sunken/60")}>{yes(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
