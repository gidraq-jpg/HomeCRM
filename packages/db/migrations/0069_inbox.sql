CREATE TABLE "inbox_files" (
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
	CONSTRAINT "inbox_files_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "inbox_files_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "inbox_files_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL)),
	CONSTRAINT "inbox_files_personal" CHECK (space_kind='personal' AND audience IS NULL AND assignee_id=author_id)
);
--> statement-breakpoint
ALTER TABLE "inbox_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_files_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "inbox_files_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inbox_files_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_items" (
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
	"source" text DEFAULT 'text' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"house_id" uuid,
	"consent" text,
	"capture_hash" text DEFAULT '' NOT NULL,
	"draft" jsonb,
	"error_code" text,
	"resolved_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"target" jsonb,
	CONSTRAINT "inbox_items_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "inbox_items_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "inbox_items_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL)),
	CONSTRAINT "inbox_items_personal" CHECK (space_kind='personal' AND audience IS NULL AND assignee_id=author_id),
	CONSTRAINT "inbox_items_status" CHECK (status IN ('new','processing','ready','error','identity')),
	CONSTRAINT "inbox_items_source" CHECK (source IN ('photo','file','text','voice')),
	CONSTRAINT "inbox_items_identity_empty" CHECK (status<>'identity' OR draft IS NULL)
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_items_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "inbox_items_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inbox_items_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_files" ADD CONSTRAINT "inbox_files_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files" ADD CONSTRAINT "inbox_files_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files" ADD CONSTRAINT "inbox_files_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files" ADD CONSTRAINT "inbox_files_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files" ADD CONSTRAINT "inbox_files_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files_history" ADD CONSTRAINT "inbox_files_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_files_history" ADD CONSTRAINT "inbox_files_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."inbox_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_house_id_spaces_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items_history" ADD CONSTRAINT "inbox_items_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items_history" ADD CONSTRAINT "inbox_items_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_files_space_id_idx" ON "inbox_files" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "inbox_files_trash_idx" ON "inbox_files" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inbox_files_parent_id_idx" ON "inbox_files" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "inbox_files_history_record_id_idx" ON "inbox_files_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_space_id_idx" ON "inbox_items" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "inbox_items_trash_idx" ON "inbox_items" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inbox_items_history_record_id_idx" ON "inbox_items_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE POLICY "inbox_files_select" ON "inbox_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_files_insert" ON "inbox_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_files_update" ON "inbox_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id())) WITH CHECK (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_files_purge_select" ON "inbox_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "inbox_files_purge" ON "inbox_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "inbox_files_reassign_select" ON "inbox_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((inbox_files.space_kind = 'household' AND inbox_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = inbox_files.space_id AND l.account_id = inbox_files.assignee_id AND l.left_at IS NOT NULL
  )) OR (inbox_files.space_kind = 'household' AND inbox_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = inbox_files.space_id AND a.account_id = inbox_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "inbox_files_reassign" ON "inbox_files" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (inbox_files.space_kind = 'household' AND inbox_files.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = inbox_files.space_id AND l.account_id = inbox_files.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = inbox_files.space_id AND a.account_id = inbox_files.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "inbox_files_history_select" ON "inbox_files_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM inbox_files r WHERE r.id = inbox_files_history.record_id));--> statement-breakpoint
CREATE POLICY "inbox_files_history_insert" ON "inbox_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "inbox_files_history_worker_insert" ON "inbox_files_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "inbox_items_select" ON "inbox_items" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_items_insert" ON "inbox_items" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_items_update" ON "inbox_items" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id())) WITH CHECK (space_kind='personal' AND author_id=app.current_account_id() AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()));--> statement-breakpoint
CREATE POLICY "inbox_items_purge_select" ON "inbox_items" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "inbox_items_purge" ON "inbox_items" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "inbox_items_reassign_select" ON "inbox_items" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((inbox_items.space_kind = 'household' AND inbox_items.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = inbox_items.space_id AND l.account_id = inbox_items.assignee_id AND l.left_at IS NOT NULL
  )) OR (inbox_items.space_kind = 'household' AND inbox_items.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = inbox_items.space_id AND a.account_id = inbox_items.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "inbox_items_reassign" ON "inbox_items" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (inbox_items.space_kind = 'household' AND inbox_items.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = inbox_items.space_id AND l.account_id = inbox_items.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = inbox_items.space_id AND a.account_id = inbox_items.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "inbox_items_worker_select" ON "inbox_items" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (resolved_at IS NULL AND coalesce(restored_at,created_at)<=now()-interval '30 days');--> statement-breakpoint
CREATE POLICY "inbox_items_history_select" ON "inbox_items_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM inbox_items r WHERE r.id = inbox_items_history.record_id));--> statement-breakpoint
CREATE POLICY "inbox_items_history_insert" ON "inbox_items_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "inbox_items_history_worker_insert" ON "inbox_items_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);
--> statement-breakpoint
SELECT app.attach_record_table('inbox_items');
SELECT app.attach_record_table('inbox_files','inbox_items');
CREATE TRIGGER inbox_files_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON inbox_files FOR EACH ROW EXECUTE FUNCTION app.file_lifecycle('inbox_items');
GRANT SELECT(created_at,resolved_at,restored_at) ON inbox_items TO homecrm_worker;
GRANT UPDATE(deleted_at) ON inbox_items,inbox_files TO homecrm_worker;
--> statement-breakpoint
-- Служебный UPDATE виден только для очистки просроченного входящего и каскада его файлов.
CREATE FUNCTION app.inbox_worker_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    RAISE EXCEPTION 'inbox placement is immutable' USING ERRCODE='insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.inbox_worker_guard() FROM PUBLIC;
CREATE TRIGGER inbox_items_00_guard BEFORE UPDATE ON inbox_items FOR EACH ROW EXECUTE FUNCTION app.inbox_worker_guard();
--> statement-breakpoint
-- Регистрируем только новые виды в общей защите, не меняя ветви существующих сущностей.
DO $guard$
DECLARE definition text := pg_get_functiondef('app.record_guard()'::regprocedure);
BEGIN
  definition := regexp_replace(definition,'TG_TABLE_NAME NOT IN \(([^)]*)\)', 'TG_TABLE_NAME NOT IN (\1,''inbox_items'',''inbox_files'')');
  EXECUTE definition;
END $guard$;
--> statement-breakpoint
-- AI-5, решение владельца: после подтверждённого сохранения исходные файлы захвата удаляются.
CREATE POLICY inbox_files_resolved_delete ON inbox_files FOR DELETE TO homecrm_app USING (author_id=app.current_account_id() AND EXISTS(SELECT 1 FROM inbox_items i WHERE i.id=parent_id AND i.resolved_at IS NOT NULL));
GRANT DELETE ON inbox_files TO homecrm_app;
--> statement-breakpoint
-- Временные страницы не могут быть концами record_links: record_ref_allowed их не принимает.
-- Поэтому подтверждённое удаление не требует прав DELETE на связи существующих сущностей.
CREATE FUNCTION app.inbox_file_purge() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RETURN OLD; END $$;
REVOKE ALL ON FUNCTION app.inbox_file_purge() FROM PUBLIC;
CREATE OR REPLACE TRIGGER inbox_files_links_purge BEFORE DELETE ON inbox_files FOR EACH ROW EXECUTE FUNCTION app.inbox_file_purge();
--> statement-breakpoint
CREATE POLICY inbox_items_worker_expire ON inbox_items FOR UPDATE TO homecrm_worker
USING (deleted_at IS NULL AND resolved_at IS NULL AND coalesce(restored_at,created_at)<=now()-interval '30 days')
WITH CHECK (deleted_at IS NOT NULL AND deleted_at<=now() AND resolved_at IS NULL AND coalesce(restored_at,created_at)<=now()-interval '30 days');
CREATE POLICY inbox_files_worker_expire_select ON inbox_files FOR SELECT TO homecrm_worker
USING (EXISTS(SELECT 1 FROM inbox_items i WHERE i.id=parent_id AND i.deleted_at IS NOT NULL));
CREATE POLICY inbox_files_worker_expire ON inbox_files FOR UPDATE TO homecrm_worker
USING (EXISTS(SELECT 1 FROM inbox_items i WHERE i.id=parent_id AND i.deleted_at IS NOT NULL))
WITH CHECK (deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM inbox_items i WHERE i.id=parent_id AND i.deleted_at=inbox_files.deleted_at));
--> statement-breakpoint
-- Личное размещение автора неизменно; worker при очистке не читает владельцев пространств.
CREATE FUNCTION app.inbox_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.created_at:=now(); NEW.updated_at:=now(); NEW.has_other_contributions:=false;
    NEW.assignee_id:=NEW.author_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.inbox_defaults() FROM PUBLIC;
CREATE OR REPLACE TRIGGER inbox_items_defaults BEFORE INSERT OR UPDATE ON inbox_items FOR EACH ROW EXECUTE FUNCTION app.inbox_defaults();
CREATE OR REPLACE TRIGGER inbox_files_defaults BEFORE INSERT OR UPDATE ON inbox_files FOR EACH ROW EXECUTE FUNCTION app.inbox_defaults();
