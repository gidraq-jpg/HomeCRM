-- DOC-4/SPACE-3: производная дата доступна только всей аудитории документа.
-- Функция читает лишь индекс членств под FORCE RLS, никогда не возвращает дату рождения.
CREATE FUNCTION app.passport_birth_visible(d public.documents, c public.contacts) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_trigger_depth()<>1 AND session_user<>'homecrm_owner' THEN RETURN false; END IF;
 IF d.owner_contact_id IS NOT NULL THEN
  IF c.id IS DISTINCT FROM d.owner_contact_id OR c.kind<>'person' OR c.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF d.space_kind='personal' THEN
   RETURN (c.space_kind='personal' AND c.space_id=d.space_id) OR
    (c.space_kind='household' AND EXISTS(SELECT 1 FROM public.household_access a WHERE a.space_id=c.space_id AND a.account_id=d.assignee_id AND (c.audience='household' OR a.role IN ('admin','adult'))));
  END IF;
  RETURN c.space_kind='household' AND c.space_id=d.space_id AND (c.audience='household' OR d.audience='adults');
 END IF;
 IF d.owner_account_id IS NULL THEN RETURN false; END IF;
 IF d.space_kind='personal' THEN
  RETURN d.assignee_id=d.owner_account_id OR EXISTS(
   SELECT 1 FROM public.household_access a JOIN public.household_access b ON a.space_id=b.space_id
   WHERE a.account_id=d.owner_account_id AND b.account_id=d.assignee_id);
 END IF;
 -- Профиль виден по любой общей семье, но общая семья автора не гарантирует доступ читателям.
 RETURN EXISTS(SELECT 1 FROM public.household_access reader WHERE reader.space_id=d.space_id) AND NOT EXISTS(
  SELECT 1 FROM public.household_access reader WHERE reader.space_id=d.space_id
   AND (d.audience='household' OR reader.role IN ('admin','adult'))
   AND reader.account_id<>d.owner_account_id AND NOT EXISTS(
    SELECT 1 FROM public.household_access a JOIN public.household_access b ON a.space_id=b.space_id
    WHERE a.account_id=d.owner_account_id AND b.account_id=reader.account_id));
END; $$;
REVOKE ALL ON FUNCTION app.passport_birth_visible(public.documents,public.contacts) FROM PUBLIC,homecrm_auth,homecrm_worker;
GRANT EXECUTE ON FUNCTION app.passport_birth_visible(public.documents,public.contacts) TO homecrm_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.document_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE house uuid; r jsonb; birth date; zone text; c public.contacts; visible boolean;
 prior text:=current_setting('app.utility_source_id',true); prior_source text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 house:=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE coalesce((SELECT d.household_id FROM public.deadlines d WHERE d.document_id=NEW.id),(SELECT m.space_id FROM public.space_members m WHERE m.account_id=NEW.assignee_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN NULL; END IF;
 SELECT time_zone INTO zone FROM public.spaces WHERE id=house;
 IF NEW.owner_contact_id IS NOT NULL THEN SELECT * INTO c FROM public.contacts WHERE id=NEW.owner_contact_id; END IF;
 visible:=coalesce(app.passport_birth_visible(NEW,c),false);
 IF visible THEN
  IF NEW.owner_account_id IS NOT NULL THEN SELECT birth_date INTO birth FROM public.member_profiles WHERE account_id=NEW.owner_account_id;
  ELSIF c.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN birth:=(c.data->>'birthday')::date;
  END IF;
 END IF;
 r:=app.document_rule(NEW.data,birth,(NEW.created_at AT TIME ZONE coalesce(zone,'UTC'))::date);
 -- Недоступность источника не является удалением даты. Сохраняем прежнее правило целиком.
 IF NOT visible AND NEW.data->>'type'='russian_passport' AND NEW.data->>'expiresOn' IS NULL AND coalesce(NEW.data->>'indefinite','false')<>'true' THEN
  r:=coalesce((SELECT previous.rule FROM public.deadlines previous WHERE previous.document_id=NEW.id),r);
 END IF;
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
-- Тот же барьер в закрытом триггере смены даты; остальная логика 0047 сохраняется.
DO $refresh$
DECLARE definition text:=pg_get_functiondef('app.refresh_passport_birthday()'::regprocedure); start_at integer; end_at integer;
BEGIN
 start_at:=strpos(definition,'  -- Новая закрытая дата');
 end_at:=strpos(definition,'  PERFORM set_config(''app.deadline_source_id'',d.id::text,true);');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'unexpected passport refresh definition'; END IF;
 EXECUTE substr(definition,1,start_at-1)||E'  IF TG_TABLE_NAME=''contacts'' THEN\n   IF NOT coalesce(app.passport_birth_visible(d,NEW),false) THEN CONTINUE; END IF;\n  ELSE\n   IF NOT coalesce(app.passport_birth_visible(d,NULL::public.contacts),false) THEN CONTINUE; END IF;\n  END IF;\n'||substr(definition,end_at);
END;
$refresh$;
--> statement-breakpoint
-- Безопасное продолжение бэкфилла 0048 без изменения уже применённых файлов.
-- Права живут только в транзакции миграции; исходные записи и история не меняются.
CREATE POLICY passport_backfill_documents ON documents FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_profiles ON member_profiles FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_contacts ON contacts FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_spaces ON spaces FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_members ON household_access FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_deadlines_select ON deadlines FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_deadlines_insert ON deadlines FOR INSERT TO homecrm_owner WITH CHECK (true);
CREATE POLICY passport_backfill_deadlines_update ON deadlines FOR UPDATE TO homecrm_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
DO $backfill$
DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 EXECUTE replace(definition,E'BEGIN\n',E'BEGIN\n IF current_user=''homecrm_owner'' AND NEW.source_kind=''document'' AND current_setting(''app.passport_backfill'',true)=''on'' THEN RETURN NEW; END IF;\n');
 PERFORM set_config('app.passport_backfill','on',true);
 INSERT INTO deadlines(document_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
 SELECT d.id,'document',h.id,r.rule,d.space_id,d.space_kind,d.audience,d.author_id,d.assignee_id,d.deleted_at
 FROM documents d
 LEFT JOIN member_profiles p ON p.account_id=d.owner_account_id
 LEFT JOIN contacts c ON c.id=d.owner_contact_id AND c.kind='person' AND c.deleted_at IS NULL
 JOIN LATERAL (
  SELECT s.id,s.time_zone FROM spaces s WHERE s.kind='household' AND (s.id=d.space_id OR (d.space_kind='personal' AND EXISTS(SELECT 1 FROM household_access m WHERE m.space_id=s.id AND m.account_id=d.assignee_id))) ORDER BY s.id LIMIT 1
 ) h ON true
 CROSS JOIN LATERAL (SELECT app.document_rule(d.data,CASE WHEN app.passport_birth_visible(d,c) THEN coalesce(p.birth_date,
  CASE WHEN c.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.data->>'birthday')::date END) END,
  (d.created_at AT TIME ZONE coalesce(h.time_zone,'UTC'))::date) AS rule) r
 WHERE d.data->>'type'='russian_passport' AND d.status='valid' AND coalesce(d.data->>'indefinite','false')<>'true' AND r.rule IS NOT NULL
 ON CONFLICT(document_id) DO UPDATE SET rule=EXCLUDED.rule,needs_refresh=true
 -- Если 0048 и 0049 применяются вместе, у созданного бэкфиллом срока ещё нет прежнего значения.
 -- Сроки из ранее завершённых транзакций сохраняем, включая последнее открытое значение.
 WHERE deadlines.created_at=transaction_timestamp() AND deadlines.rule IS DISTINCT FROM EXCLUDED.rule;
 PERFORM set_config('app.passport_backfill','',true);
 EXECUTE definition;
END;
$backfill$;
--> statement-breakpoint
DROP POLICY passport_backfill_documents ON documents;
DROP POLICY passport_backfill_profiles ON member_profiles;
DROP POLICY passport_backfill_contacts ON contacts;
DROP POLICY passport_backfill_spaces ON spaces;
DROP POLICY passport_backfill_members ON household_access;
DROP POLICY passport_backfill_deadlines_select ON deadlines;
DROP POLICY passport_backfill_deadlines_insert ON deadlines;
DROP POLICY passport_backfill_deadlines_update ON deadlines;
