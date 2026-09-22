import { FileText, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BriefView } from "@/components/brief-view";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { formatDay, toISODate } from "@/lib/domain/dates";
import { hasFeature } from "@/lib/domain/entitlements";
import { getReport, listReports, buildLiveBrief } from "@/lib/services/reports";
import { loadWorkspace, ServiceError } from "@/lib/services/workspace";

export const metadata: Metadata = { title: "Leadership Brief" };

export default async function BriefPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const { db, orgId } = await requireWorkspace();
  const ws = await loadWorkspace(db, orgId);

  if (!hasFeature(ws.planKey, "leadershipBriefs")) {
    return (
      <>
        <PageHeader eyebrow="Leadership brief" title="Reporting your leaders will read" description="Performance, decisions and completed work in one narrative you can paste into an email or a slide." />
        <Card>
          <CardBody className="flex flex-col items-start gap-3 py-8 sm:flex-row sm:items-center">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-cue-soft text-cue-700"><Lock className="size-5" aria-hidden /></span>
            <div className="flex-1">
              <p className="font-semibold">Leadership briefs are included in Growth and Scale</p>
              <p className="mt-1 max-w-xl text-sm text-soft">Your Starter plan includes the Performance page for basic reporting. Upgrade to generate briefs that connect results to decisions, completed work, blockers and next week&apos;s plan.</p>
            </div>
            <Link href="/settings#plan" className={buttonStyles({ variant: "cue" })}>Compare plans</Link>
          </CardBody>
        </Card>
      </>
    );
  }

  const saved = await listReports(db, orgId);
  let content;
  let savedNote: string | undefined;
  let viewing: (typeof saved)[number] | null = null;
  let live = true;
  let error: string | null = null;

  if (sp.v) {
    const r = await getReport(db, orgId, sp.v);
    if (r) {
      content = r.content;
      savedNote = r.note;
      live = false;
      viewing = saved.find((s) => s.id === r.id) ?? null;
    }
  }
  if (!content) {
    try {
      content = await buildLiveBrief(db, orgId);
    } catch (e) {
      if (e instanceof ServiceError) error = e.message;
      else throw e;
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Leadership brief"
        title={live ? "This month, in one page" : "Saved brief"}
        description={live ? "Built from your live data, decisions, completed work and plan. It updates as things change; save a version when you send it." : `Saved ${viewing ? formatDay(toISODate(viewing.createdAt), { year: true }) : ""}${viewing?.createdByName ? ` by ${viewing.createdByName}` : ""}. Saved versions never change.`}
        actions={!live ? <Link href="/brief" className={buttonStyles({ variant: "secondary" })}>Back to live brief</Link> : undefined}
      />
      {error || !content ? (
        <EmptyState icon={FileText} title="Nothing to report yet" action={<Link href="/import" className={buttonStyles({})}>Import data</Link>}>{error ?? "Import data first."}</EmptyState>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
          <BriefView key={sp.v ?? "live"} brief={content} savedNote={savedNote} readOnly={!live} />
          <aside className="no-print xl:sticky xl:top-8 xl:self-start" aria-labelledby="versions">
            <h2 id="versions" className="mb-3 text-sm font-semibold">Saved versions</h2>
            {saved.length ? (
              <ul className="space-y-2">
                {saved.map((r) => (
                  <li key={r.id}>
                    <Link href={`/brief?v=${r.id}`} aria-current={sp.v === r.id ? "page" : undefined} className="block rounded-xl border border-line bg-surface p-3 text-sm shadow-card transition-colors hover:border-line-strong aria-[current=page]:border-ink">
                      <span className="block font-medium leading-snug">{r.headline}</span>
                      <span className="mt-1 block text-xs text-muted">{formatDay(toISODate(r.createdAt), { year: true })} · {r.createdByName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing saved yet. Save a version to keep exactly what you sent.</p>
            )}
            <div className="mt-4"><Badge tone="outline">Deterministic summary — no AI text</Badge></div>
          </aside>
        </div>
      )}
    </div>
  );
}
