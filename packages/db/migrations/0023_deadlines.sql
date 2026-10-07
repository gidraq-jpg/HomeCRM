-- Проверка выполняется с правами вызывающего, под RLS источника.
CREATE FUNCTION app.deadline_source_allowed(nid uuid, oid uuid, writing boolean) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
SELECT CASE WHEN nid IS NOT NULL AND oid IS NULL THEN app.record_ref_allowed('notes',nid,writing)
WHEN oid IS NOT NULL AND nid IS NULL THEN app.record_ref_allowed('objects',oid,writing) ELSE false END;
$$;
--> statement-breakpoint
CREATE TABLE "deadline_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"warning_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_notifications_once" UNIQUE("occurrence_id","recipient_id","warning_at"),
	CONSTRAINT "deadline_notifications_status" CHECK (status IN ('pending', 'sent', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "deadline_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deadline_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deadline_id" uuid NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"warnings_at" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "deadline_occurrences_date_key" UNIQUE("deadline_id","date")
);
--> statement-breakpoint
ALTER TABLE "deadline_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"note_id" uuid,
	"object_id" uuid,
	"household_id" uuid NOT NULL,
	"rule" jsonb NOT NULL,
	"needs_refresh" boolean DEFAULT true NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_one_source" CHECK ((note_id IS NULL) <> (object_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "deadlines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_occurrence_id_deadline_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."deadline_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_recipient_id_accounts_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_occurrences" ADD CONSTRAINT "deadline_occurrences_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_occurrences" ADD CONSTRAINT "deadline_occurrences_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_occurrences" ADD CONSTRAINT "deadline_occurrences_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_household_id_spaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_space_id_space_kind_spaces_id_kind_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadline_occurrences_range_idx" ON "deadline_occurrences" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "deadlines_note_idx" ON "deadlines" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "deadlines_object_idx" ON "deadlines" USING btree ("object_id");--> statement-breakpoint
CREATE POLICY "spaces_timezone_admin" ON "spaces" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (kind = 'household' AND id IN (SELECT space_id FROM space_members WHERE account_id = app.current_account_id() AND role = 'admin' AND left_at IS NULL)) WITH CHECK (kind = 'household' AND id IN (SELECT space_id FROM space_members WHERE account_id = app.current_account_id() AND role = 'admin' AND left_at IS NULL));--> statement-breakpoint
CREATE POLICY "spaces_timezone_worker" ON "spaces" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (kind = 'household');--> statement-breakpoint
CREATE POLICY "spaces_timezone_initialize" ON "spaces" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (kind = 'household' AND time_zone IS NULL) WITH CHECK (kind = 'household' AND time_zone IS NOT NULL);--> statement-breakpoint
CREATE POLICY "deadline_notifications_select" ON "deadline_notifications" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (recipient_id = app.current_account_id() AND EXISTS (SELECT 1 FROM deadline_occurrences o WHERE o.id = occurrence_id));--> statement-breakpoint
CREATE POLICY "deadline_notifications_worker_select" ON "deadline_notifications" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "deadline_notifications_worker_insert" ON "deadline_notifications" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deadline_notifications_worker_update" ON "deadline_notifications" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deadline_notifications_worker_delete" ON "deadline_notifications" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_select" ON "deadline_occurrences" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.id = deadline_id AND ((deadline_occurrences.deleted_at IS NULL AND d.deleted_at IS NULL AND NOT d.needs_refresh AND (deadline_occurrences.time_zone = (SELECT s.time_zone FROM spaces s WHERE s.id=d.household_id) OR (d.space_kind='personal' AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=d.household_id)))) OR (pg_trigger_depth() > 0 AND d.id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid))));--> statement-breakpoint
CREATE POLICY "deadline_occurrences_cascade" ON "deadline_occurrences" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_worker_select" ON "deadline_occurrences" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_worker_insert" ON "deadline_occurrences" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_worker_update" ON "deadline_occurrences" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_worker_delete" ON "deadline_occurrences" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "deadlines_select" ON "deadlines" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((app.deadline_source_allowed(note_id, object_id, false)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
CREATE POLICY "deadlines_insert" ON "deadlines" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (app.deadline_source_allowed(note_id, object_id, true) AND author_id = app.current_account_id() AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY "deadlines_update" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid)) WITH CHECK ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));--> statement-breakpoint
CREATE POLICY "deadlines_engine" ON "deadlines" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);

--> statement-breakpoint
-- Политика worker дополняет права на колонки: правило и ссылки ему менять нельзя.
GRANT SELECT (id, note_id, object_id, household_id, rule, space_id, space_kind, audience, author_id, assignee_id, deleted_at, needs_refresh) ON deadlines TO homecrm_worker;
--> statement-breakpoint
GRANT UPDATE (needs_refresh) ON deadlines TO homecrm_worker;
--> statement-breakpoint
GRANT DELETE ON deadlines TO homecrm_worker;
--> statement-breakpoint
ALTER TABLE deadlines FORCE ROW LEVEL SECURITY;
ALTER TABLE deadline_occurrences FORCE ROW LEVEL SECURITY;
ALTER TABLE deadline_notifications FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON deadlines TO homecrm_app;
GRANT UPDATE (rule, deleted_at, space_id, space_kind, audience, assignee_id, household_id, needs_refresh) ON deadlines TO homecrm_app;
GRANT SELECT ON deadline_occurrences, deadline_notifications TO homecrm_app;
GRANT UPDATE (space_id, space_kind, audience, assignee_id, deleted_at) ON deadline_occurrences TO homecrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON deadline_occurrences, deadline_notifications TO homecrm_worker;
GRANT UPDATE (time_zone) ON spaces TO homecrm_app, homecrm_worker;
GRANT SELECT (id, kind, time_zone) ON spaces TO homecrm_worker;
--> statement-breakpoint
ALTER TABLE deadlines ADD CONSTRAINT deadlines_note_fk FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE;
ALTER TABLE deadlines ADD CONSTRAINT deadlines_object_fk FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE FUNCTION app.guard_house_timezone() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.time_zone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.time_zone AND (name LIKE '%/%' OR name='UTC')) THEN
  RAISE EXCEPTION 'invalid time zone' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER spaces_timezone_guard BEFORE INSERT OR UPDATE OF time_zone ON spaces FOR EACH ROW EXECUTE FUNCTION app.guard_house_timezone();
--> statement-breakpoint
CREATE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p record; tbl text; rid uuid; cascading boolean;
BEGIN
 cascading := pg_trigger_depth()>1 AND coalesce(NEW.note_id,NEW.object_id)=nullif(current_setting('app.deadline_source_id',true),'')::uuid;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['rule','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['rule','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) THEN
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
  IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'deadline in trash' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR (NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.assignee_id) THEN
   RAISE EXCEPTION 'deadline follows source' USING ERRCODE='insufficient_privilege';
  END IF;
 END IF;
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id);
 EXECUTE format('SELECT space_id,space_kind,audience,assignee_id,deleted_at FROM public.%I WHERE id=$1 FOR UPDATE',tbl) INTO p USING rid;
 IF p.space_id IS NULL OR p.deleted_at IS NOT NULL OR NOT app.deadline_source_allowed(NEW.note_id,NEW.object_id,true) THEN
  RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id=NEW.household_id AND s.kind='household') OR
    NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id=NEW.household_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL) THEN
  RAISE EXCEPTION 'house unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p.space_kind='household' AND p.space_id<>NEW.household_id THEN RAISE EXCEPTION 'wrong house' USING ERRCODE='check_violation'; END IF;
 NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
 NEW.updated_at:=now(); NEW.needs_refresh:=true;
 IF TG_OP='INSERT' THEN NEW.author_id:=app.current_account_id(); NEW.created_at:=now();
 ELSIF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at:=now(); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER deadlines_guard BEFORE INSERT OR UPDATE ON deadlines FOR EACH ROW EXECUTE FUNCTION app.deadline_guard();
--> statement-breakpoint
CREATE FUNCTION app.sync_source_deadlines() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user<>'homecrm_worker' THEN
  PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
  UPDATE public.deadlines d SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience,assignee_id=NEW.assignee_id,
   household_id=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE d.household_id END,
   deleted_at=CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN coalesce(d.deleted_at,NEW.deleted_at)
     WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND d.deleted_at=OLD.deleted_at THEN NULL ELSE d.deleted_at END
  WHERE (TG_TABLE_NAME='notes' AND d.note_id=NEW.id) OR (TG_TABLE_NAME='objects' AND d.object_id=NEW.id);
  PERFORM set_config('app.deadline_source_id',coalesce(prior,''),true);
 END IF;
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
CREATE TRIGGER notes_deadlines AFTER UPDATE OF space_id,audience,assignee_id,deleted_at ON notes FOR EACH ROW EXECUTE FUNCTION app.sync_source_deadlines();
CREATE TRIGGER objects_deadlines AFTER UPDATE OF space_id,audience,assignee_id,deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION app.sync_source_deadlines();
--> statement-breakpoint
CREATE FUNCTION app.sync_deadline_occurrences() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior text:=current_setting('app.deadline_cascade_id',true);
BEGIN
 IF current_user<>'homecrm_worker' THEN
  PERFORM set_config('app.deadline_cascade_id',NEW.id::text,true);
  UPDATE public.deadline_occurrences SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience,assignee_id=NEW.assignee_id,deleted_at=NEW.deleted_at WHERE deadline_id=NEW.id;
  PERFORM set_config('app.deadline_cascade_id',coalesce(prior,''),true);
  PERFORM pg_notify('homecrm_deadlines','');
 END IF;
 RETURN NULL;
END; $$;
CREATE TRIGGER deadlines_occurrences AFTER INSERT OR UPDATE ON deadlines FOR EACH ROW EXECUTE FUNCTION app.sync_deadline_occurrences();
--> statement-breakpoint
-- Решение владельца: чужие добавление, правка и удаление срока — вклад в источник.
-- Каскад корзины источника и выполненность производного наступления вкладом не считаются.
CREATE FUNCTION app.deadline_contribution() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE tbl text; rid uuid;
BEGIN
 IF current_user='homecrm_worker' OR pg_trigger_depth()>1 THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.rule IS NOT DISTINCT FROM OLD.rule AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NULL; END IF;
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id);
 EXECUTE format('UPDATE public.%I SET has_other_contributions=true WHERE id=$1 AND space_kind=''household'' AND author_id<>app.current_account_id() AND NOT has_other_contributions',tbl) USING rid;
 RETURN NULL;
END; $$;
CREATE TRIGGER deadlines_contribution AFTER INSERT OR UPDATE OF rule,deleted_at ON deadlines FOR EACH ROW EXECUTE FUNCTION app.deadline_contribution();
--> statement-breakpoint
CREATE FUNCTION app.guard_occurrence_cascade() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user='homecrm_app' AND (pg_trigger_depth()<2 OR NEW.deadline_id<>nullif(current_setting('app.deadline_cascade_id',true),'')::uuid OR
  (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at'])) THEN
  RAISE EXCEPTION 'occurrence is derived' USING ERRCODE='insufficient_privilege';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER deadline_occurrences_guard BEFORE UPDATE ON deadline_occurrences FOR EACH ROW EXECUTE FUNCTION app.guard_occurrence_cascade();
--> statement-breakpoint
-- Сохраняем существующую границу колонок из 0002: worker не читает title/body.
-- Новые политики открывают только уже выданные служебные колонки источников.
REVOKE SELECT ON notes, objects FROM homecrm_worker;
GRANT SELECT (id, space_id, space_kind, assignee_id, deleted_at) ON notes, objects TO homecrm_worker;

--> statement-breakpoint
CREATE POLICY "deadlines_refresh" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (true) WITH CHECK (NOT needs_refresh);--> statement-breakpoint
CREATE POLICY "notes_deadline_worker_select" ON "notes" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.note_id = notes.id));--> statement-breakpoint
CREATE POLICY "objects_deadline_worker_select" ON "objects" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id = objects.id));
--> statement-breakpoint
-- Внутренняя очередь ADR-0006. Worker создаёт объекты pg-boss только в выделенной схеме.
CREATE SCHEMA pgboss;
GRANT USAGE, CREATE ON SCHEMA pgboss TO homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.notify_house_timezone() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN PERFORM pg_notify('homecrm_deadlines',''); END IF;
 RETURN NULL;
END; $$;
CREATE TRIGGER spaces_deadlines AFTER UPDATE OF time_zone ON spaces FOR EACH ROW EXECUTE FUNCTION app.notify_house_timezone();

--> statement-breakpoint
CREATE POLICY "deadlines_purge" ON "deadlines" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');
