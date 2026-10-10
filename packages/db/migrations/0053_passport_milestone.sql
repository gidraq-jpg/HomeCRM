-- DOC-4: граница хранится вместе с вычисленным окном и не зависит от редактора.
CREATE OR REPLACE FUNCTION app.document_rule(data jsonb, birth date, reference_date date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE warnings jsonb; milestone date; anchor date; years integer;
BEGIN
 IF data->>'indefinite'='true' THEN RETURN NULL; END IF;
 warnings:=coalesce(data->'warnings',CASE data->>'type' WHEN 'international_passport' THEN '[180,90,30]'::jsonb WHEN 'driver_license' THEN '[90,30]'::jsonb WHEN 'osago' THEN '[30,14,3]'::jsonb WHEN 'kasko' THEN '[30,14,3]'::jsonb WHEN 'property_insurance' THEN '[30,14,3]'::jsonb WHEN 'contract' THEN '[60,30]'::jsonb WHEN 'russian_passport' THEN '[60,30]'::jsonb WHEN 'warranty_receipt' THEN '[30]'::jsonb ELSE '[30,7]'::jsonb END);
 IF data->>'expiresOn' IS NOT NULL THEN RETURN jsonb_build_object('kind','date','date',data->>'expiresOn','time','00:00','durationDays',0,'warnings',warnings,'warningTime','09:00'); END IF;
 IF data->>'type'<>'russian_passport' THEN RETURN NULL; END IF;
 IF birth IS NULL THEN RETURN jsonb_build_object('kind','after','eventDate',NULL,'every',1,'unit','day','warnings',warnings,'warningTime','09:00'); END IF;
 anchor:=coalesce((data->>'issuedOn')::date,reference_date-90);
 IF anchor<(birth+interval '20 years')::date THEN years:=20;milestone:=(birth+interval '20 years')::date;
 ELSIF anchor<(birth+interval '45 years')::date THEN years:=45;milestone:=(birth+interval '45 years')::date;
 ELSE RETURN NULL;
 END IF;
 RETURN jsonb_build_object('kind','window','date',milestone,'time','00:00','durationDays',90,'endTime','23:59','warnings',warnings,'endWarnings','[]'::jsonb,'warningTime','09:00','passportYears',years);
END; $$;
--> statement-breakpoint
-- Дополняем только метаданные прежнего окна, не меняя даты, предупреждения и источники.
-- Если полная дата уже закрыта от аудитории или окно не совпадает, прежнее правило сохраняется.
CREATE POLICY milestone_documents ON documents FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY milestone_contacts ON contacts FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY milestone_profiles ON member_profiles FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY milestone_members ON household_access FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY milestone_deadlines_select ON deadlines FOR SELECT TO homecrm_owner USING (source_kind='document');
CREATE POLICY milestone_deadlines_update ON deadlines FOR UPDATE TO homecrm_owner USING (source_kind='document') WITH CHECK (source_kind='document');
--> statement-breakpoint
DO $backfill$
DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 EXECUTE replace(definition,E'BEGIN\n',E'BEGIN\n IF current_user=''homecrm_owner'' AND NEW.source_kind=''document'' AND current_setting(''app.passport_milestone_backfill'',true)=''on'' AND NEW.rule->>''passportYears'' IN (''20'',''45'') AND NEW.rule-''passportYears''=OLD.rule AND (to_jsonb(NEW)-ARRAY[''rule'',''updated_at'']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY[''rule'',''updated_at'']) THEN RETURN NEW; END IF;\n');
 PERFORM set_config('app.passport_milestone_backfill','on',true);
 UPDATE deadlines old SET rule=old.rule||jsonb_build_object('passportYears',CASE WHEN old.rule->>'date'=((b.birth+interval '20 years')::date)::text THEN 20 ELSE 45 END)
 FROM documents d
 LEFT JOIN contacts c ON c.id=d.owner_contact_id AND c.kind='person' AND c.deleted_at IS NULL
 LEFT JOIN member_profiles p ON p.account_id=d.owner_account_id
 CROSS JOIN LATERAL (SELECT CASE WHEN app.passport_birth_visible(d,c) THEN coalesce(p.birth_date,
  CASE WHEN c.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.data->>'birthday')::date END) END AS birth) b
 WHERE old.document_id=d.id AND d.data->>'type'='russian_passport' AND old.rule->>'kind'='window'
  AND NOT old.rule ? 'passportYears' AND old.rule->>'date' IN (((b.birth+interval '20 years')::date)::text,((b.birth+interval '45 years')::date)::text);
 PERFORM set_config('app.passport_milestone_backfill','',true);
 EXECUTE definition;
END; $backfill$;
--> statement-breakpoint
DROP POLICY milestone_documents ON documents;
DROP POLICY milestone_contacts ON contacts;
DROP POLICY milestone_profiles ON member_profiles;
DROP POLICY milestone_members ON household_access;
DROP POLICY milestone_deadlines_select ON deadlines;
DROP POLICY milestone_deadlines_update ON deadlines;
