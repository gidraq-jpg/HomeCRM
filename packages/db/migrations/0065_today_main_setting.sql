ALTER TABLE notification_settings ADD COLUMN today_main_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
GRANT UPDATE(today_main_enabled) ON notification_settings TO homecrm_app;
