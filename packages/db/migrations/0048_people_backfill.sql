-- Одноразовая перестройка производных данных. Исходные документы, контакты и история неизменны.
-- Все временные политики и замена триггера существуют только внутри транзакции миграции.
CREATE POLICY passport_backfill_documents ON documents FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_profiles ON member_profiles FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_contacts ON contacts FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_spaces ON spaces FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_members ON space_members FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_deadlines_select ON deadlines FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY passport_backfill_deadlines_insert ON deadlines FOR INSERT TO homecrm_owner WITH CHECK (true);
CREATE POLICY passport_backfill_deadlines_update ON deadlines FOR UPDATE TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY people_backfill_search ON search_index FOR ALL TO homecrm_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
INSERT INTO search_index(source_type,source_id,access_key,target_id,space_id,space_kind,audience,owner_id,author_id,title,content)
 SELECT 'contact',c.id,c.space_id::text||':'||coalesce(c.audience::text,'personal'),c.id,c.space_id,c.space_kind,c.audience,
 CASE WHEN c.space_kind='personal' THEN c.assignee_id END,c.author_id,c.title,c.title FROM contacts c WHERE c.deleted_at IS NULL
 ON CONFLICT(source_type,source_id) DO NOTHING;
--> statement-breakpoint
DO $backfill$
DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 EXECUTE replace(definition,E'BEGIN\n',E'BEGIN\n IF current_user=''homecrm_owner'' AND NEW.source_kind=''document'' AND current_setting(''app.passport_backfill'',true)=''on'' THEN RETURN NEW; END IF;\n');
 PERFORM set_config('app.passport_backfill','on',true);
 UPDATE deadlines old SET
  rule=jsonb_set(old.rule,'{warnings}',app.document_rule(d.data,NULL,CURRENT_DATE)->'warnings'),
  needs_refresh=true,updated_at=now()
 FROM documents d
 WHERE old.document_id=d.id AND d.data->>'expiresOn' IS NOT NULL AND d.status='valid'
  AND coalesce(d.data->>'indefinite','false')<>'true'
  AND old.rule->'warnings' IS DISTINCT FROM app.document_rule(d.data,NULL,CURRENT_DATE)->'warnings';
 INSERT INTO deadlines(document_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
 SELECT d.id,'document',h.id,r.rule,d.space_id,d.space_kind,d.audience,d.author_id,d.assignee_id,d.deleted_at
 FROM documents d
 LEFT JOIN member_profiles p ON p.account_id=d.owner_account_id
 LEFT JOIN contacts c ON c.id=d.owner_contact_id AND c.kind='person' AND c.deleted_at IS NULL
 JOIN LATERAL (
  SELECT s.id,s.time_zone FROM spaces s WHERE s.kind='household' AND (s.id=d.space_id OR (d.space_kind='personal' AND EXISTS(SELECT 1 FROM space_members m WHERE m.space_id=s.id AND m.account_id=d.assignee_id AND m.left_at IS NULL))) ORDER BY s.id LIMIT 1
 ) h ON true
 CROSS JOIN LATERAL (SELECT app.document_rule(d.data,coalesce(p.birth_date,CASE WHEN c.data->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.data->>'birthday')::date END),(d.created_at AT TIME ZONE coalesce(h.time_zone,'UTC'))::date) AS rule) r
 WHERE d.data->>'type'='russian_passport' AND d.status='valid' AND d.data->>'indefinite'<>'true' AND r.rule IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deadlines old WHERE old.document_id=d.id);
 PERFORM set_config('app.passport_backfill','',true);
 EXECUTE definition;
END;
$backfill$;
--> statement-breakpoint
DROP POLICY passport_backfill_documents ON documents;
DROP POLICY passport_backfill_profiles ON member_profiles;
DROP POLICY passport_backfill_contacts ON contacts;
DROP POLICY passport_backfill_spaces ON spaces;
DROP POLICY passport_backfill_members ON space_members;
DROP POLICY passport_backfill_deadlines_select ON deadlines;
DROP POLICY passport_backfill_deadlines_insert ON deadlines;
DROP POLICY passport_backfill_deadlines_update ON deadlines;
DROP POLICY people_backfill_search ON search_index;
