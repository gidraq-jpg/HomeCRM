-- Custom SQL migration file, put your code below! --
-- Полиморфная ссылка читает только таблицы, подключённые attach_record_table, с правами вызывающего.
CREATE FUNCTION app.placement_visible(sid uuid, sk public.space_kind, aud public.audience) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (sk = 'personal' AND EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = sid AND s.owner_account_id = app.current_account_id()))
    OR (sk = 'household' AND EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = sid
      AND m.account_id = app.current_account_id() AND m.left_at IS NULL AND (aud = 'household' OR m.role IN ('adult', 'admin'))));
$$;
--> statement-breakpoint
CREATE FUNCTION app.record_ref_allowed(tbl text, rid uuid, writing boolean DEFAULT false) RETURNS boolean
  LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE r record;
BEGIN
  IF tbl IS NULL OR rid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = tbl
      AND t.tgfoid = 'app.record_defaults()'::regprocedure AND NOT t.tgisinternal
  ) THEN RETURN false; END IF;
  EXECUTE format('SELECT space_id, space_kind, audience, assignee_id, deleted_at FROM public.%I WHERE id = $1', tbl) INTO r USING rid;
  IF r.space_id IS NULL OR NOT app.placement_visible(r.space_id, r.space_kind, r.audience) THEN RETURN false; END IF;
  IF NOT writing THEN RETURN true; END IF;
  RETURN r.deleted_at IS NULL AND (r.space_kind = 'personal' OR tbl = 'shopping_items'
    OR (tbl = 'tasks' AND r.assignee_id = app.current_account_id())
    OR EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = r.space_id
      AND m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult', 'admin')));
END;
$$;
--> statement-breakpoint
-- Прежде отложенного FK: одинаковый отказ для отсутствующего и скрытого родителя, в том числе в корзине.
CREATE OR REPLACE FUNCTION app.guard_parent_live() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE parent_trashed boolean;
BEGIN
  EXECUTE format('SELECT p.deleted_at IS NOT NULL FROM public.%I p WHERE p.id = $1', TG_ARGV[0]) INTO parent_trashed USING NEW.parent_id;
  IF app.current_account_id() IS NOT NULL AND parent_trashed IS NULL THEN
    RAISE EXCEPTION 'parent unavailable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.deleted_at IS NULL AND parent_trashed THEN
    RAISE EXCEPTION 'parent unavailable' USING ERRCODE = 'insufficient_privilege';
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
ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks_history NO FORCE ROW LEVEL SECURITY;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE tasks DISABLE TRIGGER USER;
UPDATE tasks r SET has_other_contributions = EXISTS (SELECT 1 FROM tasks_history h WHERE h.record_id = r.id AND h.actor_id <> r.author_id AND h.changes ?| ARRAY['title']);
ALTER TABLE tasks ENABLE TRIGGER USER;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE shopping_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_items_history NO FORCE ROW LEVEL SECURITY;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE shopping_items DISABLE TRIGGER USER;
UPDATE shopping_items r SET has_other_contributions = EXISTS (SELECT 1 FROM shopping_items_history h WHERE h.record_id = r.id AND h.actor_id <> r.author_id AND h.changes ?| ARRAY['title', 'quantity', 'bought_at']);
ALTER TABLE shopping_items ENABLE TRIGGER USER;
ALTER TABLE shopping_items FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_items_history FORCE ROW LEVEL SECURITY;
