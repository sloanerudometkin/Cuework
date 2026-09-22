import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import { properties, recommendations, workItems } from "@/lib/db/schema";
import { weekStart as toWeekStart } from "@/lib/domain/dates";
import { getPlan } from "@/lib/domain/entitlements";
import { getWeekPlan } from "./planning";
import { loadWorkspace } from "./workspace";

export interface ShellData {
  orgName: string;
  isDemo: boolean;
  planName: string;
  planKey: string;
  openRecommendations: number;
  blockedWork: number;
  weekUtilization: number | null;
  weekStatus: "healthy" | "tight" | "over" | null;
}

/** Lightweight counts for the sidebar (rendered on every page). */
export async function getShellData(db: Db, orgId: string, now = new Date()): Promise<ShellData> {
  const ws = await loadWorkspace(db, orgId);
  const activeIds = ws.properties.map((p) => p.id);
  let open = 0;
  if (activeIds.length) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(recommendations)
      .where(and(eq(recommendations.orgId, orgId), inArray(recommendations.status, ["new", "refining"]), inArray(recommendations.propertyId, activeIds)));
    open = row?.n ?? 0;
  }
  const [blocked] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workItems)
    .innerJoin(properties, eq(properties.id, workItems.propertyId))
    .where(and(eq(workItems.orgId, orgId), eq(workItems.status, "blocked")));
  const plan = await getWeekPlan(db, orgId, toWeekStart(now));
  return {
    orgName: ws.org.name,
    isDemo: ws.org.isDemo,
    planName: getPlan(ws.planKey).name,
    planKey: ws.planKey,
    openRecommendations: open,
    blockedWork: blocked?.n ?? 0,
    weekUtilization: plan.summary.totalPlannable > 0 ? plan.summary.utilization : null,
    weekStatus: plan.commitment ? plan.summary.status : null,
  };
}
