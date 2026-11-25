ALTER TABLE "tasks" ADD COLUMN "due_has_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reminded_for" timestamp with time zone;