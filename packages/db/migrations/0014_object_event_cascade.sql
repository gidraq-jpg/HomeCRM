ALTER POLICY "object_events_update" ON "object_events" TO homecrm_app USING (((deleted_at IS NULL AND ((
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
  )))) AND (((
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)
  AND (contact_id IS NULL OR app.record_ref_allowed(contact_table, contact_id, false))) AND nullif(current_setting('app.object_cascade_id',true),'') IS NULL) OR (pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR (
    (deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
    AND (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  )))))
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)))) WITH CHECK (((deleted_at IS NULL AND ((
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
  )))) AND (((
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)
  AND (contact_id IS NULL OR app.record_ref_allowed(contact_table, contact_id, false))) AND nullif(current_setting('app.object_cascade_id',true),'') IS NULL) OR (pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR (
    (deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
    AND (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  )))))
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz))));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cascade_object_placement() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    UPDATE public.object_fields SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- UPDATE без чтения содержимого: политика ограничивает строки ровно детьми текущего родителя.
CREATE FUNCTION app.cascade_object_events() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior_id text := current_setting('app.object_cascade_id',true);
  prior_mode text := current_setting('app.object_cascade_mode',true);
  prior_time text := current_setting('app.object_cascade_time',true);
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
    PERFORM set_config('app.object_cascade_time',OLD.deleted_at::text,true);
    IF current_user = 'homecrm_app' THEN
      UPDATE public.object_events SET deleted_at=NULL;
    ELSE
      UPDATE public.object_events SET deleted_at=NULL WHERE parent_id=NEW.id AND deleted_at=OLD.deleted_at;
    END IF;
  END IF;
  PERFORM set_config('app.object_cascade_id',coalesce(prior_id,''),true);
  PERFORM set_config('app.object_cascade_mode',coalesce(prior_mode,''),true);
  PERFORM set_config('app.object_cascade_time',coalesce(prior_time,''),true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER objects_cascade_object_events ON objects;
--> statement-breakpoint
CREATE TRIGGER objects_cascade_object_events AFTER UPDATE OF space_id,space_kind,audience,deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION app.cascade_object_events();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.event_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
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
  IF (NEW.contact_id IS NULL) <> (NEW.contact_table IS NULL)
    OR NEW.contact_table = 'object_events' OR (NEW.contact_id IS NOT NULL AND NOT app.record_ref_allowed(NEW.contact_table, NEW.contact_id, false)) THEN
    RAISE EXCEPTION 'contact unavailable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rating NOT BETWEEN 1 AND 5 OR abs(NEW.amount_kopecks::numeric) > 9007199254740991 THEN
    RAISE EXCEPTION 'invalid event value' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Обработчик читает только идентификаторы дочерних строк, без текстов.
CREATE OR REPLACE FUNCTION app.grant_record_table(tbl text) RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  rel text := format('public.%I', tbl);
  hist text := format('public.%I', tbl || '_history');
  updatable text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
  INTO updatable
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = rel::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND a.attname NOT IN ('id', 'author_id', 'created_at', 'updated_at');

  EXECUTE format('GRANT SELECT, INSERT ON %s TO homecrm_app', rel);
  EXECUTE format('GRANT UPDATE (%s) ON %s TO homecrm_app', updatable, rel);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO homecrm_app', hist);
  EXECUTE format('GRANT SELECT (id, space_id, space_kind, assignee_id, deleted_at) ON %s TO homecrm_worker', rel);
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=rel::regclass AND attname='parent_id' AND NOT attisdropped) THEN
    EXECUTE format('GRANT SELECT (parent_id) ON %s TO homecrm_worker', rel);
  END IF;
  EXECUTE format('GRANT UPDATE (assignee_id) ON %s TO homecrm_worker', rel);
  EXECUTE format('GRANT DELETE ON %s TO homecrm_worker', rel);
  EXECUTE format('GRANT INSERT ON %s TO homecrm_worker', hist);
END;
$$;

--> statement-breakpoint
-- Удаляем связи потомков до FK-каскада: сам FK выполняется владельцем таблиц под FORCE RLS.
CREATE FUNCTION app.purge_record_link_tree(tbl text, rid uuid) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE child record; child_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('record-link:' || tbl || ':' || rid::text,0));
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purge_record_links() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM app.purge_record_link_tree(TG_TABLE_NAME,OLD.id);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
  FOR tbl IN SELECT c.relname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    WHERE c.relnamespace='public'::regnamespace AND t.tgfoid='app.record_defaults()'::regprocedure AND NOT t.tgisinternal LOOP
    PERFORM app.grant_record_table(tbl);
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.purge_record_links()',tbl || '_links_purge',tbl);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.attach_record_table(tbl text, parent text DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  rel text := format('public.%I', tbl);
  hist text := format('public.%I', tbl || '_history');
BEGIN
  IF to_regclass(rel) IS NULL OR to_regclass(hist) IS NULL THEN
    RAISE EXCEPTION 'tables % and % must exist; create them with recordTable() first', tbl, tbl || '_history';
  END IF;

  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', hist);
  PERFORM app.grant_record_table(tbl);

  EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_defaults()',
    tbl || '_defaults', rel);
  EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_guard(%L)',
    tbl || '_guard', rel, CASE WHEN parent IS NULL THEN 'root' ELSE 'child' END);
  EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE OF deleted_at ON %s FOR EACH ROW EXECUTE FUNCTION app.guard_trash_time()',
    tbl || '_trash_time', rel);
  EXECUTE format('CREATE OR REPLACE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_history()',
    tbl || '_history', rel);

  EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION app.purge_record_links()', tbl || '_links_purge', rel);

  IF parent IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (parent_id, space_id, space_kind) '
      'REFERENCES public.%I (id, space_id, space_kind) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED',
      rel, tbl || '_parent_space_fk', parent);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (parent_id, audience) '
      'REFERENCES public.%I (id, audience) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED',
      rel, tbl || '_parent_audience_fk', parent);
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE INSERT OR UPDATE OF deleted_at, parent_id ON %s FOR EACH ROW EXECUTE FUNCTION app.guard_parent_live(%L)',
      tbl || '_parent_live', rel, parent);
    EXECUTE format('CREATE OR REPLACE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW EXECUTE FUNCTION app.cascade_trash(%L)',
      parent || '_cascade_' || tbl, parent, tbl);
  END IF;
END;
$$;


--> statement-breakpoint
-- Согласуем добавление ссылки с очисткой, в том числе для доступного только на чтение конца.
CREATE OR REPLACE FUNCTION app.link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE endpoint record; visible uuid;
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
