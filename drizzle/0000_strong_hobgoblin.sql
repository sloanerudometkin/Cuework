CREATE TYPE "public"."category" AS ENUM('seo', 'aeo', 'sem', 'analytics', 'content');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('draft', 'committed');--> statement-breakpoint
CREATE TYPE "public"."data_source_kind" AS ENUM('demo', 'csv', 'ga4', 'gsc', 'google_ads');--> statement-breakpoint
CREATE TYPE "public"."data_source_status" AS ENUM('demo', 'imported', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('accept', 'defer', 'dismiss', 'refine', 'convert');--> statement-breakpoint
CREATE TYPE "public"."evidence_strength" AS ENUM('correlation', 'corroborated', 'experiment');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."plan_key" AS ENUM('starter', 'growth', 'scale');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('new', 'refining', 'accepted', 'converted', 'deferred', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."outcome_verdict" AS ENUM('improved', 'declined', 'flat', 'pending');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('backlog', 'committed', 'in_progress', 'blocked', 'complete');--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid,
	"kind" "data_source_kind" NOT NULL,
	"status" "data_source_status" NOT NULL,
	"label" text NOT NULL,
	"dataset" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"first_period" date,
	"last_period" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leadership_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"title" text NOT NULL,
	"headline" text NOT NULL,
	"content" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_org" UNIQUE("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"channel" text NOT NULL,
	"dimension" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"secondary_key" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"avg_position" double precision,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"planning_buffer" double precision DEFAULT 0.15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"target" jsonb NOT NULL,
	"baseline_value" double precision,
	"baseline_period" date,
	"current_value" double precision,
	"current_period" date,
	"change_pct" double precision,
	"verdict" "outcome_verdict" DEFAULT 'pending' NOT NULL,
	"evidence_strength" "evidence_strength" DEFAULT 'correlation' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"measured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_work_item_id_unique" UNIQUE("work_item_id")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"conversion_label" text DEFAULT 'Conversions' NOT NULL,
	"strategic_weight" integer DEFAULT 3 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"decision" "decision_kind" NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_by_name" text DEFAULT '' NOT NULL,
	"defer_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"comparison" text,
	"snapshot_id" uuid,
	"data_source_id" uuid
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"category" "category" NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"expected_outcome" text NOT NULL,
	"next_step" text NOT NULL,
	"why_now" text NOT NULL,
	"target" jsonb NOT NULL,
	"impact" integer NOT NULL,
	"effort" integer NOT NULL,
	"urgency" integer NOT NULL,
	"strategic" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"estimated_hours" double precision NOT NULL,
	"suggested_owner_role" text NOT NULL,
	"priority_score" double precision NOT NULL,
	"status" "recommendation_status" DEFAULT 'new' NOT NULL,
	"defer_until" date,
	"based_on_period" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan" "plan_key" DEFAULT 'starter' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"role_key" text DEFAULT 'coordinator' NOT NULL,
	"default_weekly_hours" double precision DEFAULT 40 NOT NULL,
	"default_reserved_hours" double precision DEFAULT 8 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weekly_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_member_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"total_hours" double precision NOT NULL,
	"reserved_hours" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "capacity_member_week" UNIQUE("team_member_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "weekly_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "commitment_status" DEFAULT 'draft' NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by_name" text,
	"plannable_hours" double precision,
	"planned_hours" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitments_org_week" UNIQUE("org_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"commitment_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "category" NOT NULL,
	"status" "work_status" DEFAULT 'backlog' NOT NULL,
	"assignee_id" uuid,
	"estimated_hours" double precision NOT NULL,
	"hours_spent" double precision DEFAULT 0 NOT NULL,
	"priority_score" double precision DEFAULT 0 NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"expected_outcome" text DEFAULT '' NOT NULL,
	"target" jsonb,
	"blocked_reason" text,
	"needs_leadership" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_reports" ADD CONSTRAINT "leadership_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_decisions" ADD CONSTRAINT "recommendation_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_decisions" ADD CONSTRAINT "recommendation_decisions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_decisions" ADD CONSTRAINT "recommendation_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_snapshot_id_metric_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."metric_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_capacity" ADD CONSTRAINT "weekly_capacity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_capacity" ADD CONSTRAINT "weekly_capacity_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_commitments" ADD CONSTRAINT "weekly_commitments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_commitment_id_weekly_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."weekly_commitments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_id_team_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_sources_org_idx" ON "data_sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "reports_org_idx" ON "leadership_reports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshots_property_period_idx" ON "metric_snapshots" USING btree ("property_id","period_start");--> statement-breakpoint
CREATE INDEX "snapshots_source_idx" ON "metric_snapshots" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "outcomes_org_idx" ON "outcomes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "decisions_org_idx" ON "recommendation_decisions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_rec_idx" ON "recommendation_evidence" USING btree ("recommendation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_org_fingerprint" ON "recommendations" USING btree ("org_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recommendations_org_status_idx" ON "recommendations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "team_members_org_idx" ON "team_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "work_items_org_status_idx" ON "work_items" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "work_items_commitment_idx" ON "work_items" USING btree ("commitment_id");