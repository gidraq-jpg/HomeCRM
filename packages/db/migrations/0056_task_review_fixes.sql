-- TASK-1, PRD 7.3.7: размещение и ответственный файлов следуют делу атомарно,
-- под теми же RLS и проверками, что прежний каскад размещения.
CREATE FUNCTION app.cascade_task_files() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
    UPDATE public.task_files SET space_id=NEW.space_id,space_kind=NEW.space_kind,
      audience=NEW.audience,assignee_id=NEW.assignee_id WHERE parent_id=NEW.id;
  ELSIF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    -- Worker вправе менять только ответственного, без прав на размещение и тексты.
    UPDATE public.task_files SET assignee_id=NEW.assignee_id
      WHERE parent_id=NEW.id AND assignee_id IS DISTINCT FROM NEW.assignee_id;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.cascade_task_files() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
DROP TRIGGER tasks_files_placement ON tasks;
CREATE TRIGGER tasks_files_placement AFTER UPDATE OF space_id,space_kind,audience,assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.cascade_task_files();
--> statement-breakpoint
-- Как при переносе, отдельно удалённый файл сохраняет корзину, но следует метаданным
-- родителя. Исключение касается только вложенного каскада, совпадающего с делом.
DO $guard$
DECLARE definition text := pg_get_functiondef('app.record_guard()'::regprocedure);
BEGIN
  definition := replace(definition,
    'ignored := ignored || ARRAY[''space_id'', ''space_kind'', ''audience''];',
    'ignored := ignored || ARRAY[''space_id'', ''space_kind'', ''audience''];
      IF TG_TABLE_NAME=''task_files'' AND pg_trigger_depth()>1 AND EXISTS (
        SELECT 1 FROM public.tasks t WHERE t.id=(to_jsonb(NEW)->>''parent_id'')::uuid
          AND (t.space_id,t.space_kind,t.audience,t.assignee_id)
            IS NOT DISTINCT FROM (NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id)
      ) THEN ignored := ignored || ARRAY[''assignee_id'']; END IF;');
  EXECUTE definition;
END; $guard$;
