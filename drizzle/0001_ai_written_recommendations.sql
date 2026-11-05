ALTER TABLE "recommendations" ADD COLUMN "ai_written" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "source_hash" text;