-- DOC-1…7: существующие записи не переписываются.
SELECT app.attach_record_table('documents');
--> statement-breakpoint
SELECT app.attach_record_table('document_files','documents');
--> statement-breakpoint
GRANT SELECT(parent_id) ON document_files TO homecrm_worker;
GRANT SELECT(audience) ON documents TO homecrm_worker;
GRANT SELECT(document_id) ON deadlines TO homecrm_worker;
CREATE TRIGGER document_files_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON document_files FOR EACH ROW EXECUTE FUNCTION app.file_lifecycle('documents');
CREATE TRIGGER documents_files_placement AFTER UPDATE OF space_id,space_kind,audience ON documents FOR EACH ROW EXECUTE FUNCTION app.cascade_file_placement('document_files');
--> statement-breakpoint
CREATE FUNCTION app.document_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.objects; old_doc public.documents;
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.previous_id IS NULL AND OLD.previous_id IS NOT NULL AND (to_jsonb(NEW)-ARRAY['previous_id','is_identity'])=(to_jsonb(OLD)-ARRAY['previous_id','is_identity']) THEN RETURN NEW; END IF;
 IF current_user='homecrm_worker' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.owner_account_id,NEW.owner_contact_id,NEW.owner_object_id,NEW.previous_id) IS DISTINCT FROM (OLD.owner_account_id,OLD.owner_contact_id,OLD.owner_object_id,OLD.previous_id) THEN RAISE EXCEPTION 'document owner and predecessor are immutable' USING ERRCODE='insufficient_privilege'; END IF;
 IF TG_OP='INSERT' AND NEW.previous_id IS NOT NULL THEN
  SELECT * INTO old_doc FROM public.documents WHERE id=NEW.previous_id FOR UPDATE;
  IF old_doc.id IS NULL OR old_doc.status<>'invalid' OR old_doc.deleted_at IS NOT NULL OR
   (NEW.space_id,NEW.space_kind,NEW.audience,NEW.owner_account_id,NEW.owner_contact_id,NEW.owner_object_id) IS DISTINCT FROM (old_doc.space_id,old_doc.space_kind,old_doc.audience,old_doc.owner_account_id,old_doc.owner_contact_id,old_doc.owner_object_id)
   THEN RAISE EXCEPTION 'invalid predecessor' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='invalid' AND NEW.status<>'invalid' THEN RAISE EXCEPTION 'document invalidation is final' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_account_id IS NOT NULL AND app.current_account_id() IS NOT NULL AND NEW.owner_account_id<>app.current_account_id() AND NOT EXISTS (
  SELECT 1 FROM public.space_members owner JOIN public.space_members viewer ON viewer.space_id=owner.space_id WHERE owner.account_id=NEW.owner_account_id AND viewer.account_id=app.current_account_id() AND owner.left_at IS NULL AND viewer.left_at IS NULL
 ) THEN RAISE EXCEPTION 'owner unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_contact_id IS NOT NULL AND TG_OP='INSERT' AND NEW.previous_id IS NULL AND NOT app.record_ref_allowed('contacts',NEW.owner_contact_id,false) THEN RAISE EXCEPTION 'owner unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_account_id IS NOT NULL AND NEW.space_kind='household' AND NEW.audience='household' AND NEW.data->>'type' IN ('russian_passport','international_passport','birth_certificate','snils','inn','driver_license') AND (TG_OP='INSERT' OR (NEW.space_id,NEW.audience,NEW.data->>'type') IS DISTINCT FROM (OLD.space_id,OLD.audience,OLD.data->>'type')) AND EXISTS(SELECT 1 FROM public.space_members m WHERE m.account_id=NEW.owner_account_id AND m.space_id=NEW.space_id AND m.role='child') THEN RAISE EXCEPTION 'child identity requires adults' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_object_id IS NOT NULL THEN
  SELECT * INTO p FROM public.objects WHERE id=NEW.owner_object_id;
  IF p.id IS NULL OR (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (p.space_id,p.space_kind,p.audience) OR (p.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN RAISE EXCEPTION 'document follows object' USING ERRCODE='insufficient_privilege'; END IF;
  IF TG_OP='INSERT' OR (NEW.title,NEW.data) IS DISTINCT FROM (OLD.title,OLD.data) THEN
   PERFORM id FROM public.objects WHERE id=p.id FOR UPDATE;
   IF p.space_kind='household' AND p.author_id IS DISTINCT FROM app.current_account_id() THEN UPDATE public.objects SET has_other_contributions=true WHERE id=p.id; END IF;
  END IF;
 END IF;
 IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.data->'type') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.data->'indefinite') IS DISTINCT FROM 'boolean' OR (NEW.data->>'indefinite'='true' AND NEW.data->>'expiresOn' IS NOT NULL) THEN RAISE EXCEPTION 'invalid document data' USING ERRCODE='check_violation'; END IF;
 IF NEW.data->>'type' NOT IN ('russian_passport','international_passport','birth_certificate','snils','inn','driver_license','oms','dms','osago','kasko','property_insurance','sts','pts','egrn','contract','warranty_receipt','medical','school','certificate','other') THEN RAISE EXCEPTION 'invalid document type' USING ERRCODE='check_violation'; END IF;
 IF NEW.data->>'issuedOn' IS NOT NULL AND NEW.data->>'expiresOn' IS NOT NULL AND (NEW.data->>'issuedOn')::date>(NEW.data->>'expiresOn')::date THEN RAISE EXCEPTION 'invalid document dates' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.document_guard() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER documents_00_document BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION app.document_guard();
CREATE UNIQUE INDEX documents_previous_key ON documents(previous_id) WHERE previous_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION app.cascade_object_documents() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE prior text:=current_setting('app.document_object_id',true);
BEGIN
 IF (NEW.space_id,NEW.space_kind,NEW.audience,NEW.deleted_at) IS NOT DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.deleted_at) THEN RETURN NULL; END IF;
 PERFORM set_config('app.document_object_id',NEW.id::text,true);
 UPDATE public.documents d SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience,
  deleted_at=CASE WHEN NEW.deleted_at IS NOT NULL THEN coalesce(d.deleted_at,NEW.deleted_at) WHEN OLD.deleted_at IS NOT NULL AND d.deleted_at=OLD.deleted_at THEN NULL ELSE d.deleted_at END
 WHERE d.owner_object_id=NEW.id;
 PERFORM set_config('app.document_object_id',coalesce(prior,''),true);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.cascade_object_documents() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER objects_documents AFTER UPDATE OF space_id,space_kind,audience,deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION app.cascade_object_documents();
--> statement-breakpoint
CREATE FUNCTION app.document_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE house uuid; r jsonb; warnings jsonb; prior text:=current_setting('app.utility_source_id',true); prior_source text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 house:=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE coalesce((SELECT d.household_id FROM public.deadlines d WHERE d.document_id=NEW.id),(SELECT m.space_id FROM public.space_members m WHERE m.account_id=NEW.assignee_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN NULL; END IF;
 PERFORM set_config('app.utility_source_id',NEW.id::text,true);
 PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
 IF NEW.data->>'expiresOn' IS NOT NULL AND NEW.status='valid' AND NEW.data->>'indefinite'<>'true' THEN
  warnings:=coalesce(NEW.data->'warnings',CASE NEW.data->>'type' WHEN 'international_passport' THEN '[180,90,30]'::jsonb WHEN 'driver_license' THEN '[90,30]'::jsonb WHEN 'osago' THEN '[30,14,3]'::jsonb WHEN 'kasko' THEN '[30,14,3]'::jsonb WHEN 'property_insurance' THEN '[30,14,3]'::jsonb WHEN 'contract' THEN '[60,30]'::jsonb WHEN 'russian_passport' THEN '[60,30]'::jsonb WHEN 'warranty_receipt' THEN '[30]'::jsonb ELSE '[30,7]'::jsonb END);
  r:=jsonb_build_object('kind','date','date',NEW.data->>'expiresOn','time','00:00','durationDays',0,'warnings',warnings,'warningTime','09:00');
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
REVOKE ALL ON FUNCTION app.document_deadline() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER documents_deadlines AFTER INSERT OR UPDATE OF data,status,deleted_at,space_id,space_kind,audience,assignee_id ON documents FOR EACH ROW EXECUTE FUNCTION app.document_deadline();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_source_deadlines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE prior text:=current_setting('app.deadline_source_id',true);
BEGIN
  PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
  UPDATE public.deadlines d SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience,assignee_id=NEW.assignee_id,
   household_id=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE d.household_id END,
   deleted_at=CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN coalesce(d.deleted_at,NEW.deleted_at)
     WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND d.deleted_at=OLD.deleted_at THEN NULL ELSE d.deleted_at END
  WHERE (TG_TABLE_NAME='notes' AND d.note_id=NEW.id) OR (TG_TABLE_NAME='objects' AND d.object_id=NEW.id) OR (TG_TABLE_NAME='documents' AND d.document_id=NEW.id);
  PERFORM set_config('app.deadline_source_id',coalesce(prior,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
CREATE TRIGGER documents_source_metadata AFTER UPDATE OF space_id,space_kind,audience,assignee_id,deleted_at ON documents FOR EACH ROW EXECUTE FUNCTION app.sync_source_deadlines();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_search_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d jsonb; source text := TG_ARGV[0]; content text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
    OR TG_TABLE_NAME NOT IN ('notes','note_items','objects','object_fields','object_events','meters','documents') THEN
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
CREATE TRIGGER documents_search AFTER INSERT OR UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry('document');
