CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','is_identity'];
BEGIN
  IF TG_TABLE_NAME='documents' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  -- Новый вид записи требует явного решения о содержательном вкладе.
  IF TG_TABLE_NAME NOT IN ('notes','note_items','shopping_items','tasks','objects','object_fields','object_events','note_files','object_files','contacts','contact_interactions','utility_accounts','meters','meter_readings','utility_charges','utility_payments','documents','document_files') THEN
    RAISE EXCEPTION 'record contribution rules are not registered' USING ERRCODE = 'check_violation';
  END IF;
  -- Очистка контакта меняет только ссылку, в том числе у события в корзине.
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN
    IF NEW.contact_table IS NOT NULL OR NEW.contact_id IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
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
        IF TG_TABLE_NAME='contacts' AND EXISTS(SELECT 1 FROM public.contact_interactions i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) THEN RAISE EXCEPTION 'children have other contributions' USING ERRCODE='insufficient_privilege'; END IF;
        IF TG_TABLE_NAME='documents' AND EXISTS(SELECT 1 FROM public.document_files f WHERE f.parent_id=OLD.id AND (f.author_id<>OLD.author_id OR f.has_other_contributions)) THEN RAISE EXCEPTION 'children have other contributions' USING ERRCODE='insufficient_privilege'; END IF;
        IF TG_TABLE_NAME = 'notes' AND (EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) OR EXISTS (SELECT 1 FROM public.note_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions))) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'objects' AND (
          EXISTS (SELECT 1 FROM public.meters i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.utility_accounts i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
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
      OR (TG_TABLE_NAME = 'tasks' AND NEW.title IS DISTINCT FROM OLD.title)
      OR (TG_TABLE_NAME = 'objects' AND (NEW.title, to_jsonb(NEW)->'type_data', to_jsonb(NEW)->'object_type') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->'type_data', to_jsonb(OLD)->'object_type'))
      OR (TG_TABLE_NAME = 'shopping_items' AND (NEW.title, to_jsonb(NEW)->>'quantity', to_jsonb(NEW)->>'bought_at') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'quantity', to_jsonb(OLD)->>'bought_at'))
      OR (TG_TABLE_NAME IN ('object_fields', 'object_events','contacts','contact_interactions','utility_accounts','meters','meter_readings','utility_charges','utility_payments','documents','document_files') AND (to_jsonb(NEW) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])) IS DISTINCT FROM (to_jsonb(OLD) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])))
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
    IF TG_ARGV[0] = 'child' OR (TG_TABLE_NAME='documents' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'owner_object_id')=current_setting('app.document_object_id',true)) THEN
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
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id','organization_id','object_id','owner_contact_id','is_identity'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id','organization_id','object_id','owner_contact_id','is_identity'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_TABLE_NAME='documents' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'previous_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_id','is_identity','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meter_readings' THEN new_json := app.reading_decimal_json(new_json); END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND (pg_trigger_depth() > 1 OR current_user='homecrm_owner')
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments','documents','contacts','contact_interactions') THEN
      RETURN NULL;
    END IF;
    operation := 'create';
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json - ARRAY['id', 'created_at']) AS e
      WHERE e.value <> 'null'::jsonb;
  ELSE
    IF OLD.space_kind <> 'household' AND NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments','documents','contacts','contact_interactions') THEN
      RETURN NULL;
    END IF;
    old_json := to_jsonb(OLD) - hidden;
    IF TG_TABLE_NAME='meter_readings' THEN old_json := app.reading_decimal_json(old_json); END IF;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
    IF TG_TABLE_NAME='utility_accounts' AND (to_jsonb(NEW)->'supplier_id') IS DISTINCT FROM (to_jsonb(OLD)->'supplier_id') THEN
      changes := changes || jsonb_build_object('supplier_changed',jsonb_build_object('new',true));
    END IF;
    IF TG_TABLE_NAME='contacts' AND (to_jsonb(NEW)->'organization_id') IS DISTINCT FROM (to_jsonb(OLD)->'organization_id') THEN
      changes := changes || jsonb_build_object('organization_changed',jsonb_build_object('new',true));
    END IF;
    IF TG_TABLE_NAME='contact_interactions' AND (to_jsonb(NEW)->'object_id') IS DISTINCT FROM (to_jsonb(OLD)->'object_id') THEN
      changes := changes || jsonb_build_object('object_changed',jsonb_build_object('new',true));
    END IF;
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
SELECT app.attach_record_table('contact_interactions','contacts');
GRANT UPDATE(organization_id) ON contacts TO homecrm_app;
GRANT SELECT(parent_id) ON contact_interactions TO homecrm_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_search_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d jsonb; source text := TG_ARGV[0]; content text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
    OR TG_TABLE_NAME NOT IN ('notes','note_items','objects','object_fields','object_events','meters','documents','contacts') THEN
    RAISE EXCEPTION 'invalid search source';
  END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.search_index WHERE source_type=source AND source_id=OLD.id;
    RETURN NULL;
  END IF;
  d := to_jsonb(NEW);
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.search_index WHERE source_type=source AND source_id=NEW.id;
    RETURN NULL;
  END IF;
  content := CASE WHEN TG_TABLE_NAME IN ('objects','meters') THEN d->>'search_text' ELSE NEW.title || ' ' || coalesce(d->>'body','') || ' ' || coalesce(d->>'value','') END;
  IF TG_TABLE_NAME='documents' THEN content:=NEW.title || ' ' || CASE NEW.data->>'type' WHEN 'russian_passport' THEN 'Паспорт РФ' WHEN 'international_passport' THEN 'Загранпаспорт' WHEN 'birth_certificate' THEN 'Свидетельство о рождении' WHEN 'snils' THEN 'СНИЛС' WHEN 'inn' THEN 'ИНН' WHEN 'driver_license' THEN 'Водительское удостоверение' WHEN 'oms' THEN 'ОМС' WHEN 'dms' THEN 'ДМС' WHEN 'osago' THEN 'ОСАГО' WHEN 'kasko' THEN 'КАСКО' WHEN 'property_insurance' THEN 'Страхование имущества' WHEN 'sts' THEN 'СТС' WHEN 'pts' THEN 'ПТС' WHEN 'egrn' THEN 'Выписка ЕГРН' WHEN 'contract' THEN 'Договор' WHEN 'warranty_receipt' THEN 'Гарантия и чек' WHEN 'medical' THEN 'Медицинский документ' WHEN 'school' THEN 'Школьный документ' WHEN 'certificate' THEN 'Справка' WHEN 'other' THEN 'Другое' ELSE '' END; END IF;
  IF TG_TABLE_NAME='contacts' THEN content:=NEW.title; END IF;
  INSERT INTO public.search_index(source_type,source_id,access_key,target_id,space_id,space_kind,audience,
    owner_id,author_id,title,content,origin_space_id,origin_space_kind,origin_audience)
  VALUES(source,NEW.id,NEW.space_id::text || ':' || coalesce(NEW.audience::text,'personal'),coalesce((d->>'parent_id')::uuid,NEW.id),NEW.space_id,NEW.space_kind,
    NEW.audience,CASE WHEN NEW.space_kind='personal' THEN NEW.assignee_id END,NEW.author_id,
    NEW.title,content,(d->>'origin_space_id')::uuid,(d->>'origin_space_kind')::public.space_kind,
    (d->>'origin_audience')::public.audience)
  ON CONFLICT(source_type,source_id) DO UPDATE SET
    access_key=EXCLUDED.access_key,target_id=EXCLUDED.target_id,space_id=EXCLUDED.space_id,space_kind=EXCLUDED.space_kind,
    audience=EXCLUDED.audience,owner_id=EXCLUDED.owner_id,author_id=EXCLUDED.author_id,
    title=EXCLUDED.title,content=EXCLUDED.content,origin_space_id=EXCLUDED.origin_space_id,
    origin_space_kind=EXCLUDED.origin_space_kind,origin_audience=EXCLUDED.origin_audience;
  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER contacts_search AFTER INSERT OR UPDATE OR DELETE ON contacts FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry('contact');
--> statement-breakpoint
CREATE FUNCTION app.contact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'contact kind is immutable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.organization_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) AND NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.organization_id AND c.kind='organization' AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.kind<>'person' AND NEW.organization_id IS NOT NULL THEN RAISE EXCEPTION 'only people have an organization' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.contact_guard() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER contacts_01_kind BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION app.contact_guard();
--> statement-breakpoint
CREATE FUNCTION app.interaction_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.contacts;
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND
   (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at','updated_at','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS NOT DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at','updated_at','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
  -- Родитель уже заблокирован внешним UPDATE; после помещения в корзину его нельзя блокировать повторно от имени другого взрослого.
  SELECT * INTO p FROM public.contacts WHERE id=NEW.parent_id;
 ELSE
  SELECT * INTO p FROM public.contacts WHERE id=NEW.parent_id FOR UPDATE;
 END IF;
 IF p.id IS NULL THEN RAISE EXCEPTION 'contact unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF TG_OP='UPDATE' AND NEW.parent_id<>OLD.parent_id THEN RAISE EXCEPTION 'contact is immutable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.object_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.object_id IS DISTINCT FROM OLD.object_id) AND NOT EXISTS(SELECT 1 FROM public.objects o WHERE o.id=NEW.object_id AND o.deleted_at IS NULL) THEN RAISE EXCEPTION 'object unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.space_id<>p.space_id OR NEW.space_kind<>p.space_kind OR NEW.audience IS DISTINCT FROM p.audience THEN RAISE EXCEPTION 'interaction follows contact' USING ERRCODE='insufficient_privilege'; END IF;
 IF p.space_kind='household' AND app.current_account_id() IS NOT NULL AND p.author_id<>app.current_account_id() AND (TG_OP='INSERT' OR (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at','updated_at','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at','updated_at','assignee_house_id','assignee_adult_id','assignee_adult_flag'])) THEN
  UPDATE public.contacts SET has_other_contributions=true WHERE id=p.id AND NOT has_other_contributions;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.interaction_guard() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER contact_interactions_00_contact BEFORE INSERT OR UPDATE ON contact_interactions FOR EACH ROW EXECUTE FUNCTION app.interaction_guard();
--> statement-breakpoint
CREATE FUNCTION app.cascade_contact_placement() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
 UPDATE public.contact_interactions SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.cascade_contact_placement() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER contacts_placement AFTER UPDATE OF space_id,space_kind,audience ON contacts FOR EACH ROW EXECUTE FUNCTION app.cascade_contact_placement();
