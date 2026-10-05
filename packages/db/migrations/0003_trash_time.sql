-- Время переноса в корзину ставит база (ADR-0004, PRD DATA-1). Иначе приложение могло бы записать
-- в deleted_at прошедшую дату, и обработчик сразу удалил бы запись навсегда, минуя 30 дней корзины.
-- Триггер, а не условие политики: WITH CHECK видит только новую строку и не отличает
-- неизменную дату записи в корзине от переписанной; триггер видит обе.
--
-- В корзину: deleted_at = now(), что бы ни прислало приложение.
-- Уже в корзине: дату изменить нельзя, можно только восстановить (deleted_at = NULL).
CREATE FUNCTION app.guard_trash_time() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := now();
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL
    AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'deleted_at of a trashed record cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notes_trash_time BEFORE UPDATE OF deleted_at ON notes
  FOR EACH ROW EXECUTE FUNCTION app.guard_trash_time();
--> statement-breakpoint
CREATE TRIGGER shopping_items_trash_time BEFORE UPDATE OF deleted_at ON shopping_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_trash_time();
--> statement-breakpoint
CREATE TRIGGER tasks_trash_time BEFORE UPDATE OF deleted_at ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.guard_trash_time();
