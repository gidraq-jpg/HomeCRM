-- TASK-7: одно событие владеет созданным следующим экземпляром даже после повторного выполнения.
ALTER TABLE tasks ADD COLUMN repeat_next_event_id uuid;
--> statement-breakpoint
CREATE POLICY tasks_completion_backfill ON tasks FOR ALL TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY tasks_history_completion_backfill ON tasks_history FOR SELECT TO homecrm_owner USING (true);
ALTER TABLE tasks DISABLE TRIGGER USER;
-- История создания преемника и выполнения записана одной транзакцией. Не приписываем
-- старый преемник новому событию; при отсутствии истории оставляем защитный UUID.
UPDATE tasks t SET repeat_next_event_id=coalesce(
 (SELECT (h.changes->'completion_event_id'->>'new')::uuid
  FROM tasks n JOIN tasks_history h ON h.record_id=t.id AND h.created_at=n.created_at
  WHERE n.predecessor_id=t.id AND n.deleted_at IS NULL AND h.changes->'status'->>'new'='done'
    AND h.changes->'completion_event_id'->>'new' IS NOT NULL
  ORDER BY h.id LIMIT 1),
 CASE WHEN NOT EXISTS (SELECT 1 FROM tasks n WHERE n.predecessor_id=t.id AND n.deleted_at IS NULL)
  THEN t.completion_event_id END,
 uuidv7())
WHERE t.repeat_rule IS NOT NULL AND (
 EXISTS (SELECT 1 FROM tasks n WHERE n.predecessor_id=t.id AND n.deleted_at IS NULL)
 OR (t.completion_event_id IS NOT NULL AND t.completion_undone_at IS NULL)
 OR t.status='not_done');
ALTER TABLE tasks ENABLE TRIGGER USER;
DROP POLICY tasks_history_completion_backfill ON tasks_history;
DROP POLICY tasks_completion_backfill ON tasks;
--> statement-breakpoint
DROP INDEX tasks_series_current;
CREATE UNIQUE INDEX "tasks_series_current" ON "tasks" USING btree (series_id) WHERE series_id IS NOT NULL AND status IN ('open','waiting') AND deleted_at IS NULL AND repeat_next_event_id IS NULL;
--> statement-breakpoint
DO $defaults$
DECLARE definition text:=pg_get_functiondef('app.task_repeat_defaults()'::regprocedure);
BEGIN
 definition:=replace(definition,' IF NEW.status NOT IN',
  ' IF TG_OP=''UPDATE'' AND NEW.repeat_rule IS NOT NULL AND NEW.deleted_at IS NULL
     AND NEW.status IN (''done'',''not_done'') AND OLD.status NOT IN (''done'',''not_done'')
     AND OLD.repeat_next_event_id IS NULL THEN
    NEW.repeat_next_event_id:=coalesce(NEW.completion_event_id,uuidv7());
   END IF;
 IF NEW.status NOT IN');
 EXECUTE definition;
END; $defaults$;
--> statement-breakpoint
DO $next$
DECLARE definition text:=pg_get_functiondef('app.task_repeat_next()'::regprocedure);
BEGIN
 definition:=replace(definition,'IF OLD.completion_event_id IS NOT NULL AND OLD.completion_undone_at IS NULL THEN RETURN NULL;',
  'IF OLD.repeat_next_event_id IS NOT NULL THEN RETURN NULL;');
 EXECUTE definition;
END; $next$;
--> statement-breakpoint
DO $undo$
DECLARE definition text:=pg_get_functiondef('app.task_undo_next()'::regprocedure);
BEGIN
 definition:=replace(definition,' FOR next_row IN SELECT',
  ' -- Отмена касается только преемника, созданного именно отменяемым выполнением.
 IF OLD.repeat_next_event_id=OLD.completion_event_id THEN
 FOR next_row IN SELECT');
 definition:=replace(definition,E' END LOOP;\n NEW.completion_undone_at',
  E' END LOOP;\n NEW.repeat_next_event_id:=NULL;\n END IF;\n NEW.completion_undone_at');
 EXECUTE definition;
END; $undo$;
--> statement-breakpoint
SELECT app.grant_record_table('tasks');
