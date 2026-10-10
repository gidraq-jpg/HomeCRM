CREATE TABLE "task_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"has_other_contributions" boolean DEFAULT false NOT NULL,
	"assignee_house_id" uuid GENERATED ALWAYS AS (CASE WHEN space_kind = 'household' THEN assignee_id END) STORED,
	"assignee_adult_id" uuid GENERATED ALWAYS AS (CASE WHEN audience = 'adults' THEN assignee_id END) STORED,
	"assignee_adult_flag" boolean GENERATED ALWAYS AS (CASE WHEN audience = 'adults' AND assignee_id IS NOT NULL THEN true END) STORED,
	"parent_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	"preview_storage_key" uuid,
	"preview_envelope" jsonb,
	CONSTRAINT "task_files_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "task_files_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "task_files_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "task_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_files_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "task_files_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "task_files_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_operations" DROP CONSTRAINT "api_operations_operation";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_utility_source";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_time" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_time" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "waiting_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "waiting_account_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "check_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files_history" ADD CONSTRAINT "task_files_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files_history" ADD CONSTRAINT "task_files_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."task_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_files_space_id_idx" ON "task_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "task_files_trash_idx" ON "task_files" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_files_parent_id_idx" ON "task_files" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "task_files_history_record_id_idx" ON "task_files_history" USING btree ("record_id","created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waiting_contact_id_contacts_id_fk" FOREIGN KEY ("waiting_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waiting_account_id_accounts_id_fk" FOREIGN KEY ("waiting_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_spaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_task_kind_key" UNIQUE("task_id","source_kind");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status" CHECK (status IN ('open','done','cancelled','not_done','waiting'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_clock" CHECK ((plan_time IS NULL OR (plan_on IS NOT NULL AND plan_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) AND (due_time IS NULL OR (due_on IS NOT NULL AND due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waiting" CHECK (num_nonnulls(waiting_contact_id,waiting_account_id)<=1 AND (status<>'waiting' OR check_on IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_checklist" CHECK (jsonb_typeof(checklist)='array');--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_operation" CHECK (operation IN ('contact_import','charge','payment','task_create','task_patch','task_status'));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_one_source" CHECK (num_nonnulls(note_id,object_id,document_id,contact_id,profile_account_id,task_id)=1);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_source" CHECK ((task_id IS NOT NULL AND source_kind IN ('task_plan','task_due','task_waiting') AND num_nonnulls(note_id,object_id,document_id,contact_id,profile_account_id,utility_account_id,meter_id,charge_id)=0) OR (task_id IS NULL AND ((source_kind='birthday' AND num_nonnulls(contact_id,profile_account_id)=1 AND num_nonnulls(note_id,object_id,document_id,utility_account_id,meter_id,charge_id)=0) OR (contact_id IS NULL AND profile_account_id IS NULL AND ((source_kind='document' AND document_id IS NOT NULL AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (document_id IS NULL AND ((source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL AND (charge_id IS NULL OR source_kind='payment')) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL AND charge_id IS NULL))))))))));--> statement-breakpoint
CREATE POLICY "tasks_deadline_worker_select" ON "tasks" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.task_id=tasks.id));--> statement-breakpoint
CREATE POLICY "deadlines_task_insert" ON "deadlines" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth()>0 AND task_id=nullif(current_setting('app.task_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_task_update" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (pg_trigger_depth()>0 AND task_id=nullif(current_setting('app.task_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth()>0 AND task_id=nullif(current_setting('app.task_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "task_files_select" ON "task_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "task_files_insert" ON "task_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
    OR assignee_id = app.current_account_id()
  )));--> statement-breakpoint
CREATE POLICY "task_files_update" ON "task_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
    OR assignee_id = app.current_account_id()
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
    OR assignee_id = app.current_account_id()
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
    OR assignee_id = app.current_account_id()
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
    OR assignee_id = app.current_account_id()
  ))));--> statement-breakpoint
CREATE POLICY "task_files_purge_select" ON "task_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "task_files_purge" ON "task_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "task_files_reassign_select" ON "task_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((task_files.space_kind = 'household' AND task_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = task_files.space_id AND l.account_id = task_files.assignee_id AND l.left_at IS NOT NULL
  )) OR (task_files.space_kind = 'household' AND task_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = task_files.space_id AND a.account_id = task_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "task_files_reassign" ON "task_files" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (task_files.space_kind = 'household' AND task_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = task_files.space_id AND l.account_id = task_files.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = task_files.space_id AND a.account_id = task_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "task_files_history_select" ON "task_files_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM task_files r WHERE r.id = task_files_history.record_id));--> statement-breakpoint
CREATE POLICY "task_files_history_insert" ON "task_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "task_files_history_worker_insert" ON "task_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
ALTER POLICY "deadlines_select" ON "deadlines" TO homecrm_app USING (((((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (EXISTS (SELECT 1 FROM notes n WHERE n.id=note_id) OR EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id) OR EXISTS (SELECT 1 FROM tasks t WHERE t.id=task_id) OR EXISTS (SELECT 1 FROM documents doc WHERE doc.id=document_id) OR EXISTS (SELECT 1 FROM contacts c WHERE c.id=contact_id AND c.kind='person' AND c.deleted_at IS NULL AND c.data->>'birthdayEnabled'='true'))) OR EXISTS (SELECT 1 FROM member_profiles p WHERE p.account_id=profile_account_id AND p.birthday_enabled AND p.birth_date IS NOT NULL)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_update" ON "deadlines" TO homecrm_app USING ((deleted_at IS NULL AND (app.deadline_source_allowed(note_id, object_id, true))) OR (deleted_at IS NOT NULL AND app.deadline_source_allowed(note_id, object_id, true) AND (space_kind='personal' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=deadlines.space_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND (m.role='admin' OR (m.role='adult' AND deadlines.author_id=app.current_account_id()))))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid)) WITH CHECK ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_owner_select" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_owner_update" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id,contact_id,profile_account_id,task_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);