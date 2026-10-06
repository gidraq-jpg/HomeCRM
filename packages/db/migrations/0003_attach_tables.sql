-- Защита таблиц: FORCE ROW LEVEL SECURITY, права ролей и триггеры; drizzle-kit этого не создаёт.
--
-- FORCE: политики действуют и на владельца таблиц homecrm_owner. Политик для него нет,
-- поэтому он не видит ни одной строки. Если миграции понадобится переписать данные,
-- она снимает FORCE с таблицы и возвращает его в той же транзакции.
--
-- Четыре роли видят таблицы по-разному:
--   homecrm_app    — приложение: данные семьи в пределах политик; пароли, секреты, сессии и счётчики
--                    ему не выданы вовсе; удаления нет — оно через корзину (UPDATE deleted_at);
--   homecrm_worker — обработчик: очистка корзины, передача записей ушедшего администратору;
--   homecrm_auth   — служба входа (Better Auth, приглашения, сброс пароля): таблицы входа и состав
--                    домов, но ни одной таблицы данных семьи;
--   владелец       — как и везде, FORCE оставляет его без строк.
-- Права на отдельные колонки (accepted_at, completed_at, left_at, ...) не дают менять в строке
-- ничего лишнего, даже если политика разрешает UPDATE.

-- Записи пользователя: по вызову на таблицу (ничего не забывается; см. records.ts).
SELECT app.attach_record_table('notes');
--> statement-breakpoint
SELECT app.attach_record_table('note_items', 'notes');
--> statement-breakpoint
SELECT app.attach_record_table('shopping_items');
--> statement-breakpoint
SELECT app.attach_record_table('tasks');
--> statement-breakpoint

-- Учётные записи, дома, участники.
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE space_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON accounts, spaces, space_members TO homecrm_app;
--> statement-breakpoint
-- Служба входа: учётные записи, дома и их состав. Удалять учётные записи, дома и участников ей нельзя;
-- участника она только отпускает из дома (left_at, left_by).
GRANT SELECT, INSERT, UPDATE ON accounts TO homecrm_auth;
--> statement-breakpoint
GRANT SELECT, INSERT ON spaces, space_members TO homecrm_auth;
--> statement-breakpoint
GRANT UPDATE (left_at, left_by) ON space_members TO homecrm_auth;
--> statement-breakpoint
-- Обработчик ищет по составу дома администратора, которому передать записи ушедшего.
GRANT SELECT (space_id, account_id, role, created_at, left_at) ON space_members TO homecrm_worker;
--> statement-breakpoint
-- SPACE-1: у учётной записи при фиксации транзакции есть личное пространство.
CREATE CONSTRAINT TRIGGER accounts_personal_space AFTER INSERT ON accounts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.require_personal_space();
--> statement-breakpoint
CREATE TRIGGER space_members_guard BEFORE UPDATE ON space_members
  FOR EACH ROW EXECUTE FUNCTION app.guard_member_leave();
--> statement-breakpoint

-- Таблицы входа (ADR-0005).
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credentials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE two_factors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE login_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE login_locks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, verifications, two_factors, rate_limits, login_locks TO homecrm_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON credentials TO homecrm_auth;
--> statement-breakpoint
GRANT SELECT ON invitations TO homecrm_auth;
--> statement-breakpoint
GRANT UPDATE (accepted_at, accepted_by) ON invitations TO homecrm_auth;
--> statement-breakpoint
GRANT INSERT ON login_events TO homecrm_auth;
--> statement-breakpoint
GRANT SELECT, INSERT ON password_resets TO homecrm_auth;
--> statement-breakpoint
GRANT UPDATE (completed_at) ON password_resets TO homecrm_auth;
--> statement-breakpoint
-- Приложение: приглашения дома (создать, прочитать, отозвать), свой журнал входов, своя отметка о сбросе.
GRANT SELECT, INSERT ON invitations TO homecrm_app;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON invitations TO homecrm_app;
--> statement-breakpoint
GRANT SELECT ON login_events TO homecrm_app;
--> statement-breakpoint
GRANT SELECT ON password_resets TO homecrm_app;
--> statement-breakpoint
GRANT UPDATE (acknowledged_at) ON password_resets TO homecrm_app;
