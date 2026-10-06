CREATE TABLE "login_name_attempts" (
	"name_hash" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_name_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitations_worker_cleanup_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (COALESCE(accepted_at, revoked_at, expires_at) < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "invitations_worker_cleanup" ON "invitations" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (COALESCE(accepted_at, revoked_at, expires_at) < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "login_events_worker_cleanup_select" ON "login_events" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (created_at < now() - interval '180 days');--> statement-breakpoint
CREATE POLICY "login_events_worker_cleanup" ON "login_events" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (created_at < now() - interval '180 days');--> statement-breakpoint
CREATE POLICY "login_locks_worker_cleanup_select" ON "login_locks" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((locked_until IS NULL OR locked_until < now()) AND window_started_at < now() - interval '1 hour');--> statement-breakpoint
CREATE POLICY "login_locks_worker_cleanup" ON "login_locks" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING ((locked_until IS NULL OR locked_until < now()) AND window_started_at < now() - interval '1 hour');--> statement-breakpoint
CREATE POLICY "password_resets_worker_cleanup_select" ON "password_resets" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((acknowledged_at < now() - interval '30 days') OR (completed_at IS NULL AND expires_at < now() - interval '30 days'));--> statement-breakpoint
CREATE POLICY "password_resets_worker_cleanup" ON "password_resets" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING ((acknowledged_at < now() - interval '30 days') OR (completed_at IS NULL AND expires_at < now() - interval '30 days'));--> statement-breakpoint
CREATE POLICY "rate_limits_worker_cleanup_select" ON "rate_limits" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (last_request < (extract(epoch from now()) * 1000)::bigint - 86400000);--> statement-breakpoint
CREATE POLICY "rate_limits_worker_cleanup" ON "rate_limits" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (last_request < (extract(epoch from now()) * 1000)::bigint - 86400000);--> statement-breakpoint
CREATE POLICY "sessions_worker_cleanup_select" ON "sessions" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (expires_at < now());--> statement-breakpoint
CREATE POLICY "sessions_worker_cleanup" ON "sessions" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (expires_at < now());--> statement-breakpoint
CREATE POLICY "verifications_worker_cleanup_select" ON "verifications" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (expires_at < now());--> statement-breakpoint
CREATE POLICY "verifications_worker_cleanup" ON "verifications" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (expires_at < now());--> statement-breakpoint
CREATE POLICY "login_name_attempts_auth_select" ON "login_name_attempts" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "login_name_attempts_auth_insert" ON "login_name_attempts" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "login_name_attempts_auth_update" ON "login_name_attempts" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "login_name_attempts_auth_delete" ON "login_name_attempts" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "login_name_attempts_worker_cleanup_select" ON "login_name_attempts" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((locked_until IS NULL OR locked_until < now()) AND window_started_at < now() - interval '1 hour');--> statement-breakpoint
CREATE POLICY "login_name_attempts_worker_cleanup" ON "login_name_attempts" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING ((locked_until IS NULL OR locked_until < now()) AND window_started_at < now() - interval '1 hour');--> statement-breakpoint
ALTER POLICY "space_members_auth_insert" ON "space_members" TO homecrm_auth WITH CHECK ((space_members.space_kind = 'household' AND (
  EXISTS (SELECT 1 FROM invitations i WHERE i.household_id = space_members.space_id AND i.accepted_by = space_members.account_id AND i.role = space_members.role AND i.accepted_at = now() AND i.revoked_at IS NULL)
  OR (space_members.role = 'admin' AND NOT EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = space_members.space_id))
)));--> statement-breakpoint
ALTER POLICY "spaces_auth_insert" ON "spaces" TO homecrm_auth WITH CHECK ((spaces.kind = 'household' OR (spaces.kind = 'personal' AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = spaces.owner_account_id AND a.created_at = now()))));
--> statement-breakpoint
-- Права и FORCE: drizzle-kit их не создаёт (как в 0003).
ALTER TABLE login_name_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON login_name_attempts TO homecrm_auth;
--> statement-breakpoint
-- Обработчик убирает просроченное (ADR-0005): видит и удаляет только то, что разрешают политики *_worker_cleanup.
GRANT SELECT, DELETE ON sessions, verifications, rate_limits, login_locks, login_name_attempts,
  invitations, login_events, password_resets TO homecrm_worker;
