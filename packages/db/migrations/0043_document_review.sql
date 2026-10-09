-- Глобальный факт роли: функция не возвращает состав, UUID домов или данные документов.
-- FORCE RLS остаётся включённым; owner читает только строки role=child индекса членств.
CREATE FUNCTION app.document_owner_is_child(owner_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE prior text := current_setting('app.document_owner_lookup',true); result boolean;
BEGIN
 PERFORM set_config('app.document_owner_lookup','on',true);
 SELECT EXISTS(SELECT 1 FROM public.household_access WHERE account_id=owner_id AND role='child') INTO result;
 PERFORM set_config('app.document_owner_lookup',coalesce(prior,''),true);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION app.document_owner_is_child(uuid) FROM PUBLIC,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.document_owner_is_child(uuid) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
CREATE POLICY "household_access_document_owner" ON "household_access" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (role = 'child' AND current_setting('app.document_owner_lookup',true) = 'on');--> statement-breakpoint
ALTER POLICY "documents_select" ON "documents" TO homecrm_app USING (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (NOT (documents.is_identity AND documents.space_kind='household' AND app.document_owner_is_child(documents.owner_account_id) AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL))));--> statement-breakpoint
ALTER POLICY "documents_update" ON "documents" TO homecrm_app USING (((deleted_at IS NULL AND ((
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
  )))) AND (NOT (documents.is_identity AND documents.space_kind='household' AND app.document_owner_is_child(documents.owner_account_id) AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL)))) WITH CHECK (((deleted_at IS NULL AND ((
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
  )))) AND (NOT (documents.is_identity AND documents.space_kind='household' AND app.document_owner_is_child(documents.owner_account_id) AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL))));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.document_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
  NEW.has_other_contributions := old_doc.has_other_contributions OR old_doc.author_id IS DISTINCT FROM NEW.author_id;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='invalid' AND NEW.status<>'invalid' THEN RAISE EXCEPTION 'document invalidation is final' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_account_id IS NOT NULL AND app.current_account_id() IS NOT NULL AND NEW.owner_account_id<>app.current_account_id() AND NOT EXISTS (
  SELECT 1 FROM public.space_members owner JOIN public.space_members viewer ON viewer.space_id=owner.space_id WHERE owner.account_id=NEW.owner_account_id AND viewer.account_id=app.current_account_id() AND owner.left_at IS NULL AND viewer.left_at IS NULL
 ) THEN RAISE EXCEPTION 'owner unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_contact_id IS NOT NULL AND TG_OP='INSERT' AND NEW.previous_id IS NULL AND NOT app.record_ref_allowed('contacts',NEW.owner_contact_id,false) THEN RAISE EXCEPTION 'owner unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.owner_account_id IS NOT NULL AND NEW.space_kind='household' AND NEW.audience='household' AND NEW.data->>'type' IN ('russian_passport','international_passport','birth_certificate','snils','inn','driver_license') AND (TG_OP='INSERT' OR (NEW.space_id,NEW.audience,NEW.data->>'type') IS DISTINCT FROM (OLD.space_id,OLD.audience,OLD.data->>'type')) AND app.document_owner_is_child(NEW.owner_account_id) THEN RAISE EXCEPTION 'child identity requires adults' USING ERRCODE='insufficient_privilege'; END IF;
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

--> statement-breakpoint
-- После documents_defaults: общий триггер обнуляет вклад при INSERT.
ALTER TRIGGER documents_00_document ON documents RENAME TO documents_document;
