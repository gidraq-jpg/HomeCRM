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
