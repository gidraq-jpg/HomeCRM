-- Блокеры PR #16: контакт не удаляет событие; восстановление следует каскаду родителя.
-- Все функции с правами вызывающего; контекст сам по себе не даёт доступ без вложенного триггера.
GRANT SELECT (contact_table,contact_id), UPDATE (contact_table,contact_id) ON object_events TO homecrm_worker;
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
        IF TG_TABLE_NAME = 'notes' AND EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'objects' AND (
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
CREATE OR REPLACE FUNCTION app.cascade_trash() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior_id text := current_setting('app.parent_restore_id',true);
  prior_table text := current_setting('app.parent_restore_table',true);
  prior_time text := current_setting('app.parent_restore_time',true);
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET deleted_at = $1 WHERE parent_id = $2 AND deleted_at IS NULL', TG_ARGV[0])
      USING NEW.deleted_at, NEW.id;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM set_config('app.parent_restore_id',NEW.id::text,true);
    PERFORM set_config('app.parent_restore_table',TG_ARGV[0],true);
    PERFORM set_config('app.parent_restore_time',OLD.deleted_at::text,true);
    EXECUTE format('UPDATE public.%I SET deleted_at = NULL WHERE parent_id = $1 AND deleted_at = $2', TG_ARGV[0])
      USING NEW.id, OLD.deleted_at;
    PERFORM set_config('app.parent_restore_id',coalesce(prior_id,''),true);
    PERFORM set_config('app.parent_restore_table',coalesce(prior_table,''),true);
    PERFORM set_config('app.parent_restore_time',coalesce(prior_time,''),true);
  END IF;
  RETURN NULL;
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
    IF current_user = 'homecrm_app' THEN
      UPDATE public.object_events SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience;
    ELSE
      UPDATE public.object_events SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
    END IF;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM set_config('app.object_cascade_mode','trash',true);
    PERFORM set_config('app.object_cascade_time',NEW.deleted_at::text,true);
    IF current_user = 'homecrm_app' THEN
      UPDATE public.object_events SET deleted_at=NEW.deleted_at;
    ELSE
      UPDATE public.object_events SET deleted_at=NEW.deleted_at WHERE parent_id=NEW.id AND deleted_at IS NULL;
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM set_config('app.object_cascade_mode','restore',true);
    PERFORM set_config('app.parent_restore_id',NEW.id::text,true);
    PERFORM set_config('app.parent_restore_table','object_events',true);
    PERFORM set_config('app.parent_restore_time',OLD.deleted_at::text,true);
    PERFORM set_config('app.object_cascade_time',OLD.deleted_at::text,true);
    IF current_user = 'homecrm_app' THEN
      UPDATE public.object_events SET deleted_at=NULL;
    ELSE
      UPDATE public.object_events SET deleted_at=NULL WHERE parent_id=NEW.id AND deleted_at=OLD.deleted_at;
    END IF;
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
CREATE OR REPLACE FUNCTION app.event_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE contact_changed boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN contact_changed := (NEW.contact_table,NEW.contact_id) IS DISTINCT FROM (OLD.contact_table,OLD.contact_id); END IF;
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND NEW.parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid THEN
    IF (to_jsonb(NEW) - ARRAY['updated_at','space_id','space_kind','audience','assignee_id','deleted_at','assignee_house_id','assignee_adult_id','assignee_adult_flag','has_other_contributions','search_text'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','space_id','space_kind','audience','assignee_id','deleted_at','assignee_house_id','assignee_adult_id','assignee_adult_flag','has_other_contributions','search_text']) THEN
      RAISE EXCEPTION 'a parent cascade changes only metadata' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.origin_space_id := NEW.space_id; NEW.origin_space_kind := NEW.space_kind; NEW.origin_audience := NEW.audience;
  ELSIF (NEW.origin_space_id, NEW.origin_space_kind, NEW.origin_audience) IS DISTINCT FROM (OLD.origin_space_id, OLD.origin_space_kind, OLD.origin_audience) THEN
    RAISE EXCEPTION 'event visibility is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.contact_id IS NULL) <> (NEW.contact_table IS NULL) OR NEW.contact_table = 'object_events' THEN
    RAISE EXCEPTION 'contact unavailable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF contact_changed AND NEW.contact_id IS NOT NULL THEN
    -- Тот же ключ, что у очистки: после ожидания повторяем проверку видимости.
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('record-link:' || NEW.contact_table || ':' || NEW.contact_id::text,0));
    IF NOT app.record_ref_allowed(NEW.contact_table, NEW.contact_id, false) THEN
      RAISE EXCEPTION 'contact unavailable' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.rating NOT BETWEEN 1 AND 5 OR abs(NEW.amount_kopecks::numeric) > 9007199254740991 THEN
    RAISE EXCEPTION 'invalid event value' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purge_record_link_tree(tbl text, rid uuid) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE child record; child_id uuid;
  prior_table text := current_setting('app.contact_purge_table',true);
  prior_id text := current_setting('app.contact_purge_id',true);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('record-link:' || tbl || ':' || rid::text,0));
  PERFORM set_config('app.contact_purge_table',tbl,true);
  PERFORM set_config('app.contact_purge_id',rid::text,true);
  UPDATE public.object_events SET contact_table=NULL,contact_id=NULL WHERE contact_table=tbl AND contact_id=rid;
  PERFORM set_config('app.contact_purge_table',coalesce(prior_table,''),true);
  PERFORM set_config('app.contact_purge_id',coalesce(prior_id,''),true);
  DELETE FROM public.record_links WHERE (left_table=tbl AND left_id=rid) OR (right_table=tbl AND right_id=rid);
  FOR child IN
    SELECT DISTINCT c.relname FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_class c ON c.oid=fk.conrelid
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(fk.conkey) AND a.attname='parent_id'
      JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid AND t.tgfoid='app.record_defaults()'::regprocedure AND NOT t.tgisinternal
    WHERE fk.contype='f' AND fk.confrelid=to_regclass(format('public.%I',tbl))
  LOOP
    FOR child_id IN EXECUTE format('SELECT id FROM public.%I WHERE parent_id=$1', child.relname) USING rid LOOP
      PERFORM app.purge_record_link_tree(child.relname,child_id);
    END LOOP;
  END LOOP;
END;
$$;
