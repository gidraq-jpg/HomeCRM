-- Права ролей и FORCE ROW LEVEL SECURITY (ADR-0004): drizzle-kit этого не создаёт.
--
-- FORCE: политики действуют и на владельца таблиц homecrm_owner. Политик для него нет,
-- поэтому он не видит ни одной строки. Если миграции понадобится переписать данные,
-- она снимает FORCE с таблицы и возвращает его в той же транзакции.
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE space_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shopping_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Приложение: чтение, создание и изменение. Права DELETE нет: удаление — это корзина
-- (UPDATE deleted_at), а окончательно удаляет обработчик.
GRANT SELECT ON accounts, spaces, space_members TO homecrm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notes, shopping_items, tasks TO homecrm_app;
--> statement-breakpoint
-- Обработчик: только очистка корзины; какие строки ему доступны, решают политики *_purge.
GRANT SELECT, DELETE ON notes, shopping_items, tasks TO homecrm_worker;
