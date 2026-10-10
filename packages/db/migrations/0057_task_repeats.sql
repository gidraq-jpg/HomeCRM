-- TASK-11: наружу выходит только ответ о доступе, без текста источника.
CREATE FUNCTION app.record_notification_visible(tbl text, rid uuid, recipient uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; visible boolean:=false; prior_record text:=current_setting('app.notification_record',true);
 prior_space text:=current_setting('app.notification_space',true); prior_lookup text:=current_setting('app.notification_lookup',true);
BEGIN
 IF session_user='homecrm_app' AND recipient IS DISTINCT FROM app.current_account_id() AND NOT app.record_notification_visible(tbl,rid,app.current_account_id()) THEN RETURN false; END IF;
 IF tbl NOT IN ('tasks','objects','documents','deadlines','notes') THEN RETURN false; END IF;
 PERFORM set_config('app.notification_record',rid::text,true);
 PERFORM set_config('app.notification_lookup','on',true);
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND deleted_at IS NULL',tbl) INTO r USING rid;
 IF r IS NOT NULL THEN
  PERFORM set_config('app.notification_space',r->>'space_id',true);
  IF r->>'space_kind'='personal' THEN
   SELECT EXISTS(SELECT 1 FROM public.spaces s WHERE s.id=(r->>'space_id')::uuid AND s.owner_account_id=recipient) INTO visible;
  ELSE
   SELECT EXISTS(SELECT 1 FROM public.space_members m WHERE m.space_id=(r->>'space_id')::uuid AND m.account_id=recipient AND m.left_at IS NULL AND (r->>'audience'='household' OR m.role IN ('admin','adult'))) INTO visible;
   IF visible AND tbl='documents' AND (r->>'is_identity')::boolean AND app.document_owner_is_child((r->>'owner_account_id')::uuid) THEN
    visible:=NOT EXISTS(SELECT 1 FROM public.space_members m WHERE m.space_id=(r->>'space_id')::uuid AND m.account_id=recipient AND m.left_at IS NULL AND m.role='child');
   END IF;
  END IF;
  IF visible AND tbl='deadlines' THEN
   visible:=CASE WHEN r->>'task_id' IS NOT NULL THEN app.record_notification_visible('tasks',(r->>'task_id')::uuid,recipient)
    WHEN r->>'document_id' IS NOT NULL THEN app.record_notification_visible('documents',(r->>'document_id')::uuid,recipient)
    WHEN r->>'note_id' IS NOT NULL THEN app.record_notification_visible('notes',(r->>'note_id')::uuid,recipient)
    WHEN r->>'object_id' IS NOT NULL THEN app.record_notification_visible('objects',(r->>'object_id')::uuid,recipient) ELSE false END;
  END IF;
 END IF;
 PERFORM set_config('app.notification_record',coalesce(prior_record,''),true);
 PERFORM set_config('app.notification_space',coalesce(prior_space,''),true);
 PERFORM set_config('app.notification_lookup',coalesce(prior_lookup,''),true);
 RETURN visible;
END; $$;
REVOKE ALL ON FUNCTION app.record_notification_visible(text,uuid,uuid) FROM PUBLIC,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.record_notification_visible(text,uuid,uuid) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
ALTER TABLE "deadline_notifications" ALTER COLUMN "occurrence_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repeat_rule" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "overdue_policy" text DEFAULT 'keep' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repeat_template" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repeat_processed_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "predecessor_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_event_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_previous_status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "is_main" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "radar_occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "record_table" text;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "event_kind" text;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "event_household_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_series_idx" ON "tasks" USING btree (series_id);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_predecessor_live" ON "tasks" USING btree (predecessor_id) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_series_current" ON "tasks" USING btree (series_id) WHERE series_id IS NOT NULL AND status IN ('open','waiting') AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_main_once" ON "tasks" USING btree (assignee_id) WHERE is_main AND deleted_at IS NULL AND status IN ('open','waiting');--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_radar_once" ON "tasks" USING btree (radar_occurrence_id);--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_notifications_event_once" ON "deadline_notifications" USING btree ("event_key");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repeat" CHECK (repeat_rule IS NULL OR (series_id IS NOT NULL AND plan_on IS NOT NULL AND repeat_template IS NOT NULL AND repeat_rule->>'kind' IN ('daily','weekly','monthly','yearly','every_days','after_done')));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_overdue_policy" CHECK (overdue_policy IN ('roll_forward','not_done','keep'));--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_source" CHECK ((occurrence_id IS NOT NULL AND event_key IS NULL AND record_id IS NULL AND record_table IS NULL AND event_kind IS NULL AND event_household_id IS NULL) OR (occurrence_id IS NULL AND event_key IS NOT NULL AND record_id IS NOT NULL AND record_table IN ('tasks','objects','documents','deadlines') AND event_kind IN ('assignment','task_done') AND event_household_id IS NOT NULL));--> statement-breakpoint
CREATE POLICY "tasks_repeat_owner" ON "tasks" AS PERMISSIVE FOR ALL TO "homecrm_owner" USING ((pg_trigger_depth()>0 AND (id=nullif(current_setting('app.task_repeat_source',true),'')::uuid OR predecessor_id=nullif(current_setting('app.task_repeat_source',true),'')::uuid)) OR (session_user='homecrm_worker' AND current_setting('app.task_overdue_run',true)='on' AND repeat_rule IS NOT NULL AND deleted_at IS NULL)) WITH CHECK ((pg_trigger_depth()>0 AND (id=nullif(current_setting('app.task_repeat_source',true),'')::uuid OR predecessor_id=nullif(current_setting('app.task_repeat_source',true),'')::uuid)) OR (session_user='homecrm_worker' AND current_setting('app.task_overdue_run',true)='on' AND repeat_rule IS NOT NULL AND deleted_at IS NULL));--> statement-breakpoint
CREATE POLICY "tasks_history_repeat_owner" ON "tasks_history" AS PERMISSIVE FOR INSERT TO "homecrm_owner" WITH CHECK (pg_trigger_depth()>0 AND (record_id=nullif(current_setting('app.task_repeat_source',true),'')::uuid OR EXISTS (SELECT 1 FROM tasks t WHERE t.id=record_id AND t.predecessor_id=nullif(current_setting('app.task_repeat_source',true),'')::uuid)));--> statement-breakpoint
CREATE POLICY "space_members_repeat_owner" ON "space_members" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (pg_trigger_depth()>0 AND space_id=nullif(current_setting('app.task_repeat_house',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "spaces_repeat_owner" ON "spaces" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING ((pg_trigger_depth()>0 AND id IN (nullif(current_setting('app.task_repeat_house',true),'')::uuid,nullif(current_setting('app.task_repeat_space',true),'')::uuid)) OR (session_user='homecrm_worker' AND current_setting('app.task_overdue_run',true)='on'));--> statement-breakpoint
CREATE POLICY "deadline_notifications_event_owner" ON "deadline_notifications" AS PERMISSIVE FOR INSERT TO "homecrm_owner" WITH CHECK (pg_trigger_depth()>0 AND record_id=nullif(current_setting('app.notification_record',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadline_notifications_event_read" ON "deadline_notifications" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (recipient_id=app.current_account_id() AND record_id IS NOT NULL AND app.record_notification_visible(record_table,record_id,recipient_id));

--> statement-breakpoint
CREATE POLICY "documents_notification_owner" ON "documents" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_record',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "notes_notification_owner" ON "notes" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_record',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "objects_notification_owner" ON "objects" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_record',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "tasks_notification_owner" ON "tasks" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_record',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "space_members_notification_owner" ON "space_members" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND space_id=nullif(current_setting('app.notification_space',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "spaces_notification_owner" ON "spaces" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_space',true),'')::uuid);
--> statement-breakpoint
SELECT app.grant_record_table('tasks');
--> statement-breakpoint
-- Следующая дата использует календарь, а число 31 и 29 февраля ограничиваются концом месяца.
CREATE FUNCTION app.next_task_date(rule jsonb, previous date, completed_at timestamptz, zone text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=rule->>'kind'; base date; candidate date; day_number integer; n integer;
BEGIN
 IF kind='daily' THEN RETURN previous+1;
 ELSIF kind='every_days' THEN RETURN previous+(rule->>'days')::integer;
 ELSIF kind='after_done' THEN RETURN (completed_at AT TIME ZONE zone)::date+(rule->>'days')::integer;
 ELSIF kind='weekly' THEN
  FOR n IN 1..7 LOOP
   IF (rule->'weekdays') @> to_jsonb(extract(isodow FROM previous+n)::integer) THEN RETURN previous+n; END IF;
  END LOOP;
 ELSIF kind IN ('monthly','yearly') THEN
  base:=CASE WHEN kind='monthly' THEN date_trunc('month',previous)::date ELSE make_date(extract(year FROM previous)::integer,(rule->>'month')::integer,1) END;
  FOR n IN 0..1 LOOP
   day_number:=CASE WHEN rule->>'day'='last' THEN 31 ELSE (rule->>'day')::integer END;
   candidate:=base+least(day_number,extract(day FROM base+interval '1 month'-interval '1 day')::integer)-1;
   IF candidate>previous THEN RETURN candidate; END IF;
   base:=(base+CASE WHEN kind='monthly' THEN interval '1 month' ELSE interval '1 year' END)::date;
  END LOOP;
 END IF;
 RAISE EXCEPTION 'invalid repeat rule' USING ERRCODE='check_violation';
END; $$;
REVOKE ALL ON FUNCTION app.next_task_date(jsonb,date,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_task_date(jsonb,date,timestamptz,text) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.task_repeat_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.repeat_rule IS NOT NULL THEN
  NEW.series_id:=coalesce(NEW.series_id,uuidv7());
  NEW.repeat_template:=coalesce(NEW.repeat_template,jsonb_build_object('planOn',NEW.plan_on,'assigneeId',NEW.assignee_id,'overduePolicy',NEW.overdue_policy,'title',NEW.title,'description',NEW.description,'checklist',NEW.checklist,'planTime',NEW.plan_time,'dueTime',NEW.due_time,'dueOffset',NEW.due_on-NEW.plan_on));
 END IF;
 IF TG_OP='UPDATE' AND NEW.status='done' AND OLD.status<>'done' THEN
  NEW.completion_event_id:=uuidv7(); NEW.completion_previous_status:=OLD.status;
  NEW.done_at:=clock_timestamp(); NEW.completion_undone_at:=NULL;
 END IF;
 IF NEW.status NOT IN ('open','waiting') OR NEW.deleted_at IS NOT NULL OR (TG_OP='UPDATE' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN NEW.is_main:=false; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.task_repeat_defaults() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER tasks_repeat_defaults BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app.task_repeat_defaults();
--> statement-breakpoint
CREATE FUNCTION app.task_repeat_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_day date; zone text; today date; next_assignee uuid;
 prior text:=current_setting('app.task_repeat_source',true); prior_house text:=current_setting('app.task_repeat_house',true); prior_space text:=current_setting('app.task_repeat_space',true);
BEGIN
 IF NEW.repeat_rule IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.status NOT IN ('done','not_done') OR OLD.status IN ('done','not_done') THEN RETURN NULL; END IF;
 PERFORM set_config('app.task_repeat_source',NEW.id::text,true);
 PERFORM set_config('app.task_repeat_house',NEW.household_id::text,true);
 PERFORM set_config('app.task_repeat_space',NEW.space_id::text,true);
 SELECT coalesce(s.time_zone,'UTC') INTO zone FROM public.spaces s WHERE s.id=NEW.household_id;
 today:=(coalesce(NEW.done_at,nullif(current_setting('app.task_worker_now',true),'')::timestamptz,clock_timestamp()) AT TIME ZONE zone)::date;
 next_day:=app.next_task_date(NEW.repeat_rule,coalesce((NEW.repeat_template->>'planOn')::date,NEW.plan_on),coalesce(NEW.done_at,nullif(current_setting('app.task_worker_now',true),'')::timestamptz,clock_timestamp()),zone);
 -- После простоя не создаём десятки просроченных копий. Пропуск отмечен исходным not_done.
 IF current_setting('app.task_overdue_run',true)='on' THEN
  WHILE next_day<today LOOP next_day:=app.next_task_date(NEW.repeat_rule,next_day,coalesce(NEW.done_at,nullif(current_setting('app.task_worker_now',true),'')::timestamptz,clock_timestamp()),zone); END LOOP;
 END IF;
 next_assignee:=coalesce((NEW.repeat_template->>'assigneeId')::uuid,NEW.assignee_id);
 IF NOT app.record_notification_visible('tasks',NEW.id,next_assignee) THEN next_assignee:=NEW.assignee_id; END IF;
 INSERT INTO public.tasks(space_id,space_kind,audience,author_id,assignee_id,title,description,plan_on,plan_time,due_on,due_time,household_id,checklist,repeat_rule,overdue_policy,series_id,repeat_template,predecessor_id,repeat_processed_on)
 VALUES(NEW.space_id,NEW.space_kind,NEW.audience,NEW.author_id,next_assignee,NEW.repeat_template->>'title',coalesce(NEW.repeat_template->>'description',''),next_day,NEW.repeat_template->>'planTime',next_day+(NEW.repeat_template->>'dueOffset')::integer,NEW.repeat_template->>'dueTime',NEW.household_id,
 coalesce((SELECT jsonb_agg(value||'{"done":false}'::jsonb) FROM jsonb_array_elements(NEW.repeat_template->'checklist')),'[]'::jsonb),NEW.repeat_rule,coalesce(NEW.repeat_template->>'overduePolicy',NEW.overdue_policy),NEW.series_id,jsonb_set(NEW.repeat_template,'{planOn}',to_jsonb(next_day)),NEW.id,CASE WHEN current_setting('app.task_overdue_run',true)='on' THEN today END);
 PERFORM set_config('app.task_repeat_source',coalesce(prior,''),true);
 PERFORM set_config('app.task_repeat_house',coalesce(prior_house,''),true);
 PERFORM set_config('app.task_repeat_space',coalesce(prior_space,''),true);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.task_repeat_next() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER tasks_repeat_next AFTER UPDATE OF status ON tasks FOR EACH ROW EXECUTE FUNCTION app.task_repeat_next();
--> statement-breakpoint
-- Worker не получает SELECT текстов или UPDATE пользовательских колонок. Вызов возвращает только счётчик.
CREATE FUNCTION app.process_task_overdue(moment timestamptz) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; today date; changed integer:=0;
 prior text:=current_setting('app.task_overdue_run',true); prior_now text:=current_setting('app.task_worker_now',true); prior_source text:=current_setting('app.task_repeat_source',true);
BEGIN
 IF session_user<>'homecrm_worker' THEN RAISE EXCEPTION 'worker only' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(708,1);
 PERFORM set_config('app.task_overdue_run','on',true); PERFORM set_config('app.task_worker_now',moment::text,true);
 FOR r IN SELECT t.id,t.series_id,t.overdue_policy,t.plan_on,t.due_on,(moment AT TIME ZONE coalesce(s.time_zone,'UTC'))::date AS today FROM public.tasks t JOIN public.spaces s ON s.id=t.household_id
 WHERE t.repeat_rule IS NOT NULL AND t.deleted_at IS NULL AND t.status IN ('open','waiting') AND t.plan_on<(moment AT TIME ZONE coalesce(s.time_zone,'UTC'))::date
 AND t.repeat_processed_on IS DISTINCT FROM (moment AT TIME ZONE coalesce(s.time_zone,'UTC'))::date ORDER BY t.id LOOP
  today:=r.today; PERFORM pg_advisory_xact_lock(hashtextextended(r.series_id::text,0));
  PERFORM set_config('app.task_repeat_source',r.id::text,true);
  SELECT id,series_id,overdue_policy,plan_on,due_on INTO r FROM public.tasks WHERE id=r.id AND deleted_at IS NULL AND status IN ('open','waiting') AND plan_on<today AND repeat_processed_on IS DISTINCT FROM today FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  UPDATE public.tasks SET repeat_processed_on=today,
   repeat_template=CASE WHEN r.overdue_policy='roll_forward' THEN jsonb_set(repeat_template,'{planOn}',to_jsonb(today)) ELSE repeat_template END,
   plan_on=CASE WHEN r.overdue_policy='roll_forward' THEN today ELSE plan_on END,
   due_on=CASE WHEN r.overdue_policy='roll_forward' THEN due_on+(today-r.plan_on) ELSE due_on END,
   status=CASE WHEN r.overdue_policy='not_done' THEN 'not_done' ELSE status END WHERE id=r.id;
  changed:=changed+1;
 END LOOP;
 PERFORM set_config('app.task_overdue_run',coalesce(prior,''),true); PERFORM set_config('app.task_worker_now',coalesce(prior_now,''),true); PERFORM set_config('app.task_repeat_source',coalesce(prior_source,''),true);
 RETURN changed;
END; $$;
REVOKE ALL ON FUNCTION app.process_task_overdue(timestamptz) FROM PUBLIC,homecrm_app,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.process_task_overdue(timestamptz) TO homecrm_worker;
--> statement-breakpoint
-- Старый триггер сроков теперь может работать внутри закрытого повтора/прохода worker.
ALTER FUNCTION app.task_deadlines() SECURITY DEFINER;
DO $patch$ DECLARE definition text:=pg_get_functiondef('app.task_deadlines()'::regprocedure);
BEGIN EXECUTE replace(definition,'IF current_user=''homecrm_worker'' OR NEW.household_id IS NULL','IF NEW.household_id IS NULL'); END; $patch$;
--> statement-breakpoint
CREATE FUNCTION app.record_assignment_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid; house uuid; kind text; notification_key text; prior text:=current_setting('app.notification_record',true);
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
 house:=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE (to_jsonb(NEW)->>'household_id')::uuid END;
 IF house IS NULL THEN RETURN NULL; END IF;
 IF (TG_OP='INSERT' AND NEW.assignee_id IS DISTINCT FROM NEW.author_id) OR (TG_OP='UPDATE' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
  recipient:=NEW.assignee_id; kind:='assignment'; notification_key:='assignment:'||uuidv7()::text;
 ELSIF TG_TABLE_NAME='tasks' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'status'='done' AND to_jsonb(OLD)->>'status'<>'done' AND NEW.author_id IS DISTINCT FROM NEW.assignee_id THEN
  recipient:=NEW.author_id; kind:='task_done'; notification_key:='task_done:'||(to_jsonb(NEW)->>'completion_event_id');
 ELSE RETURN NULL;
 END IF;
 IF NOT app.record_notification_visible(TG_TABLE_NAME,NEW.id,recipient) THEN RETURN NULL; END IF;
 PERFORM set_config('app.notification_record',NEW.id::text,true);
 INSERT INTO public.deadline_notifications(recipient_id,warning_at,event_key,record_table,record_id,event_kind,event_household_id)
 VALUES(recipient,CASE WHEN kind='task_done' THEN clock_timestamp()+interval '7 seconds' ELSE clock_timestamp() END,notification_key,TG_TABLE_NAME,NEW.id,kind,house);
 PERFORM set_config('app.notification_record',coalesce(prior,''),true);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.record_assignment_notification() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER tasks_assignment_push AFTER INSERT OR UPDATE OF assignee_id,status ON tasks FOR EACH ROW EXECUTE FUNCTION app.record_assignment_notification();
CREATE TRIGGER objects_assignment_push AFTER UPDATE OF assignee_id ON objects FOR EACH ROW EXECUTE FUNCTION app.record_assignment_notification();
CREATE TRIGGER documents_assignment_push AFTER UPDATE OF assignee_id ON documents FOR EACH ROW EXECUTE FUNCTION app.record_assignment_notification();
CREATE TRIGGER deadlines_assignment_push AFTER UPDATE OF assignee_id ON deadlines FOR EACH ROW WHEN (NEW.source_kind='record') EXECUTE FUNCTION app.record_assignment_notification();

--> statement-breakpoint
CREATE FUNCTION app.task_undo_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_row record; prior text:=current_setting('app.task_repeat_source',true); prior_space text:=current_setting('app.task_repeat_space',true); prior_house text:=current_setting('app.task_repeat_house',true);
BEGIN
 IF NEW.completion_undone_at IS NULL OR NEW.completion_undone_at IS NOT DISTINCT FROM OLD.completion_undone_at THEN RETURN NEW; END IF;
 IF OLD.completion_event_id IS NULL OR OLD.status<>'done' OR OLD.completion_undone_at IS NOT NULL OR OLD.done_at<clock_timestamp()-interval '7 seconds'
 OR NEW.status IS DISTINCT FROM OLD.completion_previous_status OR NEW.completion_event_id IS DISTINCT FROM OLD.completion_event_id THEN
  RAISE EXCEPTION 'completion cannot be undone' USING ERRCODE='check_violation';
 END IF;
 PERFORM set_config('app.task_repeat_source',OLD.id::text,true);
 PERFORM set_config('app.task_repeat_space',OLD.space_id::text,true); PERFORM set_config('app.task_repeat_house',coalesce(OLD.household_id::text,''),true);
 FOR next_row IN SELECT id,status,created_at,updated_at,has_other_contributions FROM public.tasks WHERE predecessor_id=OLD.id AND deleted_at IS NULL FOR UPDATE LOOP
  IF next_row.status<>'open' OR next_row.updated_at<>next_row.created_at OR next_row.has_other_contributions THEN RAISE EXCEPTION 'next task has changed' USING ERRCODE='check_violation'; END IF;
  UPDATE public.tasks SET deleted_at=clock_timestamp() WHERE id=next_row.id;
 END LOOP;
 NEW.completion_undone_at:=clock_timestamp();
 PERFORM set_config('app.task_repeat_space',coalesce(prior_space,''),true); PERFORM set_config('app.task_repeat_house',coalesce(prior_house,''),true);
 PERFORM set_config('app.task_repeat_source',coalesce(prior,''),true);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.task_undo_next() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER tasks_01_undo BEFORE UPDATE OF completion_undone_at ON tasks FOR EACH ROW EXECUTE FUNCTION app.task_undo_next();

--> statement-breakpoint
CREATE POLICY "deadlines_task_owner_insert" ON "deadlines" AS PERMISSIVE FOR INSERT TO "homecrm_owner" WITH CHECK (pg_trigger_depth()>0 AND task_id=nullif(current_setting('app.deadline_source_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "deadlines_notification_owner" ON "deadlines" AS PERMISSIVE FOR SELECT TO "homecrm_owner" USING (current_setting('app.notification_lookup',true)='on' AND id=nullif(current_setting('app.notification_record',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION app.record_notification_current(tbl text,rid uuid,recipient uuid,kind text,event_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; result boolean:=false; prior text:=current_setting('app.notification_record',true); prior_lookup text:=current_setting('app.notification_lookup',true);
BEGIN
 IF NOT app.record_notification_visible(tbl,rid,recipient) THEN RETURN false; END IF;
 PERFORM set_config('app.notification_record',rid::text,true); PERFORM set_config('app.notification_lookup','on',true);
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND deleted_at IS NULL',tbl) INTO r USING rid;
 IF kind='assignment' THEN
  result:=r->>'assignee_id'=recipient::text AND (tbl<>'tasks' OR r->>'status' IN ('open','waiting'));
 ELSE
  result:=tbl='tasks' AND r->>'author_id'=recipient::text AND r->>'status'='done' AND r->>'completion_undone_at' IS NULL AND event_key='task_done:'||(r->>'completion_event_id');
 END IF;
 PERFORM set_config('app.notification_record',coalesce(prior,''),true); PERFORM set_config('app.notification_lookup',coalesce(prior_lookup,''),true);
 RETURN coalesce(result,false);
END; $$;
REVOKE ALL ON FUNCTION app.record_notification_current(text,uuid,uuid,text,text) FROM PUBLIC,homecrm_app,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.record_notification_current(text,uuid,uuid,text,text) TO homecrm_worker;

--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "assignee_override_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_assignee_override_id_accounts_id_fk" FOREIGN KEY ("assignee_override_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_assignee_override" CHECK (assignee_override_id IS NULL OR source_kind='record');
--> statement-breakpoint
GRANT SELECT(assignee_override_id) ON deadlines TO homecrm_worker;
GRANT UPDATE(assignee_override_id) ON deadlines TO homecrm_app;
--> statement-breakpoint
DO $guard$ DECLARE definition text:=pg_get_functiondef('app.deadline_guard()'::regprocedure);
BEGIN
 definition:=replace(definition,'''assignee_id'',''household_id''','''assignee_id'',''household_id'',''assignee_override_id''');
 definition:=replace(definition,
  '(NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.assignee_id)',
  '(NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) OR (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NEW.source_kind<>''record'')');
 definition:=replace(definition,'IF cascading THEN',
  'IF cascading THEN
   IF NEW.assignee_override_id IS NOT NULL AND NOT app.record_notification_visible(CASE WHEN NEW.note_id IS NOT NULL THEN ''notes'' ELSE ''objects'' END,coalesce(NEW.note_id,NEW.object_id),NEW.assignee_override_id) THEN NEW.assignee_override_id:=NULL; END IF;
   NEW.assignee_id:=coalesce(NEW.assignee_override_id,NEW.assignee_id);');
 definition:=replace(definition,'NEW.assignee_id:=p.assignee_id;',
  'IF NEW.assignee_override_id IS NOT NULL AND NOT app.record_notification_visible(tbl,rid,NEW.assignee_override_id) THEN RAISE EXCEPTION ''assignee cannot see source'' USING ERRCODE=''check_violation''; END IF;
   NEW.assignee_id:=coalesce(NEW.assignee_override_id,p.assignee_id);');
 EXECUTE definition;
END; $guard$;
--> statement-breakpoint
-- Передача срока хранится в истории его источника под прежними правилами доступа.
CREATE FUNCTION app.deadline_assignment_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tbl text:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid uuid:=coalesce(NEW.note_id,NEW.object_id);
BEGIN
 IF current_user<>'homecrm_app' OR NEW.source_kind<>'record' OR NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN RETURN NULL; END IF;
 EXECUTE format('INSERT INTO public.%I(record_id,space_id,space_kind,audience,actor_id,operation,changes) VALUES($1,$2,$3,$4,$5,''update'',$6)',tbl||'_history')
 USING rid,NEW.space_id,NEW.space_kind,NEW.audience,app.current_account_id(),jsonb_build_object('deadline_assignment',jsonb_build_object('old',OLD.assignee_id,'new',NEW.assignee_id),'deadline_id',NEW.id);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.deadline_assignment_history() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
CREATE TRIGGER deadlines_assignment_history AFTER UPDATE OF assignee_override_id ON deadlines FOR EACH ROW EXECUTE FUNCTION app.deadline_assignment_history();

--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_trash_key" uuid;
--> statement-breakpoint
SELECT app.grant_record_table('tasks');
