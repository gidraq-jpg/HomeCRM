CREATE TABLE "api_operations" (
	"account_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"operation" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_operations_account_id_key_pk" PRIMARY KEY("account_id","key"),
	CONSTRAINT "api_operations_operation" CHECK (operation IN ('contact_import','charge','payment')),
	CONSTRAINT "api_operations_fingerprint" CHECK (fingerprint ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "api_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_utility_source";--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "birthday_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "profile_account_id" uuid;--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_profile_account_id_member_profiles_account_id_fk" FOREIGN KEY ("profile_account_id") REFERENCES "public"."member_profiles"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_contact_id_unique" UNIQUE("contact_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_profile_account_id_unique" UNIQUE("profile_account_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_one_source" CHECK (num_nonnulls(note_id,object_id,document_id,contact_id,profile_account_id)=1);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_source" CHECK ((source_kind='birthday' AND num_nonnulls(contact_id,profile_account_id)=1 AND num_nonnulls(note_id,object_id,document_id,utility_account_id,meter_id,charge_id)=0) OR (contact_id IS NULL AND profile_account_id IS NULL AND ((source_kind='document' AND document_id IS NOT NULL AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (document_id IS NULL AND ((source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL AND (charge_id IS NULL OR source_kind='payment')) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL AND charge_id IS NULL))))))));--> statement-breakpoint
CREATE POLICY "deadlines_birthday_insert" ON "deadlines" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth()>0 AND source_kind='birthday' AND coalesce(contact_id,profile_account_id)=nullif(current_setting('app.birthday_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_birthday_update" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (pg_trigger_depth()>0 AND source_kind='birthday' AND coalesce(contact_id,profile_account_id)=nullif(current_setting('app.birthday_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth()>0 AND source_kind='birthday' AND coalesce(contact_id,profile_account_id)=nullif(current_setting('app.birthday_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "api_operations_select" ON "api_operations" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "api_operations_insert" ON "api_operations" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id=app.current_account_id());--> statement-breakpoint
ALTER POLICY "deadlines_select" ON "deadlines" TO homecrm_app USING (((((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (EXISTS (SELECT 1 FROM notes n WHERE n.id=note_id) OR EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id) OR EXISTS (SELECT 1 FROM documents doc WHERE doc.id=document_id) OR EXISTS (SELECT 1 FROM contacts c WHERE c.id=contact_id AND c.kind='person' AND c.deleted_at IS NULL AND c.data->>'birthdayEnabled'='true'))) OR EXISTS (SELECT 1 FROM member_profiles p WHERE p.account_id=profile_account_id AND p.birthday_enabled AND p.birth_date IS NOT NULL)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_update" ON "deadlines" TO homecrm_app USING ((deleted_at IS NULL AND (app.deadline_source_allowed(note_id, object_id, true))) OR (deleted_at IS NOT NULL AND app.deadline_source_allowed(note_id, object_id, true) AND (space_kind='personal' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=deadlines.space_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND (m.role='admin' OR (m.role='adult' AND deadlines.author_id=app.current_account_id()))))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid)) WITH CHECK ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_owner_select" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_owner_update" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);