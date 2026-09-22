import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  dataSources,
  metricSnapshots,
  organizations,
  properties,
  subscriptions,
  teamMembers,
} from "@/lib/db/schema";
import { latestPeriod } from "@/lib/domain/metrics";
import { getPlan, type PlanKey, type Usage } from "@/lib/domain/entitlements";
import type { Channel, Dimension, Snapshot } from "@/lib/domain/types";

export interface Actor {
  userId: string | null;
  name: string;
}

export type DbOrTx = Db;

export type PropertyRow = typeof properties.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type DataSourceRow = typeof dataSources.$inferSelect;

export interface Workspace {
  org: typeof organizations.$inferSelect;
  planKey: PlanKey;
  subscription: typeof subscriptions.$inferSelect | null;
  properties: PropertyRow[];
  team: TeamMemberRow[];
  dataSources: DataSourceRow[];
  snapshots: Snapshot[];
  period: string | null;
  usage: Usage;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "invalid" | "limit" | "forbidden" | "conflict" = "invalid",
  ) {
    super(message);
  }
}

export function rowToSnapshot(r: typeof metricSnapshots.$inferSelect): Snapshot {
  return {
    id: r.id,
    propertyId: r.propertyId,
    dataSourceId: r.dataSourceId,
    periodStart: r.periodStart,
    channel: r.channel as Channel,
    dimension: r.dimension as Dimension,
    key: r.key,
    secondaryKey: r.secondaryKey,
    impressions: r.impressions,
    clicks: r.clicks,
    sessions: r.sessions,
    conversions: r.conversions,
    cost: r.cost,
    avgPosition: r.avgPosition,
    attrs: r.attrs ?? {},
  };
}

export async function loadSnapshots(db: Db, orgId: string, propertyIds?: string[]): Promise<Snapshot[]> {
  const rows = await db.select().from(metricSnapshots).where(eq(metricSnapshots.orgId, orgId));
  const all = rows.map(rowToSnapshot);
  return propertyIds ? all.filter((s) => propertyIds.includes(s.propertyId)) : all;
}

export async function importsThisMonth(db: Db, orgId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dataSources)
    .where(and(eq(dataSources.orgId, orgId), eq(dataSources.kind, "csv"), gte(dataSources.createdAt, start)));
  return row?.n ?? 0;
}

export async function loadWorkspace(db: Db, orgId: string): Promise<Workspace> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new ServiceError("Workspace not found", "not_found");

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  const props = await db
    .select()
    .from(properties)
    .where(and(eq(properties.orgId, orgId), isNull(properties.archivedAt)))
    .orderBy(properties.createdAt);
  const team = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)))
    .orderBy(teamMembers.createdAt);
  const sources = await db.select().from(dataSources).where(eq(dataSources.orgId, orgId)).orderBy(dataSources.createdAt);
  const activeIds = props.map((p) => p.id);
  const snapshots = await loadSnapshots(db, orgId, activeIds);
  const planKey = (sub?.plan ?? "starter") as PlanKey;

  return {
    org,
    planKey,
    subscription: sub ?? null,
    properties: props,
    team,
    dataSources: sources,
    snapshots,
    period: latestPeriod(snapshots),
    usage: {
      properties: props.length,
      teamMembers: team.length,
      importsThisMonth: await importsThisMonth(db, orgId),
    },
  };
}

export function planOf(ws: Pick<Workspace, "planKey">) {
  return getPlan(ws.planKey);
}

/** Labels a data source for the UI's Demo / Imported / Connected badges. */
export function sourceLabel(status: DataSourceRow["status"]): "Demo data" | "Imported data" | "Connected data" | "Error" {
  return status === "demo" ? "Demo data" : status === "imported" ? "Imported data" : status === "connected" ? "Connected data" : "Error";
}

/** Which kind of data does a property's numbers come from? Demo wins over imported for honesty. */
export function propertySourceStatus(ws: Pick<Workspace, "dataSources">, propertyId: string): DataSourceRow["status"] | null {
  const mine = ws.dataSources.filter((d) => d.propertyId === propertyId);
  if (!mine.length) return null;
  if (mine.some((d) => d.status === "demo")) return "demo";
  if (mine.some((d) => d.status === "imported")) return "imported";
  if (mine.some((d) => d.status === "connected")) return "connected";
  return mine[0].status;
}
