CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"kind" text DEFAULT 'advies' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"status" text DEFAULT 'gepland' NOT NULL,
	"google_calendar_id" text,
	"google_event_id" text,
	"google_etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contact_points_kind_chk" CHECK ("contact_points"."kind" in ('email','phone'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"first_name" text,
	"infix" text,
	"last_name" text,
	"last_name_key" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"moved" jsonb NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"street" text,
	"house_number" integer,
	"house_number_addition" text,
	"postcode" text,
	"city" text,
	"country" text DEFAULT 'NL' NOT NULL,
	"street_key" text,
	"wefact_debtor_code" text,
	"source" text,
	"notes" text,
	"merged_into_id" uuid,
	"merged_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_a_id" uuid NOT NULL,
	"customer_b_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"signals" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"origin" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_order_chk" CHECK ("duplicate_candidates"."customer_a_id" < "duplicate_candidates"."customer_b_id")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text,
	"direction" text NOT NULL,
	"from_address" text,
	"to_addresses" text,
	"subject" text,
	"snippet" text,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "emails_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"local_table" text NOT NULL,
	"local_id" uuid NOT NULL,
	"etag" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text,
	"customer_id" uuid,
	"traject_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"account" text,
	"status" text DEFAULT 'niet_gekoppeld' NOT NULL,
	"encrypted_tokens" text,
	"cursor" text,
	"config" jsonb,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"wefact_id" text,
	"number" text,
	"amount_excl" numeric(12, 2),
	"amount_incl" numeric(12, 2),
	"status" text DEFAULT 'concept' NOT NULL,
	"quote_date" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"source" text NOT NULL,
	"user_id" uuid,
	"reason" text,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid NOT NULL,
	"to_stage" text NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"error_detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"traject_id" uuid,
	"customer_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"assignee_id" uuid,
	"done_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"traject_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trajects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "trajects_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" uuid NOT NULL,
	"title" text,
	"description" text,
	"stage" text NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lost_reason" text,
	"lost_note" text,
	"site_street" text,
	"site_house_number" integer,
	"site_house_number_addition" text,
	"site_postcode" text,
	"site_city" text,
	"source" text,
	"referral" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trajects_lost_reason_chk" CHECK ("trajects"."lost_reason" is null or "trajects"."lost_reason" in ('te_duur','geen_reactie','concurrent','anders'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'beheerder' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_survivor_id_customers_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_merged_id_customers_id_fk" FOREIGN KEY ("merged_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_customer_a_id_customers_id_fk" FOREIGN KEY ("customer_a_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_customer_b_id_customers_id_fk" FOREIGN KEY ("customer_b_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_proposals" ADD CONSTRAINT "stage_proposals_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_proposals" ADD CONSTRAINT "stage_proposals_to_stage_pipeline_stages_key_fk" FOREIGN KEY ("to_stage") REFERENCES "public"."pipeline_stages"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_proposals" ADD CONSTRAINT "stage_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_traject_id_trajects_id_fk" FOREIGN KEY ("traject_id") REFERENCES "public"."trajects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajects" ADD CONSTRAINT "trajects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajects" ADD CONSTRAINT "trajects_stage_pipeline_stages_key_fk" FOREIGN KEY ("stage") REFERENCES "public"."pipeline_stages"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_google_uq" ON "appointments" USING btree ("google_calendar_id","google_event_id") WHERE "appointments"."google_event_id" is not null;--> statement-breakpoint
CREATE INDEX "appointments_traject_idx" ON "appointments" USING btree ("traject_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "contact_points_lookup_idx" ON "contact_points" USING btree ("kind","normalized");--> statement-breakpoint
CREATE INDEX "contact_points_customer_idx" ON "contact_points" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_customer_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_last_name_key_idx" ON "contacts" USING btree ("last_name_key");--> statement-breakpoint
CREATE INDEX "customers_address_idx" ON "customers" USING btree ("postcode","house_number");--> statement-breakpoint
CREATE INDEX "customers_street_idx" ON "customers" USING btree ("street_key","house_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_wefact_debtor_uq" ON "customers" USING btree ("wefact_debtor_code") WHERE "customers"."wefact_debtor_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_uq" ON "duplicate_candidates" USING btree ("customer_a_id","customer_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_status_idx" ON "duplicate_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emails_traject_idx" ON "emails" USING btree ("traject_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_uq" ON "external_refs" USING btree ("provider","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_provider_external_uq" ON "inbound_items" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "notes_traject_idx" ON "notes" USING btree ("traject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_wefact_uq" ON "quotes" USING btree ("wefact_id") WHERE "quotes"."wefact_id" is not null;--> statement-breakpoint
CREATE INDEX "quotes_traject_idx" ON "quotes" USING btree ("traject_id");--> statement-breakpoint
CREATE INDEX "quotes_number_idx" ON "quotes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stage_changes_traject_idx" ON "stage_changes" USING btree ("traject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_proposals_ref_uq" ON "stage_proposals" USING btree ("traject_id","to_stage","ref_type","ref_id") WHERE "stage_proposals"."ref_id" is not null;--> statement-breakpoint
CREATE INDEX "tasks_traject_idx" ON "tasks" USING btree ("traject_id");--> statement-breakpoint
CREATE INDEX "tasks_open_idx" ON "tasks" USING btree ("done_at","due_at");--> statement-breakpoint
CREATE INDEX "timeline_traject_idx" ON "timeline_events" USING btree ("traject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_customer_idx" ON "timeline_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "trajects_customer_idx" ON "trajects" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "trajects_stage_idx" ON "trajects" USING btree ("stage");