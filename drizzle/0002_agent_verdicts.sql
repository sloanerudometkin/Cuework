ALTER TABLE "recommendations" ADD COLUMN "agent_verdict" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "agent_note" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "agent_checks" jsonb;