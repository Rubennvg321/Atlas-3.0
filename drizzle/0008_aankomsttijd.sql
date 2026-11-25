CREATE TABLE "arrival_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"montage_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"chosen_time" text,
	"chosen_at" timestamp with time zone,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminded_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"sent_time" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arrival_requests" ADD CONSTRAINT "arrival_requests_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrival_requests" ADD CONSTRAINT "arrival_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arrival_traject_date_uq" ON "arrival_requests" USING btree ("traject_id","montage_date");--> statement-breakpoint
CREATE INDEX "arrival_status_idx" ON "arrival_requests" USING btree ("status");