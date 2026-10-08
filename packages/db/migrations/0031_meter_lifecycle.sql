-- Преобразование numeric[] в JSON истории сохраняет точность для клиента JavaScript.
CREATE FUNCTION app.reading_decimal_json(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (value - 'values' - 'consumption') || jsonb_build_object(
    'values', (SELECT jsonb_agg(v) FROM jsonb_array_elements_text(value->'values') v),
    'consumption', CASE WHEN value->'consumption'='null'::jsonb THEN NULL ELSE (SELECT jsonb_agg(v) FROM jsonb_array_elements_text(value->'consumption') v) END);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reading_decimal_json(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reading_decimal_json(jsonb) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
SELECT app.attach_record_table('meters','objects');
--> statement-breakpoint
SELECT app.attach_record_table('meter_readings','meters');
--> statement-breakpoint
CREATE TRIGGER meters_00_parent_lock BEFORE INSERT OR UPDATE ON meters FOR EACH ROW EXECUTE FUNCTION app.lock_object_parent();
--> statement-breakpoint
CREATE FUNCTION app.meter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.meter_guard() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
--> statement-breakpoint
CREATE TRIGGER meters_01_config BEFORE INSERT OR UPDATE ON meters FOR EACH ROW EXECUTE FUNCTION app.meter_guard();
--> statement-breakpoint
CREATE FUNCTION app.lock_reading_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m public.meters; p public.objects; changed boolean := true;
BEGIN
  IF current_user='homecrm_worker' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN RAISE EXCEPTION 'reparenting is not supported' USING ERRCODE='insufficient_privilege'; END IF;
    changed := (NEW.values,NEW.occurred_on,NEW.comment,NEW.rollover,NEW.transmitted_at,NEW.transmission_method) IS DISTINCT FROM (OLD.values,OLD.occurred_on,OLD.comment,OLD.rollover,OLD.transmitted_at,OLD.transmission_method);
  END IF;
  IF NOT changed THEN RETURN NEW; END IF;
  SELECT * INTO m FROM public.meters WHERE id=NEW.parent_id;
  SELECT * INTO p FROM public.objects WHERE id=m.parent_id FOR UPDATE;
  SELECT * INTO m FROM public.meters WHERE id=NEW.parent_id FOR UPDATE;
  IF m.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'parent unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  IF p.space_kind='household' AND app.current_account_id() IS NOT NULL THEN
    IF p.author_id<>app.current_account_id() THEN UPDATE public.objects SET has_other_contributions=true WHERE id=p.id; END IF;
    IF m.author_id<>app.current_account_id() THEN UPDATE public.meters SET has_other_contributions=true WHERE id=m.id; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lock_reading_parent() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
--> statement-breakpoint
CREATE TRIGGER meter_readings_00_parent_lock BEFORE INSERT OR UPDATE ON meter_readings FOR EACH ROW EXECUTE FUNCTION app.lock_reading_parent();
--> statement-breakpoint
CREATE FUNCTION app.cascade_meter_placement() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    UPDATE public.meter_readings SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.cascade_meter_placement() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
--> statement-breakpoint
CREATE TRIGGER meters_placement AFTER UPDATE OF space_id,space_kind,audience ON meters FOR EACH ROW EXECUTE FUNCTION app.cascade_meter_placement();
--> statement-breakpoint
CREATE TRIGGER meters_search AFTER INSERT OR UPDATE OR DELETE ON meters FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry('meter');

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
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
