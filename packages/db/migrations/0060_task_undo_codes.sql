-- TASK-7: точные причины отказа в атомарном триггере; права и блокировки не меняются.
CREATE OR REPLACE FUNCTION app.task_undo_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_row record; prior text:=current_setting('app.task_repeat_source',true); prior_space text:=current_setting('app.task_repeat_space',true); prior_house text:=current_setting('app.task_repeat_house',true);
BEGIN
 IF OLD.status='done' AND NEW.status IN ('open','waiting') AND NEW.completion_undone_at IS NOT DISTINCT FROM OLD.completion_undone_at THEN
  NEW.done_at:=NULL;
  IF OLD.done_at>=clock_timestamp()-interval '7 seconds' AND OLD.completion_event_id IS NOT NULL THEN
   NEW.completion_undone_at:=clock_timestamp();
  ELSE
   NEW.completion_event_id:=coalesce(OLD.completion_event_id,uuidv7());
   RETURN NEW;
  END IF;
 END IF;
 IF NEW.completion_undone_at IS NULL OR NEW.completion_undone_at IS NOT DISTINCT FROM OLD.completion_undone_at THEN RETURN NEW; END IF;
 IF OLD.completion_event_id IS NULL OR OLD.status<>'done' OR OLD.completion_undone_at IS NOT NULL
 OR NEW.status NOT IN ('open','waiting') OR NEW.completion_event_id IS DISTINCT FROM OLD.completion_event_id THEN
  RAISE EXCEPTION 'completion cannot be undone' USING ERRCODE='check_violation', CONSTRAINT='task_completion_changed';
 END IF;
 IF OLD.done_at IS NULL OR OLD.done_at<clock_timestamp()-interval '7 seconds' THEN
  RAISE EXCEPTION 'undo window expired' USING ERRCODE='check_violation', CONSTRAINT='task_undo_expired';
 END IF;
 PERFORM set_config('app.task_repeat_source',OLD.id::text,true);
 PERFORM set_config('app.task_repeat_space',OLD.space_id::text,true); PERFORM set_config('app.task_repeat_house',coalesce(OLD.household_id::text,''),true);
 IF OLD.repeat_next_event_id=OLD.completion_event_id THEN
  FOR next_row IN SELECT id,status,created_at,updated_at,has_other_contributions FROM public.tasks WHERE predecessor_id=OLD.id AND deleted_at IS NULL FOR UPDATE LOOP
   IF next_row.status<>'open' OR next_row.updated_at<>next_row.created_at OR next_row.has_other_contributions THEN
    RAISE EXCEPTION 'next task has changed' USING ERRCODE='check_violation', CONSTRAINT='task_next_task_changed';
   END IF;
   UPDATE public.tasks SET deleted_at=clock_timestamp() WHERE id=next_row.id;
  END LOOP;
  NEW.repeat_next_event_id:=NULL;
 END IF;
 NEW.completion_undone_at:=clock_timestamp();
 PERFORM set_config('app.task_repeat_space',coalesce(prior_space,''),true); PERFORM set_config('app.task_repeat_house',coalesce(prior_house,''),true);
 PERFORM set_config('app.task_repeat_source',coalesce(prior,''),true);
 RETURN NEW;
END; $$;
