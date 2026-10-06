ALTER TABLE "note_items" ADD COLUMN "has_other_contributions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "note_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "has_other_contributions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "search_text" text GENERATED ALWAYS AS (title || ' ' || body) STORED;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "has_other_contributions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "has_other_contributions" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE notes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notes_history NO FORCE ROW LEVEL SECURITY;
-- Владелец миграции не видит spaces под FORCE RLS. Нормализацию ответственного
-- тоже отключаем, чтобы служебное заполнение не меняло существующие записи.
ALTER TABLE notes DISABLE TRIGGER notes_defaults;
ALTER TABLE notes DISABLE TRIGGER notes_history;
ALTER TABLE notes DISABLE TRIGGER notes_guard;
UPDATE notes r SET has_other_contributions = EXISTS (
  SELECT 1 FROM notes_history h WHERE h.record_id = r.id AND h.actor_id IS NOT NULL AND h.actor_id <> r.author_id
);
ALTER TABLE notes ENABLE TRIGGER notes_defaults;
ALTER TABLE notes ENABLE TRIGGER notes_history;
ALTER TABLE notes ENABLE TRIGGER notes_guard;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
ALTER TABLE notes_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE note_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items_history NO FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items DISABLE TRIGGER note_items_defaults;
ALTER TABLE note_items DISABLE TRIGGER note_items_history;
ALTER TABLE note_items DISABLE TRIGGER note_items_guard;
UPDATE note_items r SET has_other_contributions = EXISTS (
  SELECT 1 FROM note_items_history h WHERE h.record_id = r.id AND h.actor_id IS NOT NULL AND h.actor_id <> r.author_id
);
ALTER TABLE note_items ENABLE TRIGGER note_items_defaults;
ALTER TABLE note_items ENABLE TRIGGER note_items_history;
ALTER TABLE note_items ENABLE TRIGGER note_items_guard;
ALTER TABLE note_items FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE shopping_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_items_history NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_items DISABLE TRIGGER shopping_items_defaults;
ALTER TABLE shopping_items DISABLE TRIGGER shopping_items_history;
ALTER TABLE shopping_items DISABLE TRIGGER shopping_items_guard;
UPDATE shopping_items r SET has_other_contributions = EXISTS (
  SELECT 1 FROM shopping_items_history h WHERE h.record_id = r.id AND h.actor_id IS NOT NULL AND h.actor_id <> r.author_id
);
ALTER TABLE shopping_items ENABLE TRIGGER shopping_items_defaults;
ALTER TABLE shopping_items ENABLE TRIGGER shopping_items_history;
ALTER TABLE shopping_items ENABLE TRIGGER shopping_items_guard;
ALTER TABLE shopping_items FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_items_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks_history NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE TRIGGER tasks_defaults;
ALTER TABLE tasks DISABLE TRIGGER tasks_history;
ALTER TABLE tasks DISABLE TRIGGER tasks_guard;
UPDATE tasks r SET has_other_contributions = EXISTS (
  SELECT 1 FROM tasks_history h WHERE h.record_id = r.id AND h.actor_id IS NOT NULL AND h.actor_id <> r.author_id
);
ALTER TABLE tasks ENABLE TRIGGER tasks_defaults;
ALTER TABLE tasks ENABLE TRIGGER tasks_history;
ALTER TABLE tasks ENABLE TRIGGER tasks_guard;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE notes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items_history NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notes DISABLE TRIGGER notes_defaults;
ALTER TABLE notes DISABLE TRIGGER notes_history;
ALTER TABLE notes DISABLE TRIGGER notes_guard;
UPDATE notes n SET has_other_contributions = true WHERE EXISTS (
  SELECT 1 FROM note_items i WHERE i.parent_id = n.id AND (i.author_id <> n.author_id OR EXISTS (
    SELECT 1 FROM note_items_history h WHERE h.record_id = i.id AND h.actor_id IS NOT NULL AND h.actor_id <> n.author_id
  ))
) OR EXISTS (
  SELECT 1 FROM note_items_history h WHERE h.actor_id IS NOT NULL AND h.actor_id <> n.author_id
  AND (h.changes->'parent_id'->>'new' = n.id::text OR h.changes->'parent_id'->>'old' = n.id::text)
);
ALTER TABLE notes ENABLE TRIGGER notes_defaults;
ALTER TABLE notes ENABLE TRIGGER notes_history;
ALTER TABLE notes ENABLE TRIGGER notes_guard;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items FORCE ROW LEVEL SECURITY;
ALTER TABLE note_items_history FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_defaults() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
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
      ELSE
        RAISE EXCEPTION 'use a copy to change households or personal owners' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  IF app.current_account_id() IS NOT NULL AND app.current_account_id() <> OLD.author_id AND
    (OLD.space_kind = 'household' OR NEW.space_kind = 'household') AND
    (to_jsonb(NEW) - array_remove(ignored, 'deleted_at')) IS DISTINCT FROM (to_jsonb(OLD) - array_remove(ignored, 'deleted_at')) THEN
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
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.space_kind <> 'household' THEN
      RETURN NULL;
    END IF;
    operation := 'create';
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json - ARRAY['id', 'created_at']) AS e
      WHERE e.value <> 'null'::jsonb;
  ELSE
    IF OLD.space_kind <> 'household' AND NEW.space_kind <> 'household' THEN
      RETURN NULL;
    END IF;
    old_json := to_jsonb(OLD) - hidden;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
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
SELECT app.attach_record_table('notes');
--> statement-breakpoint
SELECT app.grant_record_table('note_items');
--> statement-breakpoint
SELECT app.grant_record_table('shopping_items');
--> statement-breakpoint
SELECT app.grant_record_table('tasks');
--> statement-breakpoint
-- Дочерние записи переезжают вместе с заметкой. Даже пункты в корзине сохраняют её место.
CREATE FUNCTION app.cascade_note_placement() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id, NEW.space_kind, NEW.audience) IS DISTINCT FROM (OLD.space_id, OLD.space_kind, OLD.audience) THEN
    UPDATE public.note_items SET space_id = NEW.space_id, space_kind = NEW.space_kind, audience = NEW.audience
      WHERE parent_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notes_placement AFTER UPDATE OF space_id, space_kind, audience ON notes
  FOR EACH ROW EXECUTE FUNCTION app.cascade_note_placement();
--> statement-breakpoint
-- Чужой вклад в пункт остаётся вкладом в заметку даже после корзины или смены родителя.
-- Блокировка родителя сериализует изменение пункта с «Сделать личной».
CREATE FUNCTION app.lock_note_parent() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  parents uuid[];
  parent_row public.notes;
  changed boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    parents := ARRAY[OLD.parent_id, NEW.parent_id];
    changed := (to_jsonb(NEW) - ARRAY['updated_at', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag']);
  ELSE
    parents := ARRAY[NEW.parent_id];
  END IF;
  FOR parent_row IN SELECT n.* FROM public.notes n WHERE n.id = ANY(parents) ORDER BY n.id FOR UPDATE LOOP
    IF changed AND parent_row.space_kind = 'household' AND app.current_account_id() IS NOT NULL
      AND parent_row.author_id <> app.current_account_id() THEN
      UPDATE public.notes SET has_other_contributions = true WHERE id = parent_row.id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER note_items_00_parent_lock BEFORE INSERT OR UPDATE ON note_items
  FOR EACH ROW EXECUTE FUNCTION app.lock_note_parent();
--> statement-breakpoint
-- Более широкая политика каскада служит только переносу места. Восстановление чужого пункта
-- по-прежнему оставляет его в корзине; восстановить сможет администратор.
CREATE OR REPLACE FUNCTION app.cascade_trash() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET deleted_at = $1 WHERE parent_id = $2 AND deleted_at IS NULL', TG_ARGV[0])
      USING NEW.deleted_at, NEW.id;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    EXECUTE format('UPDATE public.%I SET deleted_at = NULL WHERE parent_id = $1 AND deleted_at = $2 '
      'AND (app.current_account_id() IS NULL OR space_kind = ''personal'' OR author_id = app.current_account_id() '
      'OR space_id IN (SELECT m.space_id FROM public.space_members m WHERE m.account_id = app.current_account_id() '
      'AND m.left_at IS NULL AND m.role = ''admin''))', TG_ARGV[0]) USING NEW.id, OLD.deleted_at;
  END IF;
  RETURN NULL;
END;
$$;
