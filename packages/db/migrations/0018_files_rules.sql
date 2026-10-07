-- OBJ-4: подключение дочерних записей и отдельный реестр случайных ключей.
SELECT app.attach_record_table('note_files', 'notes');
--> statement-breakpoint
SELECT app.attach_record_table('object_files', 'objects');
--> statement-breakpoint
ALTER TABLE file_blobs FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON file_blobs TO homecrm_app;
GRANT SELECT, DELETE ON file_blobs TO homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.file_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE parent_author uuid; parent_kind public.space_kind;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.file_blobs WHERE key IN (OLD.storage_key, OLD.preview_storage_key);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.parent_id, NEW.storage_key, NEW.envelope, NEW.preview_storage_key, NEW.preview_envelope, NEW.mime_type, NEW.size_bytes)
    IS DISTINCT FROM (OLD.parent_id, OLD.storage_key, OLD.envelope, OLD.preview_storage_key, OLD.preview_envelope, OLD.mime_type, OLD.size_bytes) THEN
    RAISE EXCEPTION 'file content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.size_bytes < 1 OR NEW.size_bytes > 26214400 OR NEW.mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf')
    OR (NEW.preview_storage_key IS NULL) <> (NEW.preview_envelope IS NULL) THEN
    RAISE EXCEPTION 'invalid file metadata' USING ERRCODE = 'check_violation';
  END IF;
  -- Родитель блокируется до изменения: перенос в личное и чужой вклад сериализованы.
  IF pg_trigger_depth() = 1 AND app.current_account_id() IS NOT NULL THEN
    EXECUTE format('SELECT author_id,space_kind FROM public.%I WHERE id=$1 FOR UPDATE', TG_ARGV[0])
      INTO parent_author,parent_kind USING NEW.parent_id;
    IF parent_author IS NULL THEN RAISE EXCEPTION 'parent unavailable' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF parent_kind = 'household' AND parent_author <> app.current_account_id() AND
      (TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
      EXECUTE format('UPDATE public.%I SET has_other_contributions=true WHERE id=$1',TG_ARGV[0]) USING NEW.parent_id;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_blobs(key) VALUES (NEW.storage_key);
    IF NEW.preview_storage_key IS NOT NULL THEN INSERT INTO public.file_blobs(key) VALUES (NEW.preview_storage_key); END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER note_files_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON note_files FOR EACH ROW EXECUTE FUNCTION app.file_lifecycle('notes');
CREATE TRIGGER object_files_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON object_files FOR EACH ROW EXECUTE FUNCTION app.file_lifecycle('objects');
--> statement-breakpoint
CREATE FUNCTION app.cascade_file_placement() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    EXECUTE format('UPDATE public.%I SET space_id=$1,space_kind=$2,audience=$3 WHERE parent_id=$4',TG_ARGV[0])
      USING NEW.space_id,NEW.space_kind,NEW.audience,NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notes_files_placement AFTER UPDATE OF space_id,space_kind,audience ON notes FOR EACH ROW EXECUTE FUNCTION app.cascade_file_placement('note_files');
CREATE TRIGGER objects_files_placement AFTER UPDATE OF space_id,space_kind,audience ON objects FOR EACH ROW EXECUTE FUNCTION app.cascade_file_placement('object_files');
--> statement-breakpoint
CREATE FUNCTION app.guard_profile_file() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.photo_file_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.note_files f JOIN public.notes p ON p.id=f.parent_id
      WHERE f.id=NEW.photo_file_id AND f.author_id=NEW.account_id AND f.deleted_at IS NULL AND p.deleted_at IS NULL AND f.mime_type LIKE 'image/%'
    UNION ALL
    SELECT 1 FROM public.object_files f JOIN public.objects p ON p.id=f.parent_id
      WHERE f.id=NEW.photo_file_id AND f.author_id=NEW.account_id AND f.deleted_at IS NULL AND p.deleted_at IS NULL AND f.mime_type LIKE 'image/%'
  ) THEN RAISE EXCEPTION 'profile file unavailable' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER member_profiles_file BEFORE INSERT OR UPDATE OF photo_file_id ON member_profiles FOR EACH ROW EXECUTE FUNCTION app.guard_profile_file();

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
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','storage_key','envelope','preview_storage_key','preview_envelope'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','storage_key','envelope','preview_storage_key','preview_envelope'];
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
GRANT SELECT(parent_id) ON note_files,object_files TO homecrm_worker;
