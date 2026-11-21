CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"supplier" text NOT NULL,
	"order_number" text,
	"commission" text,
	"amount_excl" numeric(12, 2) NOT NULL,
	"order_date" timestamp with time zone,
	"source" text DEFAULT 'handmatig' NOT NULL,
	"gmail_message_id" text,
	"status" text DEFAULT 'gekoppeld' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trajects" ADD COLUMN "sale_amount_excl_manual" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "trajects" ADD COLUMN "montage_days_manual" integer;--> statement-breakpoint
ALTER TABLE "trajects" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trajects" ADD COLUMN "review_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trajects" ADD COLUMN "review_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_supplier_order_uq" ON "purchase_orders" USING btree ("supplier","order_number") WHERE "purchase_orders"."order_number" is not null;--> statement-breakpoint
CREATE INDEX "purchase_orders_traject_idx" ON "purchase_orders" USING btree ("traject_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");