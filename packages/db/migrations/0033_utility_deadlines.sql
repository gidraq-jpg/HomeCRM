ALTER TABLE "meters" ADD COLUMN "is_active" boolean GENERATED ALWAYS AS (data->>'status'='active') STORED;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "source_kind" text DEFAULT 'record' NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "utility_account_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "meter_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_account_id_utility_accounts_id_fk" FOREIGN KEY ("utility_account_id") REFERENCES "public"."utility_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_account_kind_key" UNIQUE("utility_account_id","source_kind");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_meter_kind_key" UNIQUE("meter_id","source_kind");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_source" CHECK ((source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL))));--> statement-breakpoint
CREATE POLICY "meter_readings_deadline_worker_select" ON "meter_readings" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM meters m WHERE m.id=meter_readings.parent_id));--> statement-breakpoint
CREATE POLICY "meters_deadline_worker_select" ON "meters" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id=meters.parent_id AND d.source_kind<>'record'));--> statement-breakpoint
CREATE POLICY "deadline_occurrences_complete_payment" ON "deadline_occurrences" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND d.source_kind='payment' AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true))) WITH CHECK (deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND d.source_kind='payment' AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true)));--> statement-breakpoint
CREATE POLICY "deadlines_utility_insert" ON "deadlines" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_utility_update" ON "deadlines" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active'];
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  -- Новый вид записи требует явного решения о содержательном вкладе.
  IF TG_TABLE_NAME NOT IN ('notes','note_items','shopping_items','tasks','objects','object_fields','object_events','note_files','object_files','contacts','utility_accounts','meters','meter_readings') THEN
    RAISE EXCEPTION 'record contribution rules are not registered' USING ERRCODE = 'check_violation';
  END IF;
  -- Очистка контакта меняет только ссылку, в том числе у события в корзине.
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN
    IF NEW.contact_table IS NOT NULL OR NEW.contact_id IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['contact_table','contact_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['contact_table','contact_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
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
      OR (TG_TABLE_NAME IN ('object_fields', 'object_events','contacts','utility_accounts','meters','meter_readings') AND (to_jsonb(NEW) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])) IS DISTINCT FROM (to_jsonb(OLD) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])))
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
CREATE OR REPLACE FUNCTION app.record_defaults() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
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
CREATE OR REPLACE FUNCTION app.lock_object_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p public.objects; changed boolean := true;
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'reparenting is not supported' USING ERRCODE = 'insufficient_privilege';
    END IF;
    changed := (to_jsonb(NEW) - ARRAY['updated_at', 'deleted_at', 'space_id', 'space_kind', 'audience', 'assignee_id', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'search_text','is_active'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'deleted_at', 'space_id', 'space_kind', 'audience', 'assignee_id', 'has_other_contributions', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'search_text','is_active']);
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
CREATE OR REPLACE FUNCTION app.meter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.previous_meter_id IS DISTINCT FROM OLD.previous_meter_id THEN
    RAISE EXCEPTION 'replacement link is immutable' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='INSERT' OR NEW.utility_account_id IS DISTINCT FROM OLD.utility_account_id THEN
    IF NEW.utility_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.utility_accounts a WHERE a.id=NEW.utility_account_id AND a.parent_id=NEW.parent_id AND a.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'account unavailable' USING ERRCODE='insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.previous_meter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.meters m WHERE m.id=NEW.previous_meter_id AND m.parent_id=NEW.parent_id AND m.deleted_at IS NULL AND m.data->>'status'='replaced') THEN
    RAISE EXCEPTION 'previous meter unavailable' USING ERRCODE='insufficient_privilege';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.data->'zones',NEW.data->'integerDigits',NEW.data->'fractionDigits',NEW.data->'resource') IS DISTINCT FROM (OLD.data->'zones',OLD.data->'integerDigits',OLD.data->'fractionDigits',OLD.data->'resource') AND EXISTS (SELECT 1 FROM public.meter_readings r WHERE r.parent_id=OLD.id) THEN
    RAISE EXCEPTION 'precision of recorded meter is immutable' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='UPDATE' AND OLD.data->>'status'='replaced' AND NEW.data->>'status'<>'replaced' THEN
    RAISE EXCEPTION 'replaced meter cannot be reactivated' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meter_readings' THEN new_json := app.reading_decimal_json(new_json); END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND (pg_trigger_depth() > 1 OR current_user='homecrm_owner')
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
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
    IF TG_TABLE_NAME='meter_readings' THEN old_json := app.reading_decimal_json(old_json); END IF;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
    IF TG_TABLE_NAME='utility_accounts' AND (to_jsonb(NEW)->'supplier_id') IS DISTINCT FROM (to_jsonb(OLD)->'supplier_id') THEN
      changes := changes || jsonb_build_object('supplier_changed',jsonb_build_object('new',true));
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
CREATE OR REPLACE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p record; tbl text; rid uuid; cascading boolean;
BEGIN
 cascading := pg_trigger_depth()>1 AND coalesce(NEW.note_id,NEW.object_id)=nullif(current_setting('app.deadline_source_id',true),'')::uuid;
 IF NEW.source_kind<>'record' AND coalesce(NEW.utility_account_id,NEW.meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') THEN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.object_id,NEW.source_kind,NEW.utility_account_id,NEW.meter_id,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.object_id,OLD.source_kind,OLD.utility_account_id,OLD.meter_id,OLD.author_id,OLD.created_at) THEN
   RAISE EXCEPTION 'immutable utility source' USING ERRCODE='insufficient_privilege';
  END IF;
  SELECT * INTO p FROM public.objects WHERE id=NEW.object_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
  IF p.space_kind='household' THEN NEW.household_id:=p.space_id; END IF;
  NEW.deleted_at:=coalesce(p.deleted_at,NEW.deleted_at); NEW.updated_at:=now(); NEW.needs_refresh:=true;
  RETURN NEW;
 END IF;
 IF NEW.source_kind<>'record' AND current_user<>'homecrm_worker' AND NOT cascading THEN
  RAISE EXCEPTION 'edit utility source instead' USING ERRCODE='insufficient_privilege';
 END IF;
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
GRANT SELECT(source_kind,utility_account_id,meter_id) ON deadlines TO homecrm_worker;
GRANT SELECT(utility_account_id,is_active) ON meters TO homecrm_worker;
GRANT SELECT(occurred_on,transmitted_at) ON meter_readings TO homecrm_worker;
GRANT UPDATE(completed_at) ON deadline_occurrences TO homecrm_app;
--> statement-breakpoint
-- Один и тот же критерий закрытия в радаре, очереди и перед самой отправкой. Права вызывающего, без обхода RLS.
CREATE FUNCTION app.utility_window_open(account_id uuid, starts_at timestamptz, ends_at timestamptz, zone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=$1 AND m.deleted_at IS NULL AND m.is_active)
 AND EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=$1 AND m.deleted_at IS NULL AND m.is_active
  AND NOT EXISTS (SELECT 1 FROM public.meter_readings r WHERE r.parent_id=m.id AND r.deleted_at IS NULL AND r.transmitted_at IS NOT NULL
    AND r.occurred_on BETWEEN ($2 AT TIME ZONE $4)::date AND ($3 AT TIME ZONE $4)::date));
$$;
REVOKE ALL ON FUNCTION app.utility_window_open(uuid,timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.utility_window_open(uuid,timestamptz,timestamptz,text) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.put_utility_deadline(kind text, source_id uuid, parent_id uuid, author_id uuid, rule jsonb, trashed_at timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.objects; house uuid; prior_source text:=current_setting('app.utility_source_id',true); prior_object text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF pg_trigger_depth()=0 AND current_user<>'homecrm_owner' THEN RAISE EXCEPTION 'trigger only' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO p FROM public.objects WHERE id=parent_id;
 IF p.id IS NULL THEN RETURN; END IF;
 house:=CASE WHEN p.space_kind='household' THEN p.space_id ELSE
  coalesce((SELECT d.household_id FROM public.deadlines d WHERE d.object_id=p.id ORDER BY d.created_at,d.id LIMIT 1),
  (SELECT m.space_id FROM public.space_members m WHERE m.account_id=p.author_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN; END IF;
 PERFORM set_config('app.utility_source_id',source_id::text,true);
 PERFORM set_config('app.deadline_source_id',parent_id::text,true);
 IF rule IS NULL OR rule='null'::jsonb THEN
  UPDATE public.deadlines d SET deleted_at=coalesce(d.deleted_at,now()),needs_refresh=true
   WHERE d.source_kind=kind AND coalesce(d.utility_account_id,d.meter_id)=source_id AND d.deleted_at IS NULL;
 ELSE
  INSERT INTO public.deadlines(object_id,source_kind,utility_account_id,meter_id,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
  VALUES(parent_id,kind,CASE WHEN kind<>'verification' THEN source_id END,CASE WHEN kind='verification' THEN source_id END,
   house,rule,p.space_id,p.space_kind,p.audience,author_id,p.assignee_id,coalesce(p.deleted_at,trashed_at))
  ON CONFLICT DO NOTHING;
  UPDATE public.deadlines d SET rule=put_utility_deadline.rule,deleted_at=coalesce(p.deleted_at,trashed_at),needs_refresh=true
   WHERE d.source_kind=kind AND coalesce(d.utility_account_id,d.meter_id)=source_id
   AND (d.rule,d.deleted_at,d.space_id,d.audience,d.assignee_id) IS DISTINCT FROM (put_utility_deadline.rule,coalesce(p.deleted_at,trashed_at),p.space_id,p.audience,p.assignee_id);
 END IF;
 PERFORM set_config('app.utility_source_id',coalesce(prior_source,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_object,''),true);
END; $$;
REVOKE ALL ON FUNCTION app.put_utility_deadline(text,uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.put_utility_deadline(text,uuid,uuid,uuid,jsonb,timestamptz) TO homecrm_app;
--> statement-breakpoint
CREATE FUNCTION app.utility_source_deadlines() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='utility_accounts' THEN
  r:=NEW.data->'readingRule';
  IF NEW.data->'transmission'->>'method' IN ('automatic','not_required') THEN r:=NULL; END IF;
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',CASE WHEN coalesce(r->'warnings','[]')='[]'::jsonb THEN '[0]'::jsonb ELSE r->'warnings' END,'endWarnings',coalesce(r->'endWarnings','[1,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('readings',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
  r:=NEW.data->'paymentRule';
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',CASE WHEN coalesce(r->'warnings','[]')='[]'::jsonb THEN '[3,0]'::jsonb ELSE r->'warnings' END);
  END IF;
  PERFORM app.put_utility_deadline('payment',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
 ELSE
  r:=CASE WHEN NEW.data->>'nextVerificationOn' IS NOT NULL AND NEW.data->>'status'='active' THEN
   jsonb_build_object('kind','date','date',NEW.data->>'nextVerificationOn','time','00:00','durationDays',0,'warnings',coalesce(NEW.data->'verificationWarnings','[60,30,7]'::jsonb),'warningTime',coalesce(NEW.data->>'verificationWarningTime','09:00')) END;
  PERFORM app.put_utility_deadline('verification',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
 END IF;
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.utility_source_deadlines() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER utility_accounts_deadlines AFTER INSERT OR UPDATE OF data,space_id,space_kind,audience,deleted_at ON utility_accounts FOR EACH ROW EXECUTE FUNCTION app.utility_source_deadlines();
CREATE TRIGGER meters_deadlines AFTER INSERT OR UPDATE OF data,space_id,space_kind,audience,deleted_at ON meters FOR EACH ROW EXECUTE FUNCTION app.utility_source_deadlines();
--> statement-breakpoint
-- Отметить оплату разрешено только для платежа и без изменения производных календарных полей.
CREATE OR REPLACE FUNCTION app.guard_occurrence_cascade() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user='homecrm_app' THEN
  IF (to_jsonb(NEW)-'completed_at')=(to_jsonb(OLD)-'completed_at') AND EXISTS
   (SELECT 1 FROM public.deadlines d WHERE d.id=NEW.deadline_id AND d.source_kind='payment' AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true)) THEN RETURN NEW; END IF;
  IF pg_trigger_depth()<2 OR NEW.deadline_id<>nullif(current_setting('app.deadline_cascade_id',true),'')::uuid OR
   (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) THEN
   RAISE EXCEPTION 'occurrence is derived' USING ERRCODE='insufficient_privilege'; END IF;
 END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
-- Разовый backfill только производных правил. Временные политики владельца удаляются в этой же транзакции.
CREATE POLICY utility_seed ON objects TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY utility_seed ON utility_accounts FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY utility_seed ON meters FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY utility_seed ON space_members FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY utility_seed ON deadlines TO homecrm_owner USING (true) WITH CHECK (true);
DO $$ DECLARE a record; r jsonb; BEGIN
 FOR a IN SELECT * FROM public.utility_accounts LOOP
  r:=a.data->'readingRule';
  IF a.data->'transmission'->>'method' IN ('automatic','not_required') THEN r:=NULL; END IF;
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',CASE WHEN coalesce(r->'warnings','[]')='[]'::jsonb THEN '[0]'::jsonb ELSE r->'warnings' END,'endWarnings',coalesce(r->'endWarnings','[1,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('readings',a.id,a.parent_id,a.author_id,r,a.deleted_at);
  r:=a.data->'paymentRule';
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',CASE WHEN coalesce(r->'warnings','[]')='[]'::jsonb THEN '[3,0]'::jsonb ELSE r->'warnings' END);
  END IF;
  PERFORM app.put_utility_deadline('payment',a.id,a.parent_id,a.author_id,r,a.deleted_at);
 END LOOP;
 FOR a IN SELECT * FROM public.meters LOOP
  r:=CASE WHEN a.data->>'nextVerificationOn' IS NOT NULL AND a.data->>'status'='active' THEN
   jsonb_build_object('kind','date','date',a.data->>'nextVerificationOn','time','00:00','durationDays',0,'warnings',coalesce(a.data->'verificationWarnings','[60,30,7]'::jsonb),'warningTime',coalesce(a.data->>'verificationWarningTime','09:00')) END;
  PERFORM app.put_utility_deadline('verification',a.id,a.parent_id,a.author_id,r,a.deleted_at);
 END LOOP;
END $$;
DROP POLICY utility_seed ON objects;
DROP POLICY utility_seed ON utility_accounts;
DROP POLICY utility_seed ON meters;
DROP POLICY utility_seed ON space_members;
DROP POLICY utility_seed ON deadlines;
