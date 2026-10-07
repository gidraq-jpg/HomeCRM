ALTER TABLE "deadline_notifications" DROP CONSTRAINT "deadline_notifications_once";--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_notifications_once" ON "deadline_notifications" USING btree ("occurrence_id","recipient_id","warning_at") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE POLICY "deadline_occurrences_owner_select" ON "deadline_occurrences" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadline_occurrences_owner_update" ON "deadline_occurrences" AS PERMISSIVE FOR UPDATE TO "homecrm_owner" USING (pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_owner_select" ON "deadlines" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_owner_update" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_owner" USING (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_update" ON "deadlines" TO homecrm_app USING ((deleted_at IS NULL AND (app.deadline_source_allowed(note_id, object_id, true))) OR (deleted_at IS NOT NULL AND app.deadline_source_allowed(note_id, object_id, true) AND (space_kind='personal' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=deadlines.space_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND (m.role='admin' OR (m.role='adult' AND deadlines.author_id=app.current_account_id()))))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid)) WITH CHECK ((app.deadline_source_allowed(note_id, object_id, true)) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
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
  IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS NOT NULL OR
    (to_jsonb(NEW)-ARRAY['deleted_at','updated_at','needs_refresh']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['deleted_at','updated_at','needs_refresh'])) THEN
    RAISE EXCEPTION 'restore only' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR (NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.assignee_id) THEN
   RAISE EXCEPTION 'deadline follows source' USING ERRCODE='insufficient_privilege';
  END IF;
 END IF;
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id);
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_source_deadlines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE prior text:=current_setting('app.deadline_source_id',true);
BEGIN
  PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
  UPDATE public.deadlines d SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience,assignee_id=NEW.assignee_id,
   household_id=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE d.household_id END,
   deleted_at=CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN coalesce(d.deleted_at,NEW.deleted_at)
     WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND d.deleted_at=OLD.deleted_at THEN NULL ELSE d.deleted_at END
  WHERE (TG_TABLE_NAME='notes' AND d.note_id=NEW.id) OR (TG_TABLE_NAME='objects' AND d.object_id=NEW.id);
  PERFORM set_config('app.deadline_source_id',coalesce(prior,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION app.sync_source_deadlines() FROM PUBLIC;
--> statement-breakpoint
-- Обработчик не может менять отметку выполнения даже прямым UPDATE.
REVOKE UPDATE ON deadline_occurrences FROM homecrm_worker;
GRANT UPDATE(id,deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id,deleted_at) ON deadline_occurrences TO homecrm_worker;
--> statement-breakpoint
-- Подтверждённая сессия захватывает endpoint в своей транзакции. DELETE ждёт отправку,
-- державшую FOR SHARE; новая подписка получает новый UUID и не наследует чужие доставки.
CREATE FUNCTION app.claim_push_endpoint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.account_id IS DISTINCT FROM app.current_account_id() THEN
  RAISE EXCEPTION 'subscription owner mismatch' USING ERRCODE='insufficient_privilege';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('push-endpoint:' || NEW.endpoint,0));
 DELETE FROM public.push_subscriptions WHERE endpoint=NEW.endpoint
  AND (account_id<>NEW.account_id OR session_id<>NEW.session_id);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.claim_push_endpoint() FROM PUBLIC;
CREATE TRIGGER push_subscriptions_claim BEFORE INSERT OR UPDATE OF endpoint,p256dh,auth,device_name ON push_subscriptions
FOR EACH ROW EXECUTE FUNCTION app.claim_push_endpoint();

--> statement-breakpoint
-- Предыдущие наступления доступны под прежним RLS источника во время пересчёта.
ALTER POLICY deadline_occurrences_select ON deadline_occurrences USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND
 ((deadline_occurrences.deleted_at IS NULL AND d.deleted_at IS NULL) OR
 (pg_trigger_depth()>0 AND d.id=nullif(current_setting('app.deadline_cascade_id',true),'')::uuid))));

--> statement-breakpoint
DROP INDEX "deadline_notifications_once";--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_notifications_once" ON "deadline_notifications" USING btree ("occurrence_id","recipient_id","warning_at") WHERE status <> 'cancelled' OR cancellation_reason IS NOT NULL;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_cancellation_reason" CHECK (cancellation_reason IS NULL OR (status='cancelled' AND cancellation_reason='settings'));
--> statement-breakpoint
ALTER POLICY "deadlines_select" ON "deadlines" TO homecrm_app USING ((((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (EXISTS (SELECT 1 FROM notes n WHERE n.id=note_id) OR EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id))) OR (pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid));