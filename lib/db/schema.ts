import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MetricTarget, SnapshotAttrs } from "@/lib/domain/types";
import type { BriefContent } from "@/lib/domain/reporting";

/**
 * Traceability chain (every arrow is a foreign key):
 *   data_source → metric_snapshot ← recommendation_evidence → recommendation
 *   recommendation → recommendation_decision
 *   recommendation → work_item → outcome
 *   work_item/outcome/decision → leadership_report (content references IDs)
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const planKey = pgEnum("plan_key", ["starter", "growth", "scale"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const dataSourceKind = pgEnum("data_source_kind", ["demo", "csv", "ga4", "gsc", "google_ads"]);
export const dataSourceStatus = pgEnum("data_source_status", ["demo", "imported", "connected", "error"]);
export const recStatus = pgEnum("recommendation_status", ["new", "refining", "accepted", "converted", "deferred", "dismissed"]);
export const decisionKind = pgEnum("decision_kind", ["accept", "defer", "dismiss", "refine", "convert"]);
export const workStatus = pgEnum("work_status", ["backlog", "committed", "in_progress", "blocked", "complete"]);
export const commitmentStatus = pgEnum("commitment_status", ["draft", "committed"]);
export const category = pgEnum("category", ["seo", "aeo", "sem", "analytics", "content"]);
export const verdict = pgEnum("outcome_verdict", ["improved", "declined", "flat", "pending"]);
export const evidenceStrength = pgEnum("evidence_strength", ["correlation", "corroborated", "experiment"]);

// --- Identity & tenancy -----------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** scrypt$N$salt$hash — null for accounts that only use demo access. */
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Share of capacity kept free when planning (0.15 = plan to 85%). */
  planningBuffer: doublePrecision("planning_buffer").notNull().default(0.15),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [unique("memberships_user_org").on(t.userId, t.orgId)],
);

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  orgId: uuid("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  plan: planKey("plan").notNull().default("starter"),
  interval: text("interval").notNull().default("month"),
  status: text("status").notNull().default("active"),
  /** True until a real payment provider is wired: no money moves. */
  simulated: boolean("simulated").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Portfolio --------------------------------------------------------------

export const properties = pgTable(
  "properties",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("other"),
    domain: text("domain").notNull().default(""),
    /** What this property is trying to achieve — grounds recommendations and reports. */
    goal: text("goal").notNull().default(""),
    /** Label for the conversion that matters here, e.g. "Ticket bookings". */
    conversionLabel: text("conversion_label").notNull().default("Conversions"),
    /** 1–5: how central this property is to organisational goals. Feeds prioritisation. */
    strategicWeight: integer("strategic_weight").notNull().default(3),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("properties_org_idx").on(t.orgId)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    roleKey: text("role_key").notNull().default("coordinator"),
    defaultWeeklyHours: doublePrecision("default_weekly_hours").notNull().default(40),
    /** Standing meetings / BAU that always eat into the week. */
    defaultReservedHours: doublePrecision("default_reserved_hours").notNull().default(8),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("team_members_org_idx").on(t.orgId)],
);

// --- Data -------------------------------------------------------------------

export const dataSources = pgTable(
  "data_sources",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "cascade" }),
    kind: dataSourceKind("kind").notNull(),
    status: dataSourceStatus("status").notNull(),
    label: text("label").notNull(),
    dataset: text("dataset"),
    rowCount: integer("row_count").notNull().default(0),
    firstPeriod: date("first_period", { mode: "string" }),
    lastPeriod: date("last_period", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("data_sources_org_idx").on(t.orgId)],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    channel: text("channel").notNull(),
    dimension: text("dimension").notNull(),
    key: text("key").notNull().default(""),
    secondaryKey: text("secondary_key"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    conversions: doublePrecision("conversions").notNull().default(0),
    cost: doublePrecision("cost").notNull().default(0),
    avgPosition: doublePrecision("avg_position"),
    attrs: jsonb("attrs").$type<SnapshotAttrs>().notNull().default({}),
  },
  (t) => [
    index("snapshots_property_period_idx").on(t.propertyId, t.periodStart),
    index("snapshots_source_idx").on(t.dataSourceId),
  ],
);

// --- Recommendations --------------------------------------------------------

export const recommendations = pgTable(
  "recommendations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    category: category("category").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    expectedOutcome: text("expected_outcome").notNull(),
    nextStep: text("next_step").notNull(),
    whyNow: text("why_now").notNull(),
    target: jsonb("target").$type<MetricTarget>().notNull(),
    impact: integer("impact").notNull(),
    effort: integer("effort").notNull(),
    urgency: integer("urgency").notNull(),
    strategic: integer("strategic").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    estimatedHours: doublePrecision("estimated_hours").notNull(),
    suggestedOwnerRole: text("suggested_owner_role").notNull(),
    priorityScore: doublePrecision("priority_score").notNull(),
    status: recStatus("status").notNull().default("new"),
    deferUntil: date("defer_until", { mode: "string" }),
    /** Reporting month the evidence was computed for. */
    basedOnPeriod: date("based_on_period", { mode: "string" }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recommendations_org_fingerprint").on(t.orgId, t.fingerprint),
    index("recommendations_org_status_idx").on(t.orgId, t.status),
  ],
);

export const recommendationEvidence = pgTable(
  "recommendation_evidence",
  {
    id: id(),
    recommendationId: uuid("recommendation_id").notNull().references(() => recommendations.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    value: text("value").notNull(),
    comparison: text("comparison"),
    /** Optional pointer at the exact source row. */
    snapshotId: uuid("snapshot_id").references(() => metricSnapshots.id, { onDelete: "set null" }),
    /** Where the number came from, so it can be labelled Demo / Imported / Connected. */
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
  },
  (t) => [index("evidence_rec_idx").on(t.recommendationId)],
);

export const recommendationDecisions = pgTable(
  "recommendation_decisions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").notNull().references(() => recommendations.id, { onDelete: "cascade" }),
    decision: decisionKind("decision").notNull(),
    rationale: text("rationale").notNull().default(""),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name").notNull().default(""),
    deferUntil: date("defer_until", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_org_idx").on(t.orgId, t.createdAt)],
);

// --- Planning & execution ---------------------------------------------------

export const weeklyCommitments = pgTable(
  "weekly_commitments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: commitmentStatus("status").notNull().default("draft"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    committedByName: text("committed_by_name"),
    /** Plannable hours and planned hours at the moment of commitment. */
    plannableHours: doublePrecision("plannable_hours"),
    plannedHours: doublePrecision("planned_hours"),
    createdAt: createdAt(),
  },
  (t) => [unique("commitments_org_week").on(t.orgId, t.weekStart)],
);

export const weeklyCapacity = pgTable(
  "weekly_capacity",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    teamMemberId: uuid("team_member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    totalHours: doublePrecision("total_hours").notNull(),
    reservedHours: doublePrecision("reserved_hours").notNull(),
    note: text("note").notNull().default(""),
  },
  (t) => [unique("capacity_member_week").on(t.teamMemberId, t.weekStart)],
);

export const workItems = pgTable(
  "work_items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").references(() => recommendations.id, { onDelete: "set null" }),
    commitmentId: uuid("commitment_id").references(() => weeklyCommitments.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: category("category").notNull(),
    status: workStatus("status").notNull().default("backlog"),
    assigneeId: uuid("assignee_id").references(() => teamMembers.id, { onDelete: "set null" }),
    estimatedHours: doublePrecision("estimated_hours").notNull(),
    hoursSpent: doublePrecision("hours_spent").notNull().default(0),
    priorityScore: doublePrecision("priority_score").notNull().default(0),
    /** Position within the week's plan (0 = first). */
    rank: integer("rank").notNull().default(0),
    /** The strategic objective this serves, in the property's own words. */
    objective: text("objective").notNull().default(""),
    expectedOutcome: text("expected_outcome").notNull().default(""),
    target: jsonb("target").$type<MetricTarget>(),
    blockedReason: text("blocked_reason"),
    needsLeadership: boolean("needs_leadership").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("work_items_org_status_idx").on(t.orgId, t.status),
    index("work_items_commitment_idx").on(t.commitmentId),
  ],
);

// --- Outcomes & reporting ---------------------------------------------------

export const outcomes = pgTable(
  "outcomes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().unique().references(() => workItems.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
    target: jsonb("target").$type<MetricTarget>().notNull(),
    baselineValue: doublePrecision("baseline_value"),
    baselinePeriod: date("baseline_period", { mode: "string" }),
    currentValue: doublePrecision("current_value"),
    currentPeriod: date("current_period", { mode: "string" }),
    changePct: doublePrecision("change_pct"),
    verdict: verdict("verdict").notNull().default("pending"),
    evidenceStrength: evidenceStrength("evidence_strength").notNull().default("correlation"),
    note: text("note").notNull().default(""),
    measuredAt: timestamp("measured_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("outcomes_org_idx").on(t.orgId)],
);

export const leadershipReports = pgTable(
  "leadership_reports",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    headline: text("headline").notNull(),
    content: jsonb("content").$type<BriefContent>().notNull(),
    markdown: text("markdown").notNull(),
    /** Free-text note the author adds for leadership. */
    note: text("note").notNull().default(""),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("reports_org_idx").on(t.orgId, t.createdAt)],
);
