-- Таблицы входа (ADR-0005): FORCE ROW LEVEL SECURITY и права ролей; drizzle-kit этого не создаёт.
--
-- Три роли видят таблицы входа по-разному:
--   homecrm_auth — служба входа (Better Auth, приглашения, сброс пароля): таблицы входа и состав
--                  домов, но ни одной таблицы данных семьи;
--   homecrm_app  — приложение: только своё — журнал входов и отметка о сбросе, приглашения своего
--                  дома; пароли, секреты, сессии и счётчики ему не выданы вовсе;
--   владелец     — как и везде, FORCE оставляет его без строк.
-- Права на отдельные колонки (accepted_at, completed_at, ...) не дают менять в строке ничего
-- лишнего, даже если политика разрешает UPDATE.
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
-- Служба входа: учётные записи, дома и их состав. Удалять учётные записи, дома и участников ей нельзя.
GRANT SELECT, INSERT, UPDATE ON accounts TO homecrm_auth;
--> statement-breakpoint
GRANT SELECT, INSERT ON spaces, space_members TO homecrm_auth;
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
