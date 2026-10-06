-- Таблицы входа (ADR-0005). Колонка accounts.email обязательна, поэтому миграция рассчитана на пустую
-- таблицу accounts: данных семьи в базе ещё нет (проверка 0.3, до R0.1).
CREATE TYPE "public"."login_kind" AS ENUM('sign_in', 'second_factor', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."login_outcome" AS ENUM('success', 'failure', 'locked', 'second_factor_required');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"space_kind" "space_kind" DEFAULT 'household' NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '72 hours' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invitations_household_only" CHECK (space_kind = 'household'),
	CONSTRAINT "invitations_ttl" CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours'),
	CONSTRAINT "invitations_accepted_pair" CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "login_kind" NOT NULL,
	"outcome" "login_outcome" NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "login_locks" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "password_resets_not_self" CHECK (account_id <> requested_by)
);
--> statement-breakpoint
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_key" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factors_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_accounts_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_household_fk" FOREIGN KEY ("household_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_locks" ADD CONSTRAINT "login_locks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_user_id_idx" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_one_password_idx" ON "credentials" USING btree ("user_id") WHERE provider_id = 'credential';--> statement-breakpoint
CREATE INDEX "invitations_household_id_idx" ON "invitations" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "login_events_account_id_created_at_idx" ON "login_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "password_resets_account_id_idx" ON "password_resets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_email_key" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_username_key" UNIQUE("username");--> statement-breakpoint
CREATE POLICY "accounts_auth_select" ON "accounts" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "accounts_auth_insert" ON "accounts" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "accounts_auth_update" ON "accounts" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "space_members_auth_select" ON "space_members" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "space_members_auth_insert" ON "space_members" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "spaces_auth_select" ON "spaces" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "spaces_auth_insert" ON "spaces" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "credentials_auth_select" ON "credentials" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "credentials_auth_insert" ON "credentials" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "credentials_auth_update" ON "credentials" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "invitations_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.role IN ('admin')));--> statement-breakpoint
CREATE POLICY "invitations_insert" ON "invitations" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.role IN ('admin')) AND created_by = app.current_account_id() AND accepted_at IS NULL AND revoked_at IS NULL);--> statement-breakpoint
CREATE POLICY "invitations_revoke" ON "invitations" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.role IN ('admin')) AND accepted_at IS NULL) WITH CHECK (household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.role IN ('admin')) AND accepted_at IS NULL);--> statement-breakpoint
CREATE POLICY "invitations_auth_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "invitations_auth_accept" ON "invitations" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) WITH CHECK (accepted_at IS NOT NULL);--> statement-breakpoint
CREATE POLICY "login_events_select" ON "login_events" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "login_events_auth_insert" ON "login_events" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "login_locks_auth_select" ON "login_locks" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "login_locks_auth_insert" ON "login_locks" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "login_locks_auth_update" ON "login_locks" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "login_locks_auth_delete" ON "login_locks" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "password_resets_select" ON "password_resets" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "password_resets_ack" ON "password_resets" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id() AND completed_at IS NOT NULL) WITH CHECK (account_id = app.current_account_id() AND completed_at IS NOT NULL);--> statement-breakpoint
CREATE POLICY "password_resets_auth_select" ON "password_resets" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "password_resets_auth_insert" ON "password_resets" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK ((
    password_resets.requested_by <> password_resets.account_id
    AND EXISTS (
      SELECT 1 FROM space_members admin_m
      JOIN space_members child_m ON child_m.space_id = admin_m.space_id
      WHERE admin_m.account_id = password_resets.requested_by AND admin_m.role = 'admin'
        AND child_m.account_id = password_resets.account_id AND child_m.role = 'child'
    )
    AND NOT EXISTS (
      SELECT 1 FROM space_members other
      WHERE other.account_id = password_resets.account_id AND other.role <> 'child'
    )
  ));--> statement-breakpoint
CREATE POLICY "password_resets_auth_complete" ON "password_resets" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (completed_at IS NULL) WITH CHECK (completed_at IS NOT NULL);--> statement-breakpoint
CREATE POLICY "rate_limits_auth_select" ON "rate_limits" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "rate_limits_auth_insert" ON "rate_limits" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "rate_limits_auth_update" ON "rate_limits" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "rate_limits_auth_delete" ON "rate_limits" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_select" ON "sessions" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_insert" ON "sessions" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_update" ON "sessions" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_delete" ON "sessions" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "two_factors_auth_select" ON "two_factors" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "two_factors_auth_insert" ON "two_factors" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "two_factors_auth_update" ON "two_factors" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "two_factors_auth_delete" ON "two_factors" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "verifications_auth_select" ON "verifications" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "verifications_auth_insert" ON "verifications" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "verifications_auth_update" ON "verifications" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "verifications_auth_delete" ON "verifications" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);