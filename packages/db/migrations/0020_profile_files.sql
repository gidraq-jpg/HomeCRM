CREATE TABLE "profile_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	"preview_storage_key" uuid,
	"preview_envelope" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profile_files" ADD CONSTRAINT "profile_files_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_files_account_idx" ON "profile_files" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "profile_files_select" ON "profile_files" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id() OR (deleted_at IS NULL AND EXISTS (SELECT 1 FROM member_profiles p WHERE p.account_id = profile_files.account_id AND p.photo_file_id = profile_files.id)));--> statement-breakpoint
CREATE POLICY "profile_files_insert" ON "profile_files" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id = app.current_account_id() AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY "profile_files_update" ON "profile_files" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id()) WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "profile_files_purge_select" ON "profile_files" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "profile_files_purge" ON "profile_files" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');