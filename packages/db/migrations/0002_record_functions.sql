-- Функции и триггеры записей пользователя (R0.1; ADR-0004). drizzle-kit функций не создаёт.
--
-- Все функции — с правами вызывающего (не SECURITY DEFINER): они обходили бы RLS, а у владельца
-- таблиц по FORCE нет ни одной строки. Поэтому всё, что триггеры делают с данными, они делают
-- от имени того, кто выполняет запрос, и политики RLS действуют и на них.
-- `SET search_path = ''` — чтобы функции нельзя было подменить объектами в другой схеме;
-- имена таблиц и функций в телах — с указанием схемы.

-- Время переноса в корзину ставит база (ADR-0004, PRD DATA-1). Иначе приложение могло бы записать
-- в deleted_at прошедшую дату, и обработчик сразу удалил бы запись навсегда, минуя 30 дней корзины.
-- Триггер, а не условие политики: WITH CHECK видит только новую строку и не отличает
-- неизменную дату записи в корзине от переписанной; триггер видит обе.
--
-- В корзину: deleted_at = now(), что бы ни прислало приложение.
-- Уже в корзине: дату изменить нельзя, можно только восстановить (deleted_at = NULL).
CREATE FUNCTION app.guard_trash_time() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
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
-- Значения по умолчанию, которые приложение переопределить не может.
--   Время создания и изменения новой записи ставит база: задним числом запись не создают.
--   Ответственный по правилу 9 (PRD 7.3): в личном — всегда владелец пространства, в общем —
--   назначенный, а если не назначен, то автор. Принадлежность к дому и «взрослость» для записей
--   «Взрослые» проверяют внешние ключи таблицы, а не триггер: триггер выполняется с правами
--   участника и чужих членов дома не видит.
CREATE FUNCTION app.record_defaults() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
  END IF;
  IF NEW.space_kind = 'personal' THEN
    NEW.assignee_id := (SELECT s.owner_account_id FROM public.spaces s WHERE s.id = NEW.space_id);
  ELSIF NEW.assignee_id IS NULL THEN
    NEW.assignee_id := NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Что нельзя менять никогда: id, автора и время создания. Что нельзя менять в корзине: ничего —
-- запись можно только восстановить как есть; у дочерней записи пространство и аудитория следуют за
-- родителем, поэтому при переносе родителя они меняются и у записей в корзине. Время изменения ставит база.
-- Ключи ответственного (assignee_*_id, assignee_adult_flag) база вычисляет сама после триггеров.
CREATE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag'];
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'id, author_id and created_at of a record cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    IF TG_ARGV[0] = 'child' THEN
      ignored := ignored || ARRAY['space_id', 'space_kind', 'audience'];
    END IF;
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'a record in the trash cannot be changed or moved; restore it first'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- История изменений (OBJ-6): кто, когда, какие поля — со старыми и новыми значениями. Ведётся у записей
-- общего пространства: создание, любое изменение, перенос в общее и из общего. У личных записей события
-- не пишутся (их не видит никто, кроме владельца, и история личного — не требование PRD).
-- Место события (пространство и аудитория) фиксируется в момент события и дальше не меняется. Читать
-- событие вправе тот, кто видит это место И видит запись сейчас (политика, records.ts): запись открыли
-- шире или перенесли — прошлое остаётся только у тех, кто видел его тогда. Если одним изменением
-- меняется и место, событие ставится на более узкое из двух: личное — самое узкое, затем старый дом
-- при переносе между домами, затем «Взрослые». Так старые значения полей не попадают к тем, кому они
-- не были видны, даже если правка и расширение аудитории пришли в одном запросе.
-- Вставка в историю проходит политику, потому что идёт изнутри триггера (pg_trigger_depth() > 0).
CREATE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.space_kind <> 'household' THEN
      RETURN NULL;
    END IF;
    operation := 'create';
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json - ARRAY['id', 'created_at']) AS e
      WHERE e.value <> 'null'::jsonb;
  ELSE
    IF OLD.space_kind <> 'household' AND NEW.space_kind <> 'household' THEN
      RETURN NULL;
    END IF;
    old_json := to_jsonb(OLD) - hidden;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
    IF changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    operation := CASE
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'trash'
      WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore'
      WHEN OLD.space_id <> NEW.space_id OR OLD.space_kind <> NEW.space_kind THEN 'move'
      WHEN OLD.audience IS DISTINCT FROM NEW.audience THEN 'audience'
      ELSE 'update'
    END;
    -- Более узкое из двух мест.
    IF OLD.space_kind = 'personal' THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND OLD.space_id <> NEW.space_id THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND (OLD.audience = 'adults' OR NEW.audience = 'adults') THEN
      place_audience := 'adults';
    END IF;
  END IF;
  EXECUTE format(
    'INSERT INTO public.%I (record_id, space_id, space_kind, audience, actor_id, operation, changes) '
    'VALUES ($1, $2, $3, $4, $5, $6::public.history_operation, $7)',
    TG_TABLE_NAME || '_history'
  ) USING NEW.id, place_id, place_kind, place_audience, app.current_account_id(), operation, changes;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Запись в корзину — и её дочерние записи туда же; восстановили — вернулись те, что ушли вместе с ней
-- (с той же отметкой времени). Выполняется с правами участника: если ему нельзя восстановить какую-то
-- дочернюю запись (чужая запись во «Взрослых» у взрослого-не-автора), она остаётся в корзине, и её
-- восстановит администратор: так ничего не пропадает и не открывается лишнего.
CREATE FUNCTION app.cascade_trash() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET deleted_at = $1 WHERE parent_id = $2 AND deleted_at IS NULL', TG_ARGV[0])
      USING NEW.deleted_at, NEW.id;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    EXECUTE format('UPDATE public.%I SET deleted_at = NULL WHERE parent_id = $1 AND deleted_at = $2', TG_ARGV[0])
      USING NEW.id, OLD.deleted_at;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Живая дочерняя запись при родителе в корзине невозможна: ни вставкой пункта под заметку в корзине,
-- ни отдельным восстановлением пункта, ни переносом под другого родителя. Иначе очистка корзины,
-- удалив просроченного родителя (ON DELETE CASCADE), унесла бы вместе с ним живую запись мимо корзины.
-- Пункт восстанавливают вместе с родителем (каскад) или после него. Родитель виден вызывающему так же,
-- как сама запись (то же место); если не виден — проверку остаётся за внешним ключом.
CREATE FUNCTION app.guard_parent_live() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  parent_trashed boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT p.deleted_at IS NOT NULL FROM public.%I p WHERE p.id = $1', TG_ARGV[0])
    INTO parent_trashed USING NEW.parent_id;
  IF parent_trashed THEN
    RAISE EXCEPTION 'a live record cannot belong to a parent in the trash; restore the parent first'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- SPACE-1: личное пространство создаётся вместе с учётной записью. Проверка отложена до конца
-- транзакции: учётную запись и пространство записывают в одной транзакции в любом порядке.
CREATE FUNCTION app.require_personal_space() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces s WHERE s.owner_account_id = NEW.id AND s.kind = 'personal'
  ) THEN
    RAISE EXCEPTION 'account % has no personal space', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- SPACE-8, SPACE-9: ушедший не возвращается правкой строки, а последнему администратору дом покидать
-- и сдавать роль нельзя — иначе записи ушедшего некому передать (PRD 7.3.12). Какие колонки службе входа
-- можно менять, решают права на колонки; здесь — правила о составе. Выполняется с правами службы входа:
-- она видит всех участников.
CREATE FUNCTION app.guard_member_leave() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.left_at IS NOT NULL AND (NEW.left_at IS DISTINCT FROM OLD.left_at OR NEW.left_by IS DISTINCT FROM OLD.left_by) THEN
    RAISE EXCEPTION 'a membership that has ended cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.role = 'admin' AND OLD.left_at IS NULL
    AND (NEW.left_at IS NOT NULL OR NEW.role <> 'admin')
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members o
      WHERE o.space_id = NEW.space_id AND o.account_id <> NEW.account_id
        AND o.role = 'admin' AND o.left_at IS NULL
    ) THEN
    RAISE EXCEPTION 'the last administrator cannot leave the household or give up the role'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- PRD 7.3.12: когда участник ушёл из дома, ответственность за его записи переходит администратору.
-- Вызывает обработчик (роль homecrm_worker) после ухода или исключения и периодически. Его политики
-- пускают только к записям общего пространства, живым, с ответственным, который ушёл, и записывают
-- только действующего администратора того же дома — старейшего по дате вступления. Без самих
-- текстов: у обработчика нет права читать поля, кроме перечисленных в attach_record_table.
-- Возвращает число переданных записей. Таблицы записей находит по триггеру `<таблица>_guard`.
CREATE FUNCTION app.reassign_responsibility() RETURNS integer
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  tbl text;
  moved integer := 0;
  changed integer;
BEGIN
  FOR tbl IN
    SELECT c.relname::text
    FROM pg_catalog.pg_trigger g
    JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
    WHERE g.tgfoid = 'app.record_guard'::regproc AND NOT g.tgisinternal
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'UPDATE public.%1$I r SET assignee_id = ('
      '  SELECT a.account_id FROM public.space_members a'
      '  WHERE a.space_id = r.space_id AND a.role = ''admin'' AND a.left_at IS NULL'
      '  ORDER BY a.created_at, a.account_id LIMIT 1) '
      'WHERE r.space_kind = ''household'' AND r.deleted_at IS NULL AND EXISTS ('
      '  SELECT 1 FROM public.space_members l'
      '  WHERE l.space_id = r.space_id AND l.account_id = r.assignee_id AND l.left_at IS NOT NULL) '
      'AND EXISTS ('
      '  SELECT 1 FROM public.space_members a'
      '  WHERE a.space_id = r.space_id AND a.role = ''admin'' AND a.left_at IS NULL)',
      tbl
    );
    GET DIAGNOSTICS changed = ROW_COUNT;
    moved := moved + changed;
  END LOOP;
  RETURN moved;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reassign_responsibility() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reassign_responsibility() TO homecrm_worker;
--> statement-breakpoint
-- Права ролей на таблицу записей (повторяемо: после ALTER TABLE ... ADD COLUMN вызовите снова).
--   Приложение читает всё, вставляет любые колонки (Drizzle перечисляет все колонки в INSERT, даже
--     со значением DEFAULT; подмену времени создания и отметки корзины закрывают триггер и политика),
--     а меняет всё, кроме id, автора, времени создания и изменения — их не меняет никто (PRD 6.2);
--   обработчик читает только id, пространство, ответственного и отметку корзины, меняет только
--     ответственного (передача записей ушедшего) и удаляет просроченное: текстов записей он не видит.
CREATE FUNCTION app.grant_record_table(tbl text) RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  rel text := format('public.%I', tbl);
  hist text := format('public.%I', tbl || '_history');
  updatable text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
  INTO updatable
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = rel::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND a.attname NOT IN ('id', 'author_id', 'created_at', 'updated_at');

  EXECUTE format('GRANT SELECT, INSERT ON %s TO homecrm_app', rel);
  EXECUTE format('GRANT UPDATE (%s) ON %s TO homecrm_app', updatable, rel);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO homecrm_app', hist);
  EXECUTE format('GRANT SELECT (id, space_id, space_kind, assignee_id, deleted_at) ON %s TO homecrm_worker', rel);
  EXECUTE format('GRANT UPDATE (assignee_id) ON %s TO homecrm_worker', rel);
  EXECUTE format('GRANT DELETE ON %s TO homecrm_worker', rel);
  EXECUTE format('GRANT INSERT ON %s TO homecrm_worker', hist);
END;
$$;
--> statement-breakpoint
-- Подключает таблицу записей к защите: один вызов вместо ручного SQL (ничего не забывается).
-- Вызывается в миграции сразу после CREATE TABLE. Таблица и её история `<таблица>_history`
-- создаются drizzle-kit из recordTable() (records.ts); политики RLS и ограничения — оттуда же.
-- Здесь — то, чего drizzle-kit не умеет:
--   FORCE ROW LEVEL SECURITY (владелец таблиц тоже не обходит RLS);
--   права ролей (grant_record_table);
--   триггеры: время и ответственный по умолчанию, защита полей и корзины, время корзины, история;
--   у дочерней таблицы (второй аргумент — таблица родителя): внешние ключи на родителя, отложенные
--     до конца транзакции (родителя и детей переносят вместе), и каскад корзины.
CREATE FUNCTION app.attach_record_table(tbl text, parent text DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  rel text := format('public.%I', tbl);
  hist text := format('public.%I', tbl || '_history');
BEGIN
  IF to_regclass(rel) IS NULL OR to_regclass(hist) IS NULL THEN
    RAISE EXCEPTION 'tables % and % must exist; create them with recordTable() first', tbl, tbl || '_history';
  END IF;

  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', hist);
  PERFORM app.grant_record_table(tbl);

  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_defaults()',
    tbl || '_defaults', rel);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_guard(%L)',
    tbl || '_guard', rel, CASE WHEN parent IS NULL THEN 'root' ELSE 'child' END);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF deleted_at ON %s FOR EACH ROW EXECUTE FUNCTION app.guard_trash_time()',
    tbl || '_trash_time', rel);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.record_history()',
    tbl || '_history', rel);

  IF parent IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (parent_id, space_id, space_kind) '
      'REFERENCES public.%I (id, space_id, space_kind) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED',
      rel, tbl || '_parent_space_fk', parent);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (parent_id, audience) '
      'REFERENCES public.%I (id, audience) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED',
      rel, tbl || '_parent_audience_fk', parent);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF deleted_at, parent_id ON %s FOR EACH ROW EXECUTE FUNCTION app.guard_parent_live(%L)',
      tbl || '_parent_live', rel, parent);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW EXECUTE FUNCTION app.cascade_trash(%L)',
      parent || '_cascade_' || tbl, parent, tbl);
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.grant_record_table(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.attach_record_table(text, text) FROM PUBLIC;