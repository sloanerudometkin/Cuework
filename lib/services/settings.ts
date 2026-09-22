import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/connect";
import { organizations, properties, subscriptions, teamMembers, workItems } from "@/lib/db/schema";
import {
  checkLimit,
  downgradeViolations,
  PLAN_KEYS,
  PLANS,
  type PlanKey,
} from "@/lib/domain/entitlements";
import { loadWorkspace, ServiceError } from "./workspace";

const propertySchema = z.object({
  name: z.string().trim().min(2, "Give the property a name.").max(80),
  kind: z.enum(["authority", "ferry", "airport", "retail", "media", "other"]).default("other"),
  domain: z.string().trim().max(120).default(""),
  goal: z.string().trim().max(240).default(""),
  conversionLabel: z.string().trim().min(1).max(60).default("Conversions"),
  strategicWeight: z.coerce.number().int().min(1).max(5).default(3),
});
export type PropertyInput = z.input<typeof propertySchema>;

export async function addProperty(db: Db, orgId: string, raw: PropertyInput) {
  const input = propertySchema.safeParse(raw);
  if (!input.success) throw new ServiceError(input.error.issues[0].message);
  const ws = await loadWorkspace(db, orgId);
  const limit = checkLimit(ws.planKey, "properties", ws.usage);
  if (!limit.allowed) throw new ServiceError(limit.message ?? "Property limit reached.", "limit");
  const [row] = await db.insert(properties).values({ orgId, ...input.data }).returning();
  return row;
}

export async function updateProperty(db: Db, orgId: string, id: string, raw: PropertyInput) {
  const input = propertySchema.safeParse(raw);
  if (!input.success) throw new ServiceError(input.error.issues[0].message);
  const [row] = await db
    .update(properties)
    .set(input.data)
    .where(and(eq(properties.id, id), eq(properties.orgId, orgId)))
    .returning();
  if (!row) throw new ServiceError("Property not found", "not_found");
  return row;
}

/** Archiving hides a property and frees a plan slot; its history is kept. */
export async function archiveProperty(db: Db, orgId: string, id: string) {
  const [row] = await db
    .update(properties)
    .set({ archivedAt: new Date() })
    .where(and(eq(properties.id, id), eq(properties.orgId, orgId), isNull(properties.archivedAt)))
    .returning();
  if (!row) throw new ServiceError("Property not found", "not_found");
  return row;
}

const memberSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  title: z.string().trim().max(80).default(""),
  roleKey: z.enum(["manager", "coordinator"]).default("coordinator"),
  defaultWeeklyHours: z.coerce.number().min(1, "Weekly hours must be at least 1.").max(80),
  defaultReservedHours: z.coerce.number().min(0).max(80),
});
export type MemberInput = z.input<typeof memberSchema>;

function checkMember(raw: MemberInput) {
  const input = memberSchema.safeParse(raw);
  if (!input.success) throw new ServiceError(input.error.issues[0].message);
  if (input.data.defaultReservedHours > input.data.defaultWeeklyHours) {
    throw new ServiceError("Reserved hours can't exceed weekly hours.");
  }
  return input.data;
}

export async function addTeamMember(db: Db, orgId: string, raw: MemberInput) {
  const data = checkMember(raw);
  const ws = await loadWorkspace(db, orgId);
  const limit = checkLimit(ws.planKey, "teamMembers", ws.usage);
  if (!limit.allowed) throw new ServiceError(limit.message ?? "Team member limit reached.", "limit");
  const [row] = await db.insert(teamMembers).values({ orgId, ...data }).returning();
  return row;
}

export async function updateTeamMember(db: Db, orgId: string, id: string, raw: MemberInput) {
  const data = checkMember(raw);
  const [row] = await db
    .update(teamMembers)
    .set(data)
    .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)))
    .returning();
  if (!row) throw new ServiceError("Team member not found", "not_found");
  return row;
}

/** Removing a person un-assigns their unfinished work so nothing is silently orphaned in a plan. */
export async function removeTeamMember(db: Db, orgId: string, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(teamMembers)
      .set({ isActive: false })
      .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)))
      .returning();
    if (!row) throw new ServiceError("Team member not found", "not_found");
    await tx
      .update(workItems)
      .set({ assigneeId: null })
      .where(and(eq(workItems.orgId, orgId), eq(workItems.assigneeId, id), ne(workItems.status, "complete")));
  });
}

export async function updateOrganization(db: Db, orgId: string, raw: { name: string; planningBufferPct: number }) {
  const name = raw.name.trim();
  if (name.length < 2 || name.length > 80) throw new ServiceError("Organization name must be 2–80 characters.");
  if (!(raw.planningBufferPct >= 0 && raw.planningBufferPct <= 40)) throw new ServiceError("Planning buffer must be between 0% and 40%.");
  await db.update(organizations).set({ name, planningBuffer: raw.planningBufferPct / 100 }).where(eq(organizations.id, orgId));
}

/**
 * Simulated plan change. No payment is taken; the limits, however, are real:
 * a downgrade is refused unless current usage already fits the target plan.
 */
export async function changePlan(db: Db, orgId: string, plan: PlanKey, interval: "month" | "year") {
  if (!PLAN_KEYS.includes(plan)) throw new ServiceError("Unknown plan.");
  const ws = await loadWorkspace(db, orgId);
  const violations = downgradeViolations(plan, ws.usage);
  if (violations.length) {
    throw new ServiceError(`Can't switch to ${PLANS[plan].name}: ${violations.map((v) => v.message).join(" ")}`, "limit");
  }
  await db
    .insert(subscriptions)
    .values({ orgId, plan, interval, simulated: true, status: "active", updatedAt: new Date() })
    .onConflictDoUpdate({ target: subscriptions.orgId, set: { plan, interval, simulated: true, status: "active", updatedAt: new Date() } });
}
