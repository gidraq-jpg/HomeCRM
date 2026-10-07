ALTER TABLE "deadline_notifications" DROP CONSTRAINT "deadline_notifications_status";--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_status" CHECK (status IN ('pending', 'sent', 'cancelled', 'summary'));--> statement-breakpoint
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE push_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE push_attempts FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON push_subscriptions TO homecrm_app;
GRANT UPDATE(endpoint,p256dh,auth,device_name) ON push_subscriptions TO homecrm_app;
GRANT SELECT, INSERT ON notification_settings TO homecrm_app;
GRANT UPDATE(quiet_start,quiet_end,daily_budget,enabled_kinds,hide_text) ON notification_settings TO homecrm_app;
GRANT SELECT ON push_attempts TO homecrm_app;
GRANT SELECT, DELETE ON push_subscriptions TO homecrm_worker;
GRANT UPDATE(last_success_at) ON push_subscriptions TO homecrm_worker;
GRANT SELECT ON notification_settings TO homecrm_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_deliveries TO homecrm_worker;
GRANT SELECT, INSERT, DELETE ON push_attempts TO homecrm_worker;
GRANT SELECT(audience) ON notes,objects TO homecrm_worker;
--> statement-breakpoint
-- Узкий триггер: владелец не получает прямого доступа вне стека триггера.
CREATE FUNCTION app.remove_member_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL THEN
  DELETE FROM public.push_subscriptions WHERE account_id=NEW.account_id;
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.remove_member_push() FROM PUBLIC;
CREATE TRIGGER space_members_push_cleanup AFTER UPDATE OF left_at ON space_members
FOR EACH ROW EXECUTE FUNCTION app.remove_member_push();
