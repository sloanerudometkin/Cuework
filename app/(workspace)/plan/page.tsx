import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/domain/page-header";
import { PlanBuilder, PlanHeaderStatus } from "@/components/plan-builder";
import { buttonStyles } from "@/components/ui/button";
import { requireWorkspace } from "@/lib/auth/session";
import { addDays, formatWeek, weekStart } from "@/lib/domain/dates";
import { getWeekPlan } from "@/lib/services/planning";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Weekly Plan" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const { db, orgId } = await requireWorkspace();
  const thisWeek = weekStart(new Date());
  const valid = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) && !Number.isNaN(Date.parse(sp.week));
  const requested = valid ? weekStart(sp.week!) : thisWeek;
  const plan = await getWeekPlan(db, orgId, requested);
  const readOnly = plan.weekStart < thisWeek;
  const isCurrent = plan.weekStart === thisWeek;

  // Remount the client builder whenever the saved state changes so its local draft resets cleanly.
  const stateKey = [
    plan.weekStart,
    plan.commitment?.status,
    plan.commitment?.committedAt,
    plan.items.map((i) => `${i.id}:${i.assigneeId}:${i.status}`).join(","),
    plan.members.map((m) => `${m.totalHours}/${m.reservedHours}/${m.note}`).join(","),
  ].join("|");

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Weekly commitment"
        title="What can we realistically finish?"
        description="Set real capacity, choose work by priority, and Cuework won't let you commit more than your team can do."
        actions={
          <nav aria-label="Week" className="flex items-center gap-1.5">
            <Link href={`/plan?week=${addDays(plan.weekStart, -7)}`} aria-label="Previous week" className={cn(buttonStyles({ variant: "secondary", size: "icon" }))}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="tabular min-w-44 px-2 text-center text-sm font-medium">
              {formatWeek(plan.weekStart)}
              <span className="block text-xs font-normal text-muted">{isCurrent ? "This week" : readOnly ? "Past week" : "Upcoming"}</span>
            </span>
            <Link href={`/plan?week=${addDays(plan.weekStart, 7)}`} aria-label="Next week" className={cn(buttonStyles({ variant: "secondary", size: "icon" }))}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
            <PlanHeaderStatus plan={plan} />
          </nav>
        }
      />
      {readOnly ? <p className="mb-6 rounded-lg bg-sunken px-4 py-2.5 text-sm text-soft">This week has passed, so its plan is read-only. Anything unfinished is offered as carry-over when you plan the current week.</p> : null}
      <PlanBuilder key={stateKey} plan={plan} readOnly={readOnly} />
    </div>
  );
}
