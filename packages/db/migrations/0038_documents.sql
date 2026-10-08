CREATE TABLE "document_files" (
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
	CONSTRAINT "document_files_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "document_files_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "document_files_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "document_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_files_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "document_files_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "document_files_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
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
	"data" jsonb DEFAULT '{"type":"other","series":"","number":"","issuedBy":"","issuedOn":null,"expiresOn":null,"indefinite":false,"note":"","tags":[]}'::jsonb NOT NULL,
	"owner_account_id" uuid,
	"owner_contact_id" uuid,
	"owner_object_id" uuid,
	"previous_id" uuid,
	"status" text DEFAULT 'valid' NOT NULL,
	CONSTRAINT "documents_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "documents_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "documents_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL)),
	CONSTRAINT "documents_one_owner" CHECK (num_nonnulls(owner_account_id,owner_contact_id,owner_object_id)<=1),
	CONSTRAINT "documents_status" CHECK (status IN ('valid','invalid'))
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "documents_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "documents_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_utility_source";--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files_history" ADD CONSTRAINT "document_files_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files_history" ADD CONSTRAINT "document_files_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."document_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_object_id_objects_id_fk" FOREIGN KEY ("owner_object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_previous_id_documents_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_history" ADD CONSTRAINT "documents_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_history" ADD CONSTRAINT "documents_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_space_id_idx" ON "document_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "document_files_trash_idx" ON "document_files" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_files_parent_id_idx" ON "document_files" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "document_files_history_record_id_idx" ON "document_files_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_space_id_idx" ON "documents" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "documents_trash_idx" ON "documents" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_history_record_id_idx" ON "documents_history" USING btree ("record_id","created_at");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_document_id_unique" UNIQUE("document_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_one_source" CHECK (num_nonnulls(note_id,object_id,document_id)=1);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_source" CHECK ((source_kind='document' AND document_id IS NOT NULL AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (document_id IS NULL AND ((source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL AND (charge_id IS NULL OR source_kind='payment')) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL AND charge_id IS NULL))))));--> statement-breakpoint
CREATE POLICY "document_files_select" ON "document_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "document_files_insert" ON "document_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "document_files_update" ON "document_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))));--> statement-breakpoint
CREATE POLICY "document_files_purge_select" ON "document_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "document_files_purge" ON "document_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "document_files_reassign_select" ON "document_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((document_files.space_kind = 'household' AND document_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = document_files.space_id AND l.account_id = document_files.assignee_id AND l.left_at IS NOT NULL
  )) OR (document_files.space_kind = 'household' AND document_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = document_files.space_id AND a.account_id = document_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "document_files_reassign" ON "document_files" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (document_files.space_kind = 'household' AND document_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = document_files.space_id AND l.account_id = document_files.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = document_files.space_id AND a.account_id = document_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "document_files_history_select" ON "document_files_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM document_files r WHERE r.id = document_files_history.record_id));--> statement-breakpoint
CREATE POLICY "document_files_history_insert" ON "document_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "document_files_history_worker_insert" ON "document_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "documents_select" ON "documents" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "documents_insert" ON "documents" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "documents_update" ON "documents" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))));--> statement-breakpoint
CREATE POLICY "documents_purge_select" ON "documents" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "documents_purge" ON "documents" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "documents_reassign_select" ON "documents" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((documents.space_kind = 'household' AND documents.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = documents.space_id AND l.account_id = documents.assignee_id AND l.left_at IS NOT NULL
  )) OR (documents.space_kind = 'household' AND documents.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = documents.space_id AND a.account_id = documents.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "documents_reassign" ON "documents" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (documents.space_kind = 'household' AND documents.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = documents.space_id AND l.account_id = documents.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = documents.space_id AND a.account_id = documents.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "documents_deadline_worker_select" ON "documents" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.document_id=documents.id));--> statement-breakpoint
CREATE POLICY "documents_history_select" ON "documents_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM documents r WHERE r.id = documents_history.record_id));--> statement-breakpoint
CREATE POLICY "documents_history_insert" ON "documents_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "documents_history_worker_insert" ON "documents_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
ALTER POLICY "deadlines_select" ON "deadlines" TO homecrm_app USING ((((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (EXISTS (SELECT 1 FROM notes n WHERE n.id=note_id) OR EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id) OR EXISTS (SELECT 1 FROM documents doc WHERE doc.id=document_id))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_utility_insert" ON "deadlines" TO homecrm_app WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(document_id,charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_utility_update" ON "deadlines" TO homecrm_app USING (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(document_id,charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(document_id,charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_update" ON "deadlines" TO homecrm_app USING ((deleted_at IS NULL AND (app.deadline_source_allowed(note_id, object_id, true))) OR (deleted_at IS NOT NULL AND app.deadline_source_allowed(note_id, object_id, true) AND (space_kind='personal' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=deadlines.space_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND (m.role='admin' OR (m.role='adult' AND deadlines.author_id=app.current_account_id()))))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid)) WITH CHECK ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
ALTER POLICY "deadlines_owner_select" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_owner_update" ON "deadlines" TO homecrm_owner USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND coalesce(note_id,object_id,document_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','is_identity'];
BEGIN
  IF TG_TABLE_NAME='documents' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  -- Новый вид записи требует явного решения о содержательном вкладе.
  IF TG_TABLE_NAME NOT IN ('notes','note_items','shopping_items','tasks','objects','object_fields','object_events','note_files','object_files','contacts','utility_accounts','meters','meter_readings','utility_charges','utility_payments','documents','document_files') THEN
    RAISE EXCEPTION 'record contribution rules are not registered' USING ERRCODE = 'check_violation';
  END IF;
  -- Очистка контакта меняет только ссылку, в том числе у события в корзине.
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN
    IF NEW.contact_table IS NOT NULL OR NEW.contact_id IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
      RAISE EXCEPTION 'contact cleanup changes only the reference' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  NEW.has_other_contributions := OLD.has_other_contributions OR
    (pg_trigger_depth() > 1 AND NEW.has_other_contributions);
  IF app.current_account_id() IS NOT NULL AND
    (NEW.space_id IS DISTINCT FROM OLD.space_id OR NEW.space_kind IS DISTINCT FROM OLD.space_kind) THEN
    IF TG_ARGV[0] = 'root' OR (to_jsonb(NEW)->>'parent_id') IS DISTINCT FROM (to_jsonb(OLD)->>'parent_id') THEN
      IF OLD.space_kind = 'personal' AND NEW.space_kind = 'household' THEN
        IF NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = OLD.space_id AND s.owner_account_id = app.current_account_id()) THEN
          RAISE EXCEPTION 'only the owner can share a record' USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSIF OLD.space_kind = 'household' AND NEW.space_kind = 'personal' THEN
        IF OLD.author_id IS DISTINCT FROM app.current_account_id() OR OLD.has_other_contributions
          OR NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = NEW.space_id AND s.owner_account_id = app.current_account_id()) THEN
          RAISE EXCEPTION 'a record with other contributions cannot become personal' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME='documents' AND EXISTS(SELECT 1 FROM public.document_files f WHERE f.parent_id=OLD.id AND (f.author_id<>OLD.author_id OR f.has_other_contributions)) THEN RAISE EXCEPTION 'children have other contributions' USING ERRCODE='insufficient_privilege'; END IF;
        IF TG_TABLE_NAME = 'notes' AND (EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) OR EXISTS (SELECT 1 FROM public.note_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions))) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'objects' AND (
          EXISTS (SELECT 1 FROM public.meters i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.utility_accounts i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.object_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.object_fields i WHERE i.parent_id = OLD.id AND (i.author_id <> OLD.author_id OR i.has_other_contributions))
          OR EXISTS (SELECT 1 FROM public.object_events i WHERE i.parent_id = OLD.id AND (i.author_id <> OLD.author_id OR i.has_other_contributions))
        ) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSE
        RAISE EXCEPTION 'use a copy to change households or personal owners' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  IF app.current_account_id() IS NOT NULL AND app.current_account_id() <> OLD.author_id AND
    (OLD.space_kind = 'household' OR NEW.space_kind = 'household') AND
    (
      (TG_TABLE_NAME = 'notes' AND (NEW.title, to_jsonb(NEW)->>'body') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'body'))
      OR (TG_TABLE_NAME = 'note_items' AND
        (NEW.title, to_jsonb(NEW)->>'done', to_jsonb(NEW)->>'position', to_jsonb(NEW)->>'parent_id') IS DISTINCT FROM
        (OLD.title, to_jsonb(OLD)->>'done', to_jsonb(OLD)->>'position', to_jsonb(OLD)->>'parent_id'))
      OR (TG_TABLE_NAME = 'tasks' AND NEW.title IS DISTINCT FROM OLD.title)
      OR (TG_TABLE_NAME = 'objects' AND (NEW.title, to_jsonb(NEW)->'type_data', to_jsonb(NEW)->'object_type') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->'type_data', to_jsonb(OLD)->'object_type'))
      OR (TG_TABLE_NAME = 'shopping_items' AND (NEW.title, to_jsonb(NEW)->>'quantity', to_jsonb(NEW)->>'bought_at') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'quantity', to_jsonb(OLD)->>'bought_at'))
      OR (TG_TABLE_NAME IN ('object_fields', 'object_events','contacts','utility_accounts','meters','meter_readings','utility_charges','utility_payments','documents','document_files') AND (to_jsonb(NEW) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])) IS DISTINCT FROM (to_jsonb(OLD) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])))
    ) THEN
    NEW.has_other_contributions := true;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'id, author_id and created_at of a record cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    IF TG_ARGV[0] = 'child' AND NEW.deleted_at IS NULL AND OLD.space_kind = 'household' AND app.current_account_id() IS NOT NULL
      AND NOT coalesce((pg_trigger_depth() > 1
        AND TG_TABLE_NAME = current_setting('app.parent_restore_table',true)
        AND (to_jsonb(OLD)->>'parent_id') = current_setting('app.parent_restore_id',true)
        AND OLD.deleted_at = nullif(current_setting('app.parent_restore_time',true),'')::timestamptz),false)
      AND NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = OLD.space_id
        AND m.account_id = app.current_account_id() AND m.left_at IS NULL
        AND (m.role = 'admin' OR (m.role = 'adult' AND OLD.author_id = app.current_account_id()))) THEN
      RAISE EXCEPTION 'only the author or an administrator can restore a shared record'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_ARGV[0] = 'child' OR (TG_TABLE_NAME='documents' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'owner_object_id')=current_setting('app.document_object_id',true)) THEN
      ignored := ignored || ARRAY['space_id', 'space_kind', 'audience'];
      IF (NEW.space_id, NEW.space_kind, NEW.audience) IS DISTINCT FROM (OLD.space_id, OLD.space_kind, OLD.audience) THEN
        ignored := ignored || ARRAY['assignee_id'];
      END IF;
    END IF;
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'a record in the trash cannot be changed or moved; restore it first'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id','owner_contact_id','is_identity'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id','owner_contact_id','is_identity'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_TABLE_NAME='documents' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'previous_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meter_readings' THEN new_json := app.reading_decimal_json(new_json); END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND (pg_trigger_depth() > 1 OR current_user='homecrm_owner')
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments','documents') THEN
      RETURN NULL;
    END IF;
    operation := 'create';
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json - ARRAY['id', 'created_at']) AS e
      WHERE e.value <> 'null'::jsonb;
  ELSE
    IF OLD.space_kind <> 'household' AND NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments','documents') THEN
      RETURN NULL;
    END IF;
    old_json := to_jsonb(OLD) - hidden;
    IF TG_TABLE_NAME='meter_readings' THEN old_json := app.reading_decimal_json(old_json); END IF;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
    IF TG_TABLE_NAME='utility_accounts' AND (to_jsonb(NEW)->'supplier_id') IS DISTINCT FROM (to_jsonb(OLD)->'supplier_id') THEN
      changes := changes || jsonb_build_object('supplier_changed',jsonb_build_object('new',true));
    END IF;
    IF changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    operation := CASE
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'trash'
      WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore'
      WHEN OLD.space_id <> NEW.space_id OR OLD.space_kind <> NEW.space_kind THEN 'move'
      WHEN OLD.audience IS DISTINCT FROM NEW.audience THEN 'audience'
      ELSE 'update'
    END;
    -- Более узкое из двух мест.
    IF OLD.space_kind = 'personal' THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND OLD.space_id <> NEW.space_id THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND (OLD.audience = 'adults' OR NEW.audience = 'adults') THEN
      place_audience := 'adults';
    END IF;
  END IF;
  EXECUTE format(
    'INSERT INTO public.%I (record_id, space_id, space_kind, audience, actor_id, operation, changes) '
    'VALUES ($1, $2, $3, $4, $5, $6::public.history_operation, $7)',
    TG_TABLE_NAME || '_history'
  ) USING NEW.id, place_id, place_kind, place_audience, app.current_account_id(), operation, changes;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p record; tbl text; rid uuid; cascading boolean;
BEGIN
 cascading := pg_trigger_depth()>1 AND coalesce(NEW.note_id,NEW.object_id,NEW.document_id)=nullif(current_setting('app.deadline_source_id',true),'')::uuid;
 IF NEW.source_kind='document' AND current_user<>'homecrm_worker' AND NOT (current_user='homecrm_owner' AND cascading) THEN
  IF pg_trigger_depth()<2 OR NEW.document_id IS DISTINCT FROM nullif(current_setting('app.utility_source_id',true),'')::uuid THEN RAISE EXCEPTION 'edit document source instead' USING ERRCODE='insufficient_privilege'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.document_id,NEW.source_kind,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.document_id,OLD.source_kind,OLD.author_id,OLD.created_at) THEN RAISE EXCEPTION 'immutable document source' USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO p FROM public.documents WHERE id=NEW.document_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
  IF p.space_kind='household' THEN NEW.household_id:=p.space_id; END IF;
  NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
 END IF;
 IF NEW.source_kind<>'record' AND coalesce(NEW.charge_id,NEW.utility_account_id,NEW.meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') THEN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.object_id,NEW.source_kind,NEW.utility_account_id,NEW.meter_id,NEW.charge_id,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.object_id,OLD.source_kind,OLD.utility_account_id,OLD.meter_id,OLD.charge_id,OLD.author_id,OLD.created_at) THEN
   RAISE EXCEPTION 'immutable utility source' USING ERRCODE='insufficient_privilege';
  END IF;
  -- Источник уже удерживает блокировку объекта; FOR UPDATE скрыл бы чужую корзину от взрослого.
  SELECT * INTO p FROM public.objects WHERE id=NEW.object_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
  IF p.space_kind='household' THEN NEW.household_id:=p.space_id; END IF;
  NEW.deleted_at:=coalesce(p.deleted_at,NEW.deleted_at); NEW.updated_at:=now(); NEW.needs_refresh:=true;
  RETURN NEW;
 END IF;
 IF NEW.source_kind<>'record' AND current_user<>'homecrm_worker' AND NOT cascading THEN
  RAISE EXCEPTION 'edit utility source instead' USING ERRCODE='insufficient_privilege';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) THEN
    RAISE EXCEPTION 'immutable deadline fields' USING ERRCODE='insufficient_privilege';
  END IF;
  IF current_user='homecrm_worker' THEN
   IF (to_jsonb(NEW)-'needs_refresh') IS DISTINCT FROM (to_jsonb(OLD)-'needs_refresh') THEN
    RAISE EXCEPTION 'worker only clears refresh flag' USING ERRCODE='insufficient_privilege';
   END IF;
   RETURN NEW;
  END IF;
  IF cascading THEN
   IF NEW.rule IS DISTINCT FROM OLD.rule THEN RAISE EXCEPTION 'cascade cannot change rule' USING ERRCODE='insufficient_privilege'; END IF;
   NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS NOT NULL OR
    (to_jsonb(NEW)-ARRAY['deleted_at','updated_at','needs_refresh']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['deleted_at','updated_at','needs_refresh'])) THEN
    RAISE EXCEPTION 'restore only' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR (NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.assignee_id) THEN
   RAISE EXCEPTION 'deadline follows source' USING ERRCODE='insufficient_privilege';
  END IF;
 END IF;
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id,NEW.document_id);
 EXECUTE format('SELECT space_id,space_kind,audience,assignee_id,deleted_at FROM public.%I WHERE id=$1 FOR UPDATE',tbl) INTO p USING rid;
 IF p.space_id IS NULL OR p.deleted_at IS NOT NULL OR NOT app.deadline_source_allowed(NEW.note_id,NEW.object_id,true) THEN
  RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF (TG_OP='INSERT' OR NEW.space_kind='household') AND (NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id=NEW.household_id AND s.kind='household') OR
    NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id=NEW.household_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL)) THEN
  RAISE EXCEPTION 'house unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p.space_kind='household' AND p.space_id<>NEW.household_id THEN RAISE EXCEPTION 'wrong house' USING ERRCODE='check_violation'; END IF;
 NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
 NEW.updated_at:=now(); NEW.needs_refresh:=true;
 IF TG_OP='INSERT' THEN NEW.author_id:=app.current_account_id(); NEW.created_at:=now();
 ELSIF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at:=now(); END IF;
 RETURN NEW;
END; $$;
