"use server";

import { z } from "zod";
import { DATASETS, type DatasetId } from "@/lib/domain/csv";
import { PLAN_KEYS, type PlanKey } from "@/lib/domain/entitlements";
import { resetDemoWorkspace } from "@/lib/seed/demo";
import { importDataset, previewDataset } from "@/lib/services/imports";
import { decideRecommendation, refreshRecommendations, type DecisionInput } from "@/lib/services/recommendations";
import { saveWeekPlan } from "@/lib/services/planning";
import { measureOutcomes } from "@/lib/services/outcomes";
import { saveBrief } from "@/lib/services/reports";
import {
  addProperty,
  addTeamMember,
  archiveProperty,
  changePlan,
  removeTeamMember,
  updateOrganization,
  updateProperty,
  updateTeamMember,
  type MemberInput,
  type PropertyInput,
} from "@/lib/services/settings";
import { transitionWork, type WorkAction } from "@/lib/services/work";
import { ServiceError } from "@/lib/services/workspace";
import { createSession } from "@/lib/auth/session";
import { act } from "./helpers";

const uuid = z.string().uuid();

export async function decideAction(recommendationId: string, input: DecisionInput) {
  return act(async ({ db, orgId, actor }) => {
    uuid.parse(recommendationId);
    return decideRecommendation(db, { orgId, actor, recommendationId, input });
  });
}

export async function refreshRecommendationsAction() {
  return act(async ({ db, orgId }) => refreshRecommendations(db, orgId));
}

export async function savePlanAction(input: {
  weekStart: string;
  commit: boolean;
  items: { id: string; assigneeId: string | null }[];
  capacity: { memberId: string; totalHours: number; reservedHours: number; note?: string }[];
}) {
  return act(async ({ db, orgId, actor }) => {
    const summary = await saveWeekPlan(db, { orgId, actor, ...input });
    return { totalPlanned: summary.totalPlanned, totalPlannable: summary.totalPlannable };
  });
}

export async function workAction(id: string, action: WorkAction) {
  return act(async ({ db, orgId }) => {
    uuid.parse(id);
    return transitionWork(db, { orgId, id, action });
  });
}

export async function remeasureOutcomesAction() {
  return act(async ({ db, orgId }) => measureOutcomes(db, orgId));
}

export async function saveBriefAction(note: string) {
  return act(async ({ db, orgId, actor }) => {
    const row = await saveBrief(db, { orgId, actor, note });
    return { id: row.id };
  });
}

// --- CSV import ---------------------------------------------------------------

const MAX_BYTES = 4 * 1024 * 1024;

function readCsvForm(formData: FormData) {
  const dataset = String(formData.get("dataset") ?? "") as DatasetId;
  const propertyId = String(formData.get("propertyId") ?? "");
  const file = formData.get("file");
  if (!DATASETS.includes(dataset)) throw new ServiceError("Choose which kind of data this file contains.");
  if (!(file instanceof File) || file.size === 0) throw new ServiceError("Choose a CSV file to upload.");
  if (file.size > MAX_BYTES) throw new ServiceError("That file is larger than 4 MB. Split it by month and import each part.");
  return { dataset, propertyId, file };
}

export async function previewImportAction(formData: FormData) {
  return act(async () => {
    const { dataset, file } = readCsvForm(formData);
    const p = previewDataset(dataset, await file.text());
    return { fileName: file.name, totalRows: p.totalRows, validRows: p.sample.length, errors: p.errors, fatal: p.fatal, months: p.months, sample: p.sample.map((r) => ({ month: r.periodStart, key: r.key || r.channel, secondary: r.secondaryKey, impressions: r.impressions, clicks: r.clicks, sessions: r.sessions, conversions: r.conversions, cost: r.cost })) };
  });
}

export async function importAction(formData: FormData) {
  return act(async ({ db, orgId }) => {
    const { dataset, propertyId, file } = readCsvForm(formData);
    return importDataset(db, { orgId, propertyId, dataset, csv: await file.text(), fileName: file.name });
  });
}

// --- Settings -------------------------------------------------------------------

export async function addPropertyAction(input: PropertyInput) {
  return act(async ({ db, orgId }) => (await addProperty(db, orgId, input)).id);
}
export async function updatePropertyAction(id: string, input: PropertyInput) {
  return act(async ({ db, orgId }) => (await updateProperty(db, orgId, id, input)).id);
}
export async function archivePropertyAction(id: string) {
  return act(async ({ db, orgId }) => (await archiveProperty(db, orgId, id)).id);
}
export async function addMemberAction(input: MemberInput) {
  return act(async ({ db, orgId }) => (await addTeamMember(db, orgId, input)).id);
}
export async function updateMemberAction(id: string, input: MemberInput) {
  return act(async ({ db, orgId }) => (await updateTeamMember(db, orgId, id, input)).id);
}
export async function removeMemberAction(id: string) {
  return act(async ({ db, orgId }) => removeTeamMember(db, orgId, id));
}
export async function updateOrgAction(input: { name: string; planningBufferPct: number }) {
  return act(async ({ db, orgId }) => updateOrganization(db, orgId, input));
}
export async function changePlanAction(plan: PlanKey, interval: "month" | "year") {
  return act(async ({ db, orgId }) => {
    if (!PLAN_KEYS.includes(plan)) throw new ServiceError("Unknown plan.");
    return changePlan(db, orgId, plan, interval);
  });
}

/** Demo workspaces only: rebuilds the fictional data so people can start the walkthrough again. */
export async function resetDemoAction() {
  return act(async ({ db, orgId }) => {
    const { organizations } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org?.isDemo) throw new ServiceError("Only the demo workspace can be reset.", "forbidden");
    const res = await resetDemoWorkspace(db);
    await createSession(res.userId, res.orgId);
    return res.orgId;
  });
}
