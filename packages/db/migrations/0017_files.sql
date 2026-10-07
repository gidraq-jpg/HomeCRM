CREATE TABLE "file_blobs" (
	"key" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_blobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "note_files" (
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
	CONSTRAINT "note_files_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "note_files_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "note_files_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "note_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "note_files_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "note_files_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "note_files_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_files" (
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
	CONSTRAINT "object_files_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "object_files_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "object_files_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_files_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "object_files_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_files_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_files" ADD CONSTRAINT "note_files_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files" ADD CONSTRAINT "note_files_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files" ADD CONSTRAINT "note_files_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files" ADD CONSTRAINT "note_files_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files" ADD CONSTRAINT "note_files_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files_history" ADD CONSTRAINT "note_files_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_files_history" ADD CONSTRAINT "note_files_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."note_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files" ADD CONSTRAINT "object_files_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files" ADD CONSTRAINT "object_files_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files" ADD CONSTRAINT "object_files_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files" ADD CONSTRAINT "object_files_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files" ADD CONSTRAINT "object_files_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files_history" ADD CONSTRAINT "object_files_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_files_history" ADD CONSTRAINT "object_files_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."object_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_files_space_id_idx" ON "note_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "note_files_trash_idx" ON "note_files" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "note_files_parent_id_idx" ON "note_files" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "note_files_history_record_id_idx" ON "note_files_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "object_files_space_id_idx" ON "object_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "object_files_trash_idx" ON "object_files" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "object_files_parent_id_idx" ON "object_files" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "object_files_history_record_id_idx" ON "object_files_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE POLICY "file_blobs_worker_select" ON "file_blobs" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "file_blobs_app_select" ON "file_blobs" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "file_blobs_app_insert" ON "file_blobs" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "file_blobs_app_delete" ON "file_blobs" AS PERMISSIVE FOR DELETE TO "homecrm_app" USING (pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "file_blobs_worker_delete" ON "file_blobs" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "note_files_select" ON "note_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "note_files_insert" ON "note_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "note_files_update" ON "note_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
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
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
CREATE POLICY "note_files_purge_select" ON "note_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "note_files_purge" ON "note_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "note_files_reassign_select" ON "note_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((note_files.space_kind = 'household' AND note_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = note_files.space_id AND l.account_id = note_files.assignee_id AND l.left_at IS NOT NULL
  )) OR (note_files.space_kind = 'household' AND note_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = note_files.space_id AND a.account_id = note_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "note_files_reassign" ON "note_files" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (note_files.space_kind = 'household' AND note_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = note_files.space_id AND l.account_id = note_files.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = note_files.space_id AND a.account_id = note_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "note_files_history_select" ON "note_files_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM note_files r WHERE r.id = note_files_history.record_id));--> statement-breakpoint
CREATE POLICY "note_files_history_insert" ON "note_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "note_files_history_worker_insert" ON "note_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "object_files_select" ON "object_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "object_files_insert" ON "object_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "object_files_update" ON "object_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
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
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
CREATE POLICY "object_files_purge_select" ON "object_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_files_purge" ON "object_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_files_reassign_select" ON "object_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((object_files.space_kind = 'household' AND object_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_files.space_id AND l.account_id = object_files.assignee_id AND l.left_at IS NOT NULL
  )) OR (object_files.space_kind = 'household' AND object_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_files.space_id AND a.account_id = object_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "object_files_reassign" ON "object_files" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (object_files.space_kind = 'household' AND object_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_files.space_id AND l.account_id = object_files.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_files.space_id AND a.account_id = object_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "object_files_history_select" ON "object_files_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM object_files r WHERE r.id = object_files_history.record_id));--> statement-breakpoint
CREATE POLICY "object_files_history_insert" ON "object_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "object_files_history_worker_insert" ON "object_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);