-- DOC-3/4: календарное правило; исходные документы и профили не переписываются.
CREATE FUNCTION app.document_rule(data jsonb, birth date, reference_date date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE warnings jsonb; milestone date; anchor date;
BEGIN
 IF data->>'indefinite'='true' THEN RETURN NULL; END IF;
 warnings:=coalesce(data->'warnings',CASE data->>'type' WHEN 'international_passport' THEN '[180,90,30]'::jsonb WHEN 'driver_license' THEN '[90,30]'::jsonb WHEN 'osago' THEN '[30,14,3]'::jsonb WHEN 'kasko' THEN '[30,14,3]'::jsonb WHEN 'property_insurance' THEN '[30,14,3]'::jsonb WHEN 'contract' THEN '[60,30]'::jsonb WHEN 'russian_passport' THEN '[60,30]'::jsonb WHEN 'warranty_receipt' THEN '[30]'::jsonb ELSE '[30,7]'::jsonb END);
 IF data->>'expiresOn' IS NOT NULL THEN RETURN jsonb_build_object('kind','date','date',data->>'expiresOn','time','00:00','durationDays',0,'warnings',warnings,'warningTime','09:00'); END IF;
 IF data->>'type'<>'russian_passport' THEN RETURN NULL; END IF;
 IF birth IS NULL THEN RETURN jsonb_build_object('kind','after','eventDate',NULL,'every',1,'unit','day','warnings',warnings,'warningTime','09:00'); END IF;
 -- Сложение лет ограничивает 29 февраля последним днём февраля.
 -- Без даты выдачи учитываем ещё не закончившееся 90-дневное окно на дату создания.
 anchor:=coalesce((data->>'issuedOn')::date,reference_date-90);
 IF anchor<(birth+interval '20 years')::date THEN milestone:=(birth+interval '20 years')::date;
 ELSIF anchor<(birth+interval '45 years')::date THEN milestone:=(birth+interval '45 years')::date;
 ELSE RETURN NULL;
 END IF;
 RETURN jsonb_build_object('kind','window','date',milestone,'time','00:00','durationDays',90,'endTime','23:59','warnings',warnings,'endWarnings','[]'::jsonb,'warningTime','09:00');
END; $$;
REVOKE ALL ON FUNCTION app.document_rule(jsonb,date,date) FROM PUBLIC,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.document_rule(jsonb,date,date) TO homecrm_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.document_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE house uuid; r jsonb; birth date; zone text; prior text:=current_setting('app.utility_source_id',true); prior_source text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 house:=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE coalesce((SELECT d.household_id FROM public.deadlines d WHERE d.document_id=NEW.id),(SELECT m.space_id FROM public.space_members m WHERE m.account_id=NEW.assignee_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN NULL; END IF;
 SELECT time_zone INTO zone FROM public.spaces WHERE id=house;
 IF NEW.owner_account_id IS NOT NULL THEN SELECT birth_date INTO birth FROM public.member_profiles WHERE account_id=NEW.owner_account_id;
 ELSIF NEW.owner_contact_id IS NOT NULL THEN SELECT CASE WHEN c.kind='person' AND c.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.data->>'birthday')::date END INTO birth FROM public.contacts c WHERE c.id=NEW.owner_contact_id AND c.deleted_at IS NULL;
 END IF;
 r:=app.document_rule(NEW.data,birth,(NEW.created_at AT TIME ZONE coalesce(zone,'UTC'))::date);
 PERFORM set_config('app.utility_source_id',NEW.id::text,true);
 PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
 IF r IS NOT NULL AND NEW.status='valid' THEN
  INSERT INTO public.deadlines(document_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
   VALUES(NEW.id,'document',house,r,NEW.space_id,NEW.space_kind,NEW.audience,NEW.author_id,NEW.assignee_id,NEW.deleted_at) ON CONFLICT(document_id) DO NOTHING;
  UPDATE public.deadlines d SET rule=r,deleted_at=NEW.deleted_at,needs_refresh=true WHERE d.document_id=NEW.id AND (d.rule,d.deleted_at) IS DISTINCT FROM (r,NEW.deleted_at);
 ELSE
  UPDATE public.deadlines SET deleted_at=coalesce(deleted_at,now()),needs_refresh=true WHERE document_id=NEW.id AND deleted_at IS NULL;
 END IF;
 PERFORM set_config('app.utility_source_id',coalesce(prior,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_source,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
--> statement-breakpoint
-- Единственный закрытый пересчёт: триггер не пишет документ и ничего не возвращает вызывающему.
CREATE FUNCTION app.refresh_passport_birthday() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.documents; birth date; zone text; house uuid; r jsonb;
 prior_account text:=current_setting('app.passport_owner_account',true); prior_contact text:=current_setting('app.passport_owner_contact',true);
 prior_source text:=current_setting('app.deadline_source_id',true); prior_document text:=current_setting('app.passport_document_id',true); prior_house text:=current_setting('app.passport_house_id',true);
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW' THEN RAISE EXCEPTION 'invalid birthday trigger'; END IF;
 IF TG_TABLE_NAME='member_profiles' THEN
  IF NEW.birth_date IS NOT DISTINCT FROM OLD.birth_date THEN RETURN NULL; END IF;
  birth:=NEW.birth_date;
  PERFORM set_config('app.passport_owner_account',NEW.account_id::text,true);
  PERFORM set_config('app.passport_owner_contact','',true);
 ELSIF TG_TABLE_NAME='contacts' THEN
  IF NEW.kind<>'person' OR NEW.data->>'birthday' IS NOT DISTINCT FROM OLD.data->>'birthday' THEN RETURN NULL; END IF;
  birth:=CASE WHEN NEW.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN (NEW.data->>'birthday')::date END;
  PERFORM set_config('app.passport_owner_contact',NEW.id::text,true);
  PERFORM set_config('app.passport_owner_account','',true);
 ELSE RAISE EXCEPTION 'invalid birthday source'; END IF;
 FOR d IN SELECT * FROM public.documents WHERE data->>'type'='russian_passport' AND data->>'expiresOn' IS NULL AND status='valid' AND data->>'indefinite'<>'true' AND
   (owner_account_id=nullif(current_setting('app.passport_owner_account',true),'')::uuid OR owner_contact_id=nullif(current_setting('app.passport_owner_contact',true),'')::uuid)
 LOOP
  -- Новая закрытая дата рождения не должна попадать читателям ранее связанного документа.
  -- Индекс членств доступен владельцу только внутри закрытого триггера (глубина 1).
  IF TG_TABLE_NAME='contacts' THEN
   IF d.space_kind='personal' THEN
    IF NOT ((NEW.space_kind='personal' AND NEW.space_id=d.space_id) OR
      (NEW.space_kind='household' AND EXISTS(SELECT 1 FROM public.household_access a WHERE a.space_id=NEW.space_id AND a.account_id=d.assignee_id AND (NEW.audience='household' OR a.role IN ('admin','adult'))))) THEN CONTINUE; END IF;
   ELSIF NEW.space_kind<>'household' OR NEW.space_id<>d.space_id OR (NEW.audience='adults' AND d.audience<>'adults') THEN CONTINUE;
   END IF;
  ELSE
   IF d.space_kind='personal' THEN
    IF d.assignee_id<>NEW.account_id AND NOT EXISTS(SELECT 1 FROM public.household_access a JOIN public.household_access b ON a.space_id=b.space_id WHERE a.account_id=NEW.account_id AND b.account_id=d.assignee_id) THEN CONTINUE; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM public.household_access a WHERE a.space_id=d.space_id AND a.account_id=NEW.account_id) THEN CONTINUE;
   END IF;
  END IF;
  PERFORM set_config('app.deadline_source_id',d.id::text,true);
  PERFORM set_config('app.passport_document_id',d.id::text,true);
  SELECT household_id INTO house FROM public.deadlines WHERE document_id=d.id;
  IF house IS NULL THEN CONTINUE; END IF;
  PERFORM set_config('app.passport_house_id',house::text,true);
  SELECT time_zone INTO zone FROM public.spaces WHERE id=house;
  r:=app.document_rule(d.data,birth,(d.created_at AT TIME ZONE coalesce(zone,'UTC'))::date);
  UPDATE public.deadlines SET rule=coalesce(r,rule),deleted_at=CASE WHEN r IS NULL THEN coalesce(deleted_at,now()) ELSE d.deleted_at END,needs_refresh=true WHERE document_id=d.id;
 END LOOP;
 PERFORM set_config('app.passport_owner_account',coalesce(prior_account,''),true);
 PERFORM set_config('app.passport_owner_contact',coalesce(prior_contact,''),true);
 PERFORM set_config('app.passport_document_id',coalesce(prior_document,''),true);
 PERFORM set_config('app.passport_house_id',coalesce(prior_house,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_source,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.refresh_passport_birthday() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER member_profiles_passport AFTER UPDATE OF birth_date ON member_profiles FOR EACH ROW EXECUTE FUNCTION app.refresh_passport_birthday();
CREATE TRIGGER contacts_passport AFTER UPDATE OF data ON contacts FOR EACH ROW EXECUTE FUNCTION app.refresh_passport_birthday();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p record; tbl text; rid uuid; cascading boolean;
BEGIN
 IF current_user='homecrm_owner' AND pg_trigger_depth()>1 AND NEW.source_kind='document' AND NEW.document_id=nullif(current_setting('app.passport_document_id',true),'')::uuid THEN
  IF (to_jsonb(NEW)-ARRAY['rule','needs_refresh','deleted_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['rule','needs_refresh','deleted_at','updated_at']) THEN RAISE EXCEPTION 'birthday refresh changes only derived rule' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
 END IF;
 cascading := pg_trigger_depth()>1 AND coalesce(NEW.note_id,NEW.object_id,NEW.document_id)=nullif(current_setting('app.deadline_source_id',true),'')::uuid;
 IF NEW.source_kind='document' AND current_user<>'homecrm_worker' AND NOT (current_user='homecrm_owner' AND cascading) THEN
  IF pg_trigger_depth()<2 OR NEW.document_id IS DISTINCT FROM nullif(current_setting('app.utility_source_id',true),'')::uuid THEN RAISE EXCEPTION 'edit document source instead' USING ERRCODE='insufficient_privilege'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.document_id,NEW.source_kind,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.document_id,OLD.source_kind,OLD.author_id,OLD.created_at) THEN RAISE EXCEPTION 'immutable document source' USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO p FROM public.documents WHERE id=NEW.document_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
  IF p.space_kind='household' THEN NEW.household_id:=p.space_id; END IF;
  NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
 END IF;
 IF NEW.source_kind<>'record' AND coalesce(NEW.charge_id,NEW.utility_account_id,NEW.meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') THEN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.object_id,NEW.source_kind,NEW.utility_account_id,NEW.meter_id,NEW.charge_id,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.object_id,OLD.source_kind,OLD.utility_account_id,OLD.meter_id,OLD.charge_id,OLD.author_id,OLD.created_at) THEN
   RAISE EXCEPTION 'immutable utility source' USING ERRCODE='insufficient_privilege';
  END IF;
  -- Источник уже удерживает блокировку объекта; FOR UPDATE скрыл бы чужую корзину от взрослого.
  SELECT * INTO p FROM public.objects WHERE id=NEW.object_id;
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
  IF (to_jsonb(NEW)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) THEN
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
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id,NEW.document_id);
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
