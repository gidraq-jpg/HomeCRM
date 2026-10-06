-- Первая миграция рабочей схемы (R0.1). Миграции проверок 0.4 и 0.3 (0000–0005) заменены этим набором:
-- рабочей базы с данными семьи до R0.1 не было, а схема изменилась так, что наращивать её поверх
-- значило бы возиться с данными, которых нет. Если база создана старыми миграциями, дальше идти нельзя:
-- drizzle сравнивает время миграций и применил бы новые поверх старых таблиц, споткнувшись на середине.
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NOT NULL OR to_regnamespace('app') IS NOT NULL THEN
    RAISE EXCEPTION 'The database was created by pre-R0.1 migrations. Recreate it (docs/runbook.md, section 5)'
      USING ERRCODE = 'invalid_schema_definition';
  END IF;
END $$;
--> statement-breakpoint
-- Контекст запроса (ADR-0004). withAccount в начале каждой транзакции вызывает
-- set_config('app.account_id', <id>, true), а политики RLS читают его через app.current_account_id().
--
-- nullif нужен потому, что после конца транзакции параметр на том же соединении не исчезает,
-- а становится пустой строкой: без nullif приведение ''::uuid дало бы ошибку вместо NULL.
-- Тело в стандартной форме SQL (RETURN …) разбирается при создании и не зависит от search_path.
CREATE SCHEMA app;
--> statement-breakpoint
CREATE FUNCTION app.current_account_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN nullif(current_setting('app.account_id', true), '')::uuid;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO homecrm_app, homecrm_worker;
