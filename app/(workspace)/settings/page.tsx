import { CreditCard, Link2Off } from "lucide-react";
import type { Metadata } from "next";
import { SourceBadge } from "@/components/domain/badges";
import { PageHeader } from "@/components/domain/page-header";
import { ArchivePropertyButton, MemberDialog, OrgForm, PlanSwitcher, PropertyDialog, RemoveMemberButton } from "@/components/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { formatMonth } from "@/lib/domain/dates";
import { checkLimit, PLANS } from "@/lib/domain/entitlements";
import { loadWorkspace, sourceLabel } from "@/lib/services/workspace";
import { hoursLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const CONNECTORS = [
  { name: "Google Analytics 4", detail: "Sessions, conversions and landing pages" },
  { name: "Google Search Console", detail: "Queries, impressions, clicks and positions" },
  { name: "Google Ads", detail: "Campaigns, keywords, spend and conversions" },
];

function Section({ id, title, description, action, children }: { id: string; title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6">
      <Card>
        <CardHeader className="items-center">
          <div>
            <CardTitle id={`${id}-h`} className="text-base">{title}</CardTitle>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          {action}
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </section>
  );
}

export default async function SettingsPage() {
  const { db, orgId } = await requireWorkspace();
  const ws = await loadWorkspace(db, orgId);
  const plan = PLANS[ws.planKey];
  const sub = ws.subscription;
  const canAddProperty = checkLimit(ws.planKey, "properties", ws.usage).allowed;
  const canAddMember = checkLimit(ws.planKey, "teamMembers", ws.usage).allowed;
  const propName = new Map(ws.properties.map((p) => [p.id, p.name]));

  const usage = [
    { label: "Properties", used: ws.usage.properties, limit: plan.limits.properties },
    { label: "Team members", used: ws.usage.teamMembers, limit: plan.limits.teamMembers },
    { label: "CSV imports this month", used: ws.usage.importsThisMonth, limit: plan.limits.importsPerMonth },
  ];

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Workspace" title="Settings" description="Your organization, team, properties, data sources and plan." />
      <div className="space-y-6">
        <Section id="organization" title="Organization">
          <OrgForm name={ws.org.name} bufferPct={Math.round(ws.org.planningBuffer * 100)} />
        </Section>

        <Section id="team" title="Team members" description="Each person's default weekly capacity. Override it for any single week in the plan." action={<MemberDialog trigger="add" canAdd={canAddMember} />}>
          {!canAddMember ? <p className="mb-3 rounded-lg bg-cue-soft px-3 py-2 text-[13px] text-cue-700">{checkLimit(ws.planKey, "teamMembers", ws.usage).message}</p> : null}
          <ul className="divide-y divide-line">
            {ws.team.map((m) => (
              <li key={m.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted">{m.title || "—"} · {m.roleKey}</p>
                </div>
                <p className="tabular hidden text-sm text-soft sm:block">{hoursLabel(m.defaultWeeklyHours)} − {hoursLabel(m.defaultReservedHours)} = <strong className="text-ink">{hoursLabel(m.defaultWeeklyHours - m.defaultReservedHours)}</strong> plannable</p>
                <MemberDialog trigger="edit" member={{ id: m.id, name: m.name, title: m.title, roleKey: m.roleKey, defaultWeeklyHours: m.defaultWeeklyHours, defaultReservedHours: m.defaultReservedHours }} />
                {ws.team.length > 1 ? <RemoveMemberButton id={m.id} name={m.name} /> : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="properties" title="Properties" description="The brands and websites in this workspace." action={<PropertyDialog trigger="add" canAdd={canAddProperty} />}>
          {!canAddProperty ? <p className="mb-3 rounded-lg bg-cue-soft px-3 py-2 text-[13px] text-cue-700">{checkLimit(ws.planKey, "properties", ws.usage).message}</p> : null}
          {ws.properties.length ? (
            <ul className="divide-y divide-line">
              {ws.properties.map((p) => (
                <li key={p.id} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted">{p.domain || "No domain"} · weight {p.strategicWeight}/5 · {p.conversionLabel}</p>
                  </div>
                  <PropertyDialog trigger="edit" property={{ id: p.id, name: p.name, kind: p.kind, domain: p.domain, goal: p.goal, conversionLabel: p.conversionLabel, strategicWeight: p.strategicWeight }} />
                  <ArchivePropertyButton id={p.id} name={p.name} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No properties yet. Add your first brand or website to get started.</p>
          )}
        </Section>

        <Section id="data" title="Data sources" description="Where your numbers come from. Every number in Cuework says which of these it came from.">
          {ws.dataSources.length ? (
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th scope="col" className="pb-2 pr-3 font-semibold">Source</th><th scope="col" className="pb-2 pr-3 font-semibold">Property</th><th scope="col" className="pb-2 pr-3 text-right font-semibold">Rows</th><th scope="col" className="pb-2 pr-3 font-semibold">Coverage</th><th scope="col" className="pb-2 font-semibold">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {ws.dataSources.map((d) => (
                    <tr key={d.id} className="align-top">
                      <td className="py-2.5 pr-3 font-medium">{d.label}</td>
                      <td className="py-2.5 pr-3 text-soft">{d.propertyId ? (propName.get(d.propertyId) ?? "Archived") : "—"}</td>
                      <td className="tabular py-2.5 pr-3 text-right">{d.rowCount.toLocaleString()}</td>
                      <td className="py-2.5 pr-3 text-soft">{d.firstPeriod && d.lastPeriod ? `${formatMonth(d.firstPeriod, { short: true })} – ${formatMonth(d.lastPeriod, { short: true })}` : "—"}</td>
                      <td className="py-2.5"><SourceBadge status={d.status} /><span className="sr-only">{sourceLabel(d.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No data yet. Import a CSV to add your first source.</p>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <Eyebrow>Live connections</Eyebrow>
            <ul className="mt-3 grid gap-3 md:grid-cols-3">
              {CONNECTORS.map((c) => (
                <li key={c.name} className="rounded-xl border border-dashed border-line-strong p-4">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{c.name}</p><Badge tone="outline"><Link2Off className="size-3" aria-hidden />Not connected</Badge></div>
                  <p className="mt-1.5 text-xs text-muted">{c.detail}</p>
                  <p className="mt-3 text-xs font-medium text-soft">Coming soon</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Direct connections aren&apos;t available in this version. The import pipeline is built so a connector can write into the same tables — nothing here is simulated as live.</p>
          </div>
        </Section>

        <Section id="plan" title="Subscription" description="Limits below are enforced across the app.">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <p className="text-lg font-semibold">{plan.name} plan</p>
            <Badge tone="outline">{sub?.interval === "year" ? "Billed annually" : "Billed monthly"}</Badge>
            {sub?.simulated ? <Badge tone="cue">Simulated billing — no payment taken</Badge> : null}
          </div>
          <dl className="mb-7 grid gap-4 sm:grid-cols-3">
            {usage.map((u) => {
              const pct = Number.isFinite(u.limit) ? Math.min(100, (u.used / u.limit) * 100) : 0;
              const full = Number.isFinite(u.limit) && u.used >= u.limit;
              return (
                <div key={u.label}>
                  <dt className="text-xs text-muted">{u.label}</dt>
                  <dd className="tabular mt-0.5 text-sm font-semibold">{u.used} <span className="font-normal text-muted">of {Number.isFinite(u.limit) ? u.limit : "unlimited"}</span></dd>
                  {Number.isFinite(u.limit) ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden><div className={full ? "h-full bg-cue" : "h-full bg-ink"} style={{ width: `${pct}%` }} /></div> : null}
                </div>
              );
            })}
          </dl>
          <PlanSwitcher current={ws.planKey} interval={(sub?.interval as "month" | "year") ?? "month"} />
          <p className="mt-4 text-xs text-muted">A downgrade is refused until your usage fits the smaller plan — Cuework never deletes your data to make a plan change work.</p>
        </Section>

        <Section id="billing" title="Billing">
          <div className="flex items-start gap-3 text-sm text-soft">
            <CreditCard className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium text-ink">Payment method and invoices — coming soon</p>
              <p className="mt-1">This build uses a simulated billing layer: plan changes take effect immediately and no card is collected. A Stripe integration slots in behind the same plan-change function.</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
