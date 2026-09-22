import { SquareKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { WorkBoard, type BoardItem } from "@/components/work-board";
import { buttonStyles } from "@/components/ui/button";
import { requireWorkspace } from "@/lib/auth/session";
import { toISODate } from "@/lib/domain/dates";
import { getWorkDetail, listWork } from "@/lib/services/work";

export const metadata: Metadata = { title: "Work Board" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const sp = await searchParams;
  const { db, orgId } = await requireWorkspace();
  const work = await listWork(db, orgId);

  const items: BoardItem[] = await Promise.all(
    work.map(async (w) => {
      const d = await getWorkDetail(db, orgId, w.id);
      const rec = d?.recommendation ?? null;
      const o = d?.outcome ?? null;
      return {
        id: w.id,
        title: w.title,
        status: w.status,
        category: w.category,
        propertyName: w.propertyName,
        assigneeName: w.assigneeName,
        estimatedHours: w.estimatedHours,
        hoursSpent: w.hoursSpent,
        priorityScore: w.priorityScore,
        weekStart: w.weekStart,
        blockedReason: w.blockedReason,
        needsLeadership: w.needsLeadership,
        objective: w.objective,
        expectedOutcome: w.expectedOutcome,
        target: w.target,
        completedOn: w.completedAt ? toISODate(w.completedAt) : null,
        recommendation: rec
          ? { id: rec.id, rationale: rec.rationale, nextStep: rec.nextStep, whyNow: rec.whyNow, basedOnPeriod: rec.basedOnPeriod, evidence: (d?.evidence ?? []).map((e) => ({ id: e.id, label: e.label, value: e.value, comparison: e.comparison })) }
          : null,
        outcome: o
          ? { baselineValue: o.baselineValue, baselinePeriod: o.baselinePeriod, currentValue: o.currentValue, currentPeriod: o.currentPeriod, changePct: o.changePct, verdict: o.verdict, evidenceStrength: o.evidenceStrength, note: o.note }
          : null,
      };
    }),
  );

  const open = items.filter((i) => i.status !== "complete");
  const blocked = items.filter((i) => i.status === "blocked").length;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Work board"
        title="Where the work stands"
        description={
          open.length
            ? `${open.length} open ${open.length === 1 ? "item" : "items"}${blocked ? `, ${blocked} blocked` : ""}. Every card keeps its link to the recommendation, evidence and outcome that produced it.`
            : "Work created from accepted recommendations shows up here."
        }
        actions={
          <Link href="/plan" className={buttonStyles({ variant: "secondary" })}>
            Open weekly plan
          </Link>
        }
      />
      {items.length ? (
        <WorkBoard items={items} openId={sp.w && items.some((i) => i.id === sp.w) ? sp.w : null} />
      ) : (
        <EmptyState
          icon={SquareKanban}
          title="No work yet"
          action={
            <Link href="/recommendations" className={buttonStyles({})}>
              Review recommendations
            </Link>
          }
        >
          Accept a recommendation and it becomes a work item here, ready to be scheduled into a capacity-checked weekly plan.
        </EmptyState>
      )}
    </div>
  );
}
