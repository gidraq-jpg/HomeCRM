SELECT app.attach_record_table('objects');
--> statement-breakpoint
SELECT app.attach_record_table('object_fields', 'objects');
--> statement-breakpoint
SELECT app.attach_record_table('object_events', 'objects');
--> statement-breakpoint
CREATE FUNCTION app.cascade_object_placement() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id, NEW.space_kind, NEW.audience) IS DISTINCT FROM (OLD.space_id, OLD.space_kind, OLD.audience) THEN
    UPDATE public.object_fields SET space_id = NEW.space_id, space_kind = NEW.space_kind, audience = NEW.audience WHERE parent_id = NEW.id;
    UPDATE public.object_events SET space_id = NEW.space_id, space_kind = NEW.space_kind, audience = NEW.audience WHERE parent_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER objects_placement AFTER UPDATE OF space_id, space_kind, audience ON objects FOR EACH ROW EXECUTE FUNCTION app.cascade_object_placement();
--> statement-breakpoint
CREATE FUNCTION app.lock_object_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p public.objects; changed boolean := true;
BEGIN
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'reparenting is not supported' USING ERRCODE = 'insufficient_privilege';
    END IF;
    changed := (to_jsonb(NEW) - ARRAY['updated_at', 'deleted_at', 'space_id', 'space_kind', 'audience', 'assignee_id', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'search_text'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'deleted_at', 'space_id', 'space_kind', 'audience', 'assignee_id', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'search_text']);
  END IF;
  IF NOT changed THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.objects WHERE id = NEW.parent_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'parent unavailable' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF changed AND p.space_kind = 'household' AND app.current_account_id() IS NOT NULL AND p.author_id <> app.current_account_id() THEN
    UPDATE public.objects SET has_other_contributions = true WHERE id = p.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.object_field_limits() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
  IF length(NEW.title) NOT BETWEEN 1 AND 100 OR length(NEW.value) > 4000 OR NEW.position NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'invalid field' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deleted_at IS NULL AND (SELECT count(*) FROM public.object_fields f WHERE f.parent_id=NEW.parent_id AND f.deleted_at IS NULL AND f.id<>NEW.id) >= 50 THEN
    RAISE EXCEPTION 'too many fields' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER object_fields_01_limits BEFORE INSERT OR UPDATE ON object_fields FOR EACH ROW EXECUTE FUNCTION app.object_field_limits();
--> statement-breakpoint
CREATE TRIGGER object_fields_00_parent_lock BEFORE INSERT OR UPDATE ON object_fields FOR EACH ROW EXECUTE FUNCTION app.lock_object_parent();
--> statement-breakpoint
CREATE TRIGGER object_events_00_parent_lock BEFORE INSERT OR UPDATE ON object_events FOR EACH ROW EXECUTE FUNCTION app.lock_object_parent();
--> statement-breakpoint
CREATE FUNCTION app.event_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
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
CREATE TRIGGER object_events_01_snapshot BEFORE INSERT OR UPDATE ON object_events FOR EACH ROW EXECUTE FUNCTION app.event_snapshot();
--> statement-breakpoint
CREATE FUNCTION app.link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
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
--> statement-breakpoint
ALTER TABLE record_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON record_links TO homecrm_app;
--> statement-breakpoint
GRANT UPDATE (role, deleted_at) ON record_links TO homecrm_app;
--> statement-breakpoint
GRANT SELECT (id, left_table, left_id, right_table, right_id, deleted_at), DELETE ON record_links TO homecrm_worker;
--> statement-breakpoint
CREATE TRIGGER record_links_guard BEFORE INSERT OR UPDATE ON record_links FOR EACH ROW EXECUTE FUNCTION app.link_guard();
--> statement-breakpoint
-- После физической очистки любого конца связь уходит вместе с ним. Runtime по-прежнему под RLS.
CREATE FUNCTION app.purge_record_links() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  DELETE FROM public.record_links WHERE (left_table = TG_TABLE_NAME AND left_id = OLD.id) OR (right_table = TG_TABLE_NAME AND right_id = OLD.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
  FOR tbl IN SELECT c.relname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND t.tgfoid = 'app.record_defaults()'::regprocedure AND NOT t.tgisinternal LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.purge_record_links()', tbl || '_links_purge', tbl);
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

  EXECUTE format('CREATE OR REPLACE TRIGGER %I AFTER DELETE ON %s FOR EACH ROW EXECUTE FUNCTION app.purge_record_links()', tbl || '_links_purge', rel);

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

