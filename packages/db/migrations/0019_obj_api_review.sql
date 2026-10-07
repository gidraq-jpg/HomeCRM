CREATE POLICY "object_events_cascade_select" ON "object_events" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz));
--> statement-breakpoint
-- R0.5d: обновление функций без переписывания строк и истории.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_defaults() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.has_other_contributions := false;
    NEW.created_at := now();
    NEW.updated_at := now();
  END IF;
  IF NEW.space_kind = 'personal' THEN
    NEW.assignee_id := (SELECT s.owner_account_id FROM public.spaces s WHERE s.id = NEW.space_id);
  ELSIF NEW.assignee_id IS NULL THEN
    NEW.assignee_id := NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text'];
BEGIN
  -- Новый вид записи требует явного решения о содержательном вкладе.
  IF TG_TABLE_NAME NOT IN ('notes','note_items','shopping_items','tasks','objects','object_fields','object_events','note_files','object_files') THEN
    RAISE EXCEPTION 'record contribution rules are not registered' USING ERRCODE = 'check_violation';
  END IF;
  -- Очистка контакта меняет только ссылку, в том числе у события в корзине.
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN
    IF NEW.contact_table IS NOT NULL OR NEW.contact_id IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['contact_table','contact_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['contact_table','contact_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
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
        IF TG_TABLE_NAME = 'notes' AND (EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) OR EXISTS (SELECT 1 FROM public.note_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions))) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'objects' AND (
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
      OR (TG_TABLE_NAME IN ('objects', 'tasks') AND NEW.title IS DISTINCT FROM OLD.title)
      OR (TG_TABLE_NAME = 'shopping_items' AND (NEW.title, to_jsonb(NEW)->>'quantity', to_jsonb(NEW)->>'bought_at') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'quantity', to_jsonb(OLD)->>'bought_at'))
      OR (TG_TABLE_NAME IN ('object_fields', 'object_events') AND (to_jsonb(NEW) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])) IS DISTINCT FROM (to_jsonb(OLD) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])))
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
    IF TG_ARGV[0] = 'child' THEN
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
CREATE OR REPLACE FUNCTION app.cascade_object_events() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior_id text := current_setting('app.object_cascade_id',true);
  prior_mode text := current_setting('app.object_cascade_mode',true);
  prior_time text := current_setting('app.object_cascade_time',true);
  prior_restore_id text := current_setting('app.parent_restore_id',true);
  prior_restore_table text := current_setting('app.parent_restore_table',true);
  prior_restore_time text := current_setting('app.parent_restore_time',true);
BEGIN
  PERFORM set_config('app.object_cascade_id',NEW.id::text,true);
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    PERFORM set_config('app.object_cascade_mode','place',true);
    UPDATE public.object_events SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM set_config('app.object_cascade_mode','trash',true);
    PERFORM set_config('app.object_cascade_time',NEW.deleted_at::text,true);
    UPDATE public.object_events SET deleted_at=NEW.deleted_at WHERE parent_id=NEW.id AND deleted_at IS NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM set_config('app.object_cascade_mode','restore',true);
    PERFORM set_config('app.parent_restore_id',NEW.id::text,true);
    PERFORM set_config('app.parent_restore_table','object_events',true);
    PERFORM set_config('app.parent_restore_time',OLD.deleted_at::text,true);
    PERFORM set_config('app.object_cascade_time',OLD.deleted_at::text,true);
    UPDATE public.object_events SET deleted_at=NULL WHERE parent_id=NEW.id AND deleted_at=OLD.deleted_at;
  END IF;
  PERFORM set_config('app.parent_restore_id',coalesce(prior_restore_id,''),true);
  PERFORM set_config('app.parent_restore_table',coalesce(prior_restore_table,''),true);
  PERFORM set_config('app.parent_restore_time',coalesce(prior_restore_time,''),true);
  PERFORM set_config('app.object_cascade_id',coalesce(prior_id,''),true);
  PERFORM set_config('app.object_cascade_mode',coalesce(prior_mode,''),true);
  PERFORM set_config('app.object_cascade_time',coalesce(prior_time,''),true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE endpoint record; visible uuid; trashed timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.author_id, NEW.created_at, NEW.left_table, NEW.left_id, NEW.right_table, NEW.right_id)
    IS DISTINCT FROM (OLD.id, OLD.author_id, OLD.created_at, OLD.left_table, OLD.left_id, OLD.right_table, OLD.right_id) THEN
    RAISE EXCEPTION 'link endpoints are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.left_table = NEW.right_table AND NEW.left_id = NEW.right_id THEN
    RAISE EXCEPTION 'invalid link' USING ERRCODE = 'check_violation';
  END IF;
  FOR endpoint IN SELECT * FROM (VALUES (NEW.left_table, NEW.left_id), (NEW.right_table, NEW.right_id)) e(tbl, rid) ORDER BY tbl, rid LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('record-link:' || endpoint.tbl || ':' || endpoint.rid::text,0));
    IF NOT app.record_ref_allowed(endpoint.tbl, endpoint.rid, false) THEN
      RAISE EXCEPTION 'record unavailable' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF app.record_ref_allowed(endpoint.tbl, endpoint.rid, true) THEN
      EXECUTE format('SELECT id FROM public.%I WHERE id = $1 FOR SHARE', endpoint.tbl) INTO visible USING endpoint.rid;
      IF visible IS NULL THEN RAISE EXCEPTION 'record unavailable' USING ERRCODE = 'insufficient_privilege'; END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      EXECUTE format('SELECT deleted_at FROM public.%I WHERE id=$1',endpoint.tbl) INTO trashed USING endpoint.rid;
      IF trashed IS NOT NULL THEN RAISE EXCEPTION 'restore endpoint first' USING ERRCODE = 'check_violation'; END IF;
    END IF;
  END LOOP;
  IF NOT (app.record_ref_allowed(NEW.left_table, NEW.left_id, true) OR app.record_ref_allowed(NEW.right_table, NEW.right_id, true)) THEN
    RAISE EXCEPTION 'record unavailable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'restore link first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_at := now();
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := now(); END IF;
  RETURN NEW;
END;
$$;