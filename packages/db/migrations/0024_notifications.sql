ALTER TABLE "sessions" ADD CONSTRAINT "sessions_id_user_key" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '08:00' NOT NULL,
	"daily_budget" integer DEFAULT 5 NOT NULL,
	"enabled_kinds" jsonb DEFAULT '["deadline"]'::jsonb NOT NULL,
	"hide_text" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_settings_budget" CHECK (daily_budget BETWEEN 0 AND 100),
	CONSTRAINT "notification_settings_clock" CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_settings_kinds" CHECK (enabled_kinds <@ '["deadline"]'::jsonb AND jsonb_typeof(enabled_kinds) = 'array')
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text DEFAULT 'deadline' NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"error_code" integer
);
--> statement-breakpoint
ALTER TABLE "push_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"notification_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_at" timestamp with time zone,
	"budget_date" date,
	CONSTRAINT "push_deliveries_once" UNIQUE("notification_id","device_id"),
	CONSTRAINT "push_deliveries_status" CHECK (status IN ('pending','sending','sent','cancelled','summary','gone'))
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_session_key" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_deadline_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."deadline_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_owner_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_attempts_recent" ON "push_attempts" USING btree ("account_id","attempted_at");--> statement-breakpoint
CREATE INDEX "push_deliveries_due" ON "push_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint

CREATE POLICY "notification_settings_own_select" ON "notification_settings" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "notification_settings_own_insert" ON "notification_settings" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "notification_settings_own_update" ON "notification_settings" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id()) WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "notification_settings_worker_select" ON "notification_settings" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_attempts_own_select" ON "push_attempts" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "push_attempts_worker_select" ON "push_attempts" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_attempts_worker_insert" ON "push_attempts" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "push_attempts_worker_delete" ON "push_attempts" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (attempted_at < now() - interval '90 days');--> statement-breakpoint
CREATE POLICY "push_deliveries_worker_select" ON "push_deliveries" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_deliveries_worker_insert" ON "push_deliveries" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "push_deliveries_worker_update" ON "push_deliveries" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "push_deliveries_worker_delete" ON "push_deliveries" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_subscriptions_own_select" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "push_subscriptions_own_insert" ON "push_subscriptions" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "push_subscriptions_own_update" ON "push_subscriptions" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id()) WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "push_subscriptions_own_delete" ON "push_subscriptions" AS PERMISSIVE FOR DELETE TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "push_subscriptions_worker_select" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_subscriptions_worker_update" ON "push_subscriptions" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "push_subscriptions_worker_delete" ON "push_subscriptions" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "push_subscriptions_leave" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO "homecrm_owner" USING (pg_trigger_depth() > 0) WITH CHECK (pg_trigger_depth() > 0);