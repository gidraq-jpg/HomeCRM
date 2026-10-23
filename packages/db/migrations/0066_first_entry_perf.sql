ALTER TABLE notification_settings ADD COLUMN first_entry_shown boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Владелец миграции заполняет прежних участников в той же транзакции.
ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_settings NO FORCE ROW LEVEL SECURITY;
INSERT INTO notification_settings(account_id, first_entry_shown)
SELECT id, true FROM accounts
ON CONFLICT(account_id) DO UPDATE SET first_entry_shown=true;
ALTER TABLE notification_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT UPDATE(first_entry_shown) ON notification_settings TO homecrm_app;
