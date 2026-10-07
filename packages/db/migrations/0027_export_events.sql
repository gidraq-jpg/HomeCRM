CREATE TABLE "export_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"household_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counts" jsonb NOT NULL,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "export_events_scope" CHECK ((kind='personal' AND household_id IS NULL) OR (kind='household' AND household_id IS NOT NULL)),
	CONSTRAINT "export_events_counts" CHECK (jsonb_typeof(counts)='object' AND size_bytes>=0)
);
--> statement-breakpoint
ALTER TABLE "export_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_events" ADD CONSTRAINT "export_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_events" ADD CONSTRAINT "export_events_household_id_spaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "export_events_select" ON "export_events" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((kind='personal' AND account_id=app.current_account_id()) OR (kind='household' AND household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))));--> statement-breakpoint
CREATE POLICY "export_events_insert" ON "export_events" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id=app.current_account_id() AND (kind='personal' OR household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))));
--> statement-breakpoint
GRANT SELECT ON export_events TO homecrm_app;
GRANT INSERT (account_id,kind,household_id,counts,size_bytes) ON export_events TO homecrm_app;
