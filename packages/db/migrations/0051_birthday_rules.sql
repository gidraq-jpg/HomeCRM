-- CONT-6/7: технические ключи и производные сроки. Старые записи не переписываются.
ALTER TABLE api_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON api_operations TO homecrm_app;
GRANT UPDATE(birthday_enabled) ON member_profiles TO homecrm_app;
GRANT SELECT(contact_id,profile_account_id) ON deadlines TO homecrm_worker;
--> statement-breakpoint
-- Обновляем существующий guard, сохраняя особый закрытый пересчёт паспортов 0049.
DO $guard$
DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 definition:=replace(definition,'coalesce(NEW.note_id,NEW.object_id,NEW.document_id)','coalesce(NEW.note_id,NEW.object_id,NEW.document_id,NEW.contact_id,NEW.profile_account_id)');
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n
 IF NEW.source_kind=''birthday'' AND current_user<>''homecrm_worker'' AND NOT (current_user=''homecrm_owner'' AND pg_trigger_depth()>1 AND coalesce(NEW.contact_id,NEW.profile_account_id)=nullif(current_setting(''app.deadline_source_id'',true),'''')::uuid) THEN
  IF pg_trigger_depth()<2 OR coalesce(NEW.contact_id,NEW.profile_account_id) IS DISTINCT FROM nullif(current_setting(''app.birthday_source_id'',true),'''')::uuid THEN
   RAISE EXCEPTION ''edit birthday source instead'' USING ERRCODE=''insufficient_privilege'';
  END IF;
  IF TG_OP=''UPDATE'' AND (NEW.id,NEW.contact_id,NEW.profile_account_id,NEW.source_kind,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.contact_id,OLD.profile_account_id,OLD.source_kind,OLD.author_id,OLD.created_at) THEN
   RAISE EXCEPTION ''immutable birthday source'' USING ERRCODE=''insufficient_privilege'';
  END IF;
  NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
 END IF;\n');
 EXECUTE definition;
END;
$guard$;
--> statement-breakpoint
CREATE FUNCTION app.birthday_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE birth text; enabled boolean; source_id uuid; contact uuid; profile uuid; house uuid;
 place uuid; kind public.space_kind; aud public.audience; author uuid; assignee uuid; removed timestamptz; r jsonb;
 prior text:=current_setting('app.birthday_source_id',true); prior_source text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='contacts' THEN
  IF NEW.kind<>'person' THEN RETURN NULL; END IF;
  contact:=NEW.id;source_id:=NEW.id; birth:=NEW.data->>'birthday';enabled:=coalesce(NEW.data->>'birthdayEnabled','false')='true';
  place:=NEW.space_id;kind:=NEW.space_kind;aud:=NEW.audience;author:=NEW.author_id;assignee:=NEW.assignee_id;removed:=NEW.deleted_at;
 ELSE
  profile:=NEW.account_id;source_id:=NEW.account_id;birth:=NEW.birth_date::text;enabled:=NEW.birthday_enabled;
  SELECT id INTO place FROM public.spaces WHERE owner_account_id=NEW.account_id AND spaces.kind='personal';
  kind:='personal';author:=NEW.account_id;assignee:=NEW.account_id;
 END IF;
 house:=CASE WHEN kind='household' THEN place ELSE coalesce((SELECT m.space_id FROM public.space_members m WHERE m.account_id=assignee AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1),(SELECT d.household_id FROM public.deadlines d WHERE d.contact_id=contact OR d.profile_account_id=profile)) END;
 IF house IS NULL THEN RETURN NULL; END IF;
 PERFORM set_config('app.birthday_source_id',source_id::text,true);
 PERFORM set_config('app.deadline_source_id',source_id::text,true);
 IF enabled AND birth IS NOT NULL THEN
  r:=jsonb_build_object('kind','repeat','anchor','2000-'||right(birth,5),'repeat',jsonb_build_object('unit','year','month',substr(right(birth,5),1,2)::int,'day',right(birth,2)::int),'warnings','[7,1]'::jsonb,'warningTime','09:00');
  IF contact IS NOT NULL THEN
   INSERT INTO public.deadlines(contact_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
    VALUES(contact,'birthday',house,r,place,kind,aud,author,assignee,removed) ON CONFLICT(contact_id) DO UPDATE SET rule=EXCLUDED.rule,household_id=EXCLUDED.household_id,space_id=EXCLUDED.space_id,space_kind=EXCLUDED.space_kind,audience=EXCLUDED.audience,assignee_id=EXCLUDED.assignee_id,deleted_at=EXCLUDED.deleted_at,needs_refresh=true;
  ELSE
   INSERT INTO public.deadlines(profile_account_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id)
    VALUES(profile,'birthday',house,r,place,kind,aud,author,assignee) ON CONFLICT(profile_account_id) DO UPDATE SET rule=EXCLUDED.rule,household_id=EXCLUDED.household_id,deleted_at=NULL,needs_refresh=true;
  END IF;
 ELSE
  UPDATE public.deadlines SET deleted_at=coalesce(deleted_at,now()),needs_refresh=true WHERE contact_id=contact OR profile_account_id=profile;
 END IF;
 PERFORM set_config('app.birthday_source_id',coalesce(prior,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_source,''),true);
 PERFORM pg_notify('homecrm_deadlines','');RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.birthday_deadline() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER contacts_birthday AFTER INSERT OR UPDATE OF data,space_id,space_kind,audience,assignee_id,deleted_at ON contacts FOR EACH ROW EXECUTE FUNCTION app.birthday_deadline();
CREATE TRIGGER member_profiles_birthday AFTER UPDATE OF birth_date,birthday_enabled ON member_profiles FOR EACH ROW EXECUTE FUNCTION app.birthday_deadline();
--> statement-breakpoint
-- Перенос и смена ответственного используют общий закрытый каскад, включая worker.
DO $cascade$
DECLARE definition text:=pg_get_functiondef('app.sync_source_deadlines()'::regprocedure);
BEGIN
 EXECUTE replace(definition,'(TG_TABLE_NAME=''objects'' AND d.object_id=NEW.id)','(TG_TABLE_NAME=''objects'' AND d.object_id=NEW.id) OR (TG_TABLE_NAME=''contacts'' AND d.contact_id=NEW.id)');
END;$cascade$;
CREATE TRIGGER contacts_source_metadata AFTER UPDATE OF space_id,space_kind,audience,assignee_id,deleted_at ON contacts FOR EACH ROW EXECUTE FUNCTION app.sync_source_deadlines();
--> statement-breakpoint
-- Единственное чтение имени worker: текущий ответственный и текущий доступ к дате.
-- FORCE RLS остаётся включён; отдельные политики открываются только внутри этой функции.
CREATE FUNCTION app.birthday_delivery_name(contact uuid, profile uuid, recipient uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.contacts; p public.member_profiles; result text;
 prior text:=current_setting('app.birthday_lookup',true); prior_contact text:=current_setting('app.birthday_contact',true); prior_profile text:=current_setting('app.birthday_profile',true);
BEGIN
 IF num_nonnulls(contact,profile)<>1 THEN RETURN NULL; END IF;
 PERFORM set_config('app.birthday_lookup','on',true);
 PERFORM set_config('app.birthday_contact',coalesce(contact::text,''),true);
 PERFORM set_config('app.birthday_profile',coalesce(profile::text,''),true);
 IF contact IS NOT NULL THEN
  SELECT * INTO c FROM public.contacts WHERE id=contact;
  IF c.kind='person' AND c.deleted_at IS NULL AND c.data->>'birthdayEnabled'='true' AND c.data->>'birthday' IS NOT NULL AND c.assignee_id=recipient AND
    ((c.space_kind='personal' AND c.assignee_id=recipient) OR (c.space_kind='household' AND EXISTS(SELECT 1 FROM public.household_access a WHERE a.space_id=c.space_id AND a.account_id=recipient AND (c.audience='household' OR a.role IN ('admin','adult'))))) THEN result:=c.title; END IF;
 ELSE
  SELECT * INTO p FROM public.member_profiles WHERE account_id=profile;
  IF p.birthday_enabled AND p.birth_date IS NOT NULL AND recipient=profile THEN result:=p.display_name; END IF;
 END IF;
 PERFORM set_config('app.birthday_lookup',coalesce(prior,''),true);
 PERFORM set_config('app.birthday_contact',coalesce(prior_contact,''),true);
 PERFORM set_config('app.birthday_profile',coalesce(prior_profile,''),true);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION app.birthday_delivery_name(uuid,uuid,uuid) FROM PUBLIC,homecrm_app,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.birthday_delivery_name(uuid,uuid,uuid) TO homecrm_worker;
--> statement-breakpoint
-- История импорта не содержит файл; текстовые изменения пишет обычный record_history.
CREATE FUNCTION app.contact_import_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_setting('app.contact_import',true)='on' THEN
  INSERT INTO public.contacts_history(record_id,space_id,space_kind,audience,actor_id,operation,changes)
   VALUES(NEW.id,NEW.space_id,NEW.space_kind,NEW.audience,app.current_account_id(),'update','{"import":{"new":true}}');
 END IF; RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.contact_import_history() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER contacts_import AFTER INSERT OR UPDATE OF data ON contacts FOR EACH ROW EXECUTE FUNCTION app.contact_import_history();
