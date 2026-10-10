-- TASK-1/8: расширение существующей таблицы без удаления старых колонок и записей.
SELECT app.grant_record_table('tasks');
SELECT app.attach_record_table('task_files','tasks');
GRANT SELECT(parent_id) ON task_files TO homecrm_worker;
GRANT SELECT(audience) ON tasks TO homecrm_worker;
GRANT SELECT(task_id) ON deadlines TO homecrm_worker;
CREATE TRIGGER task_files_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON task_files FOR EACH ROW EXECUTE FUNCTION app.file_lifecycle('tasks');
CREATE TRIGGER tasks_files_placement AFTER UPDATE OF space_id,space_kind,audience ON tasks FOR EACH ROW EXECUTE FUNCTION app.cascade_file_placement('task_files');
--> statement-breakpoint
-- История чек-листа и статуса — история самого дела. Файлы учитываются при переносе в личное.
DO $guard$
DECLARE definition text:=pg_get_functiondef('app.record_guard()'::regprocedure);
BEGIN
 definition:=replace(definition,'''documents'',''document_files'')','''documents'',''document_files'',''task_files'')');
 definition:=replace(definition,'(TG_TABLE_NAME = ''tasks'' AND NEW.title IS DISTINCT FROM OLD.title)', '(TG_TABLE_NAME = ''tasks'' AND (to_jsonb(NEW)- (ignored || ARRAY[''space_id'',''space_kind'',''audience'',''assignee_id'',''created_at'',''household_id''])) IS DISTINCT FROM (to_jsonb(OLD)- (ignored || ARRAY[''space_id'',''space_kind'',''audience'',''assignee_id'',''created_at'',''household_id''])))');
 definition:=replace(definition,'''documents'',''document_files'') AND','''documents'',''document_files'',''task_files'') AND');
 definition:=replace(definition,'IF TG_TABLE_NAME=''documents'' AND EXISTS', 'IF TG_TABLE_NAME=''tasks'' AND EXISTS(SELECT 1 FROM public.task_files f WHERE f.parent_id=OLD.id AND (f.author_id<>OLD.author_id OR f.has_other_contributions)) THEN RAISE EXCEPTION ''children have other contributions'' USING ERRCODE=''insufficient_privilege''; END IF; IF TG_TABLE_NAME=''documents'' AND EXISTS');
 -- Физическое удаление контакта очищает только ссылку, в том числе у дела в корзине.
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n IF TG_TABLE_NAME=''tasks'' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>''waiting_contact_id'') IS NOT NULL AND (to_jsonb(NEW)->>''waiting_contact_id'') IS NULL AND (to_jsonb(NEW)-ARRAY[''waiting_contact_id'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag''])=(to_jsonb(OLD)-ARRAY[''waiting_contact_id'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag'']) THEN RETURN NEW; END IF;\n');
 EXECUTE definition;
END; $guard$;
--> statement-breakpoint
DO $history$
DECLARE definition text:=pg_get_functiondef('app.record_history()'::regprocedure);
BEGIN
 -- Служебное SET NULL после очистки контакта не создаёт пользовательскую историю
 -- и не даёт worker права писать личные тексты в журнал.
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n IF TG_TABLE_NAME=''tasks'' AND TG_OP=''UPDATE'' AND (pg_trigger_depth()>1 OR current_user=''homecrm_owner'') AND (to_jsonb(OLD)->>''waiting_contact_id'') IS NOT NULL AND (to_jsonb(NEW)->>''waiting_contact_id'') IS NULL AND (to_jsonb(NEW)-ARRAY[''waiting_contact_id'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag''])=(to_jsonb(OLD)-ARRAY[''waiting_contact_id'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag'']) THEN RETURN NULL; END IF;\n');
 definition:=replace(definition,'''contacts'',''contact_interactions'')','''contacts'',''contact_interactions'',''tasks'',''task_files'')');
 definition:=replace(definition,'''owner_contact_id'',''is_identity''','''owner_contact_id'',''is_identity'',''waiting_contact_id'',''waiting_account_id''');
 definition:=replace(definition,'IF changes = ''{}''::jsonb THEN','IF TG_TABLE_NAME=''tasks'' AND (to_jsonb(NEW)->''waiting_contact_id'',to_jsonb(NEW)->''waiting_account_id'') IS DISTINCT FROM (to_jsonb(OLD)->''waiting_contact_id'',to_jsonb(OLD)->''waiting_account_id'') THEN changes:=changes || jsonb_build_object(''waiting_changed'',jsonb_build_object(''new'',true)); END IF; IF changes = ''{}''::jsonb THEN');
 EXECUTE definition;
END; $history$;
--> statement-breakpoint
-- Старый done_at уже означал выполненное дело; служебный backfill обходит только RLS этой таблицы.
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE TRIGGER USER;
UPDATE tasks SET status='done' WHERE done_at IS NOT NULL;
ALTER TABLE tasks ENABLE TRIGGER USER;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Производные сроки изменяются исключительно триггером своего дела.
DO $guard$
DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 definition:=replace(definition,'coalesce(NEW.note_id,NEW.object_id,NEW.document_id,NEW.contact_id,NEW.profile_account_id)','coalesce(NEW.note_id,NEW.object_id,NEW.document_id,NEW.contact_id,NEW.profile_account_id,NEW.task_id)');
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n
 IF NEW.task_id IS NOT NULL AND current_user<>''homecrm_worker'' THEN
  IF pg_trigger_depth()<2 OR (current_user<>''homecrm_owner'' AND NEW.task_id IS DISTINCT FROM nullif(current_setting(''app.task_source_id'',true),'''')::uuid) OR (current_user=''homecrm_owner'' AND NEW.task_id IS DISTINCT FROM nullif(current_setting(''app.deadline_source_id'',true),'''')::uuid) THEN RAISE EXCEPTION ''edit task source instead'' USING ERRCODE=''insufficient_privilege''; END IF;
  IF TG_OP=''UPDATE'' AND (NEW.id,NEW.task_id,NEW.source_kind,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.task_id,OLD.source_kind,OLD.author_id,OLD.created_at) THEN RAISE EXCEPTION ''immutable task source'' USING ERRCODE=''insufficient_privilege''; END IF;
  NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
 END IF;\n');
 EXECUTE definition;
END; $guard$;
--> statement-breakpoint
CREATE FUNCTION app.task_deadlines() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE source text; day date; clock text; active boolean; removed timestamptz; r jsonb;
 prior text:=current_setting('app.task_source_id',true); prior_source text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' OR NEW.household_id IS NULL THEN RETURN NULL; END IF;
 PERFORM set_config('app.task_source_id',NEW.id::text,true);
 PERFORM set_config('app.deadline_source_id',NEW.id::text,true);
 FOREACH source IN ARRAY ARRAY['task_plan','task_due','task_waiting'] LOOP
  day:=CASE source WHEN 'task_plan' THEN NEW.plan_on WHEN 'task_due' THEN NEW.due_on ELSE NEW.check_on END;
  clock:=CASE source WHEN 'task_plan' THEN NEW.plan_time WHEN 'task_due' THEN NEW.due_time ELSE NULL END;
  active:=NEW.status IN ('open','waiting') AND (source<>'task_waiting' OR NEW.status='waiting') AND day IS NOT NULL;
  removed:=CASE WHEN active THEN NEW.deleted_at ELSE coalesce(NEW.deleted_at,now()) END;
  IF day IS NOT NULL THEN
   r:=jsonb_build_object('kind','date','date',day,'time',coalesce(clock,'00:00'),'durationDays',0,'warnings','[0]'::jsonb,'warningTime',coalesce(clock,'09:00'));
   INSERT INTO public.deadlines(task_id,source_kind,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
    VALUES(NEW.id,source,NEW.household_id,r,NEW.space_id,NEW.space_kind,NEW.audience,NEW.author_id,NEW.assignee_id,removed)
    ON CONFLICT(task_id,source_kind) DO UPDATE SET rule=EXCLUDED.rule,household_id=EXCLUDED.household_id,space_id=EXCLUDED.space_id,space_kind=EXCLUDED.space_kind,audience=EXCLUDED.audience,assignee_id=EXCLUDED.assignee_id,deleted_at=EXCLUDED.deleted_at,needs_refresh=true;
  ELSE
   UPDATE public.deadlines SET deleted_at=coalesce(deleted_at,now()),needs_refresh=true WHERE task_id=NEW.id AND source_kind=source;
  END IF;
 END LOOP;
 PERFORM set_config('app.task_source_id',coalesce(prior,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_source,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.task_deadlines() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER tasks_deadlines AFTER INSERT OR UPDATE OF plan_on,plan_time,due_on,due_time,status,check_on,household_id,space_id,space_kind,audience,assignee_id,deleted_at ON tasks FOR EACH ROW EXECUTE FUNCTION app.task_deadlines();
--> statement-breakpoint
-- Смена ответственного worker использует уже закрытый каскад метаданных.
DO $cascade$
DECLARE definition text:=pg_get_functiondef('app.sync_source_deadlines()'::regprocedure);
BEGIN
 EXECUTE replace(definition,'(TG_TABLE_NAME=''contacts'' AND d.contact_id=NEW.id)','(TG_TABLE_NAME=''contacts'' AND d.contact_id=NEW.id) OR (TG_TABLE_NAME=''tasks'' AND d.task_id=NEW.id)');
END; $cascade$;
CREATE TRIGGER tasks_source_metadata AFTER UPDATE OF space_id,space_kind,audience,assignee_id ON tasks FOR EACH ROW EXECUTE FUNCTION app.sync_source_deadlines();
--> statement-breakpoint
-- Индекс поиска остаётся производным, без новых прав worker на тексты.
DO $search$
DECLARE definition text:=pg_get_functiondef('app.sync_search_entry()'::regprocedure);
BEGIN
 definition:=replace(definition,'''documents'',''contacts'')','''documents'',''contacts'',''tasks'')');
 definition:=replace(definition,'coalesce(d->>''body'','''')','coalesce(d->>''body'',d->>''description'','''')');
 EXECUTE definition;
END; $search$;
CREATE TRIGGER tasks_search AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry('task');
--> statement-breakpoint
CREATE POLICY tasks_search_backfill ON tasks FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY task_index_backfill ON search_index FOR ALL TO homecrm_owner USING (true) WITH CHECK (true);
INSERT INTO search_index(source_type,source_id,access_key,target_id,space_id,space_kind,audience,owner_id,author_id,title,content)
 SELECT 'task',id,space_id::text||':'||coalesce(audience::text,'personal'),id,space_id,space_kind,audience,CASE WHEN space_kind='personal' THEN assignee_id END,author_id,title,title||' '||description FROM tasks WHERE deleted_at IS NULL;
DROP POLICY tasks_search_backfill ON tasks;
DROP POLICY task_index_backfill ON search_index;
