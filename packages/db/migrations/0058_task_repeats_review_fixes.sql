DROP INDEX "tasks_series_current";--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_series_current" ON "tasks" USING btree (series_id) WHERE series_id IS NOT NULL AND status IN ('open','waiting') AND deleted_at IS NULL AND (completion_event_id IS NULL OR completion_undone_at IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.task_repeat_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_day date; zone text; today date; next_assignee uuid;
 prior text:=current_setting('app.task_repeat_source',true); prior_house text:=current_setting('app.task_repeat_house',true); prior_space text:=current_setting('app.task_repeat_space',true);
BEGIN
 IF NEW.repeat_rule IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.status NOT IN ('done','not_done') OR OLD.status IN ('done','not_done') THEN RETURN NULL; END IF;
 -- Возобновлённый экземпляр уже породил следующий; повторное закрытие не меняет цепочку.
 IF OLD.completion_event_id IS NOT NULL AND OLD.completion_undone_at IS NULL THEN RETURN NULL; END IF;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.task_undo_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_row record; prior text:=current_setting('app.task_repeat_source',true); prior_space text:=current_setting('app.task_repeat_space',true); prior_house text:=current_setting('app.task_repeat_house',true);
BEGIN
 -- Обычные status=open и PATCH используют тот же атомарный путь, что /undo.
 IF OLD.status='done' AND NEW.status='open' AND NEW.completion_undone_at IS NOT DISTINCT FROM OLD.completion_undone_at THEN
  NEW.done_at:=NULL;
  IF OLD.done_at>=clock_timestamp()-interval '7 seconds' AND OLD.completion_event_id IS NOT NULL THEN
   NEW.completion_undone_at:=clock_timestamp();
  ELSE
   -- После окна отмены сохраняем событие и преемника; UUID нужен также старым выполненным делам.
   NEW.completion_event_id:=coalesce(OLD.completion_event_id,uuidv7());
   RETURN NEW;
  END IF;
 END IF;
 IF NEW.completion_undone_at IS NULL OR NEW.completion_undone_at IS NOT DISTINCT FROM OLD.completion_undone_at THEN RETURN NEW; END IF;
 IF OLD.completion_event_id IS NULL OR OLD.status<>'done' OR OLD.completion_undone_at IS NOT NULL OR OLD.done_at<clock_timestamp()-interval '7 seconds'
 OR NEW.status NOT IN ('open','waiting') OR NEW.completion_event_id IS DISTINCT FROM OLD.completion_event_id THEN
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
DROP TRIGGER tasks_01_undo ON tasks;
CREATE TRIGGER tasks_01_undo BEFORE UPDATE OF status,completion_undone_at ON tasks FOR EACH ROW EXECUTE FUNCTION app.task_undo_next();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_assignment_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE house uuid; prior text:=current_setting('app.notification_record',true);
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
 house:=CASE WHEN NEW.space_kind='household' THEN NEW.space_id ELSE (to_jsonb(NEW)->>'household_id')::uuid END;
 IF house IS NULL THEN RETURN NULL; END IF;
 PERFORM set_config('app.notification_record',NEW.id::text,true);
 -- Назначение и выполнение независимы. Закрытому делу назначение уже не актуально.
 IF ((TG_OP='INSERT' AND NEW.assignee_id IS DISTINCT FROM NEW.author_id) OR (TG_OP='UPDATE' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id))
 AND (TG_TABLE_NAME<>'tasks' OR to_jsonb(NEW)->>'status' IN ('open','waiting'))
 AND app.record_notification_visible(TG_TABLE_NAME,NEW.id,NEW.assignee_id) THEN
  INSERT INTO public.deadline_notifications(recipient_id,warning_at,event_key,record_table,record_id,event_kind,event_household_id)
  VALUES(NEW.assignee_id,clock_timestamp(),'assignment:'||uuidv7()::text,TG_TABLE_NAME,NEW.id,'assignment',house);
 END IF;
 IF TG_TABLE_NAME='tasks' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'status'='done' AND to_jsonb(OLD)->>'status'<>'done'
 AND NEW.author_id IS DISTINCT FROM coalesce(app.current_account_id(),NEW.assignee_id)
 AND app.record_notification_visible(TG_TABLE_NAME,NEW.id,NEW.author_id) THEN
  INSERT INTO public.deadline_notifications(recipient_id,warning_at,event_key,record_table,record_id,event_kind,event_household_id)
  VALUES(NEW.author_id,clock_timestamp()+interval '7 seconds','task_done:'||(to_jsonb(NEW)->>'completion_event_id'),TG_TABLE_NAME,NEW.id,'task_done',house);
 END IF;
 PERFORM set_config('app.notification_record',coalesce(prior,''),true);
 RETURN NULL;
END; $$;
--> statement-breakpoint
-- История различает отмену и возобновление; прежние снимки и права не переписываются.
DO $history$
DECLARE definition text:=pg_get_functiondef('app.record_history()'::regprocedure);
BEGIN
 definition:=replace(definition,'IF changes = ''{}''::jsonb THEN',
  'IF TG_TABLE_NAME=''tasks'' AND to_jsonb(OLD)->>''status''=''done'' AND to_jsonb(NEW)->>''status''=''open'' AND to_jsonb(NEW)->>''completion_undone_at'' IS NULL THEN
   changes:=changes || jsonb_build_object(''task_resumed'',jsonb_build_object(''new'',true));
  END IF; IF changes = ''{}''::jsonb THEN');
 EXECUTE definition;
END; $history$;
