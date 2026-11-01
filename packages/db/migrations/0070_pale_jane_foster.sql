CREATE TABLE "chat_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"redirects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"redirect" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"kind" text,
	CONSTRAINT "chat_events_action" CHECK (action IN ('find_objects','find_people','list_meters','create_drafts'))
);
--> statement-breakpoint
ALTER TABLE "chat_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"minute" integer DEFAULT 0 NOT NULL,
	"minute_count" integer DEFAULT 0 NOT NULL,
	"day" integer DEFAULT 0 NOT NULL,
	"day_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chat_grants_access_hash_unique" UNIQUE("access_hash"),
	CONSTRAINT "chat_grants_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
ALTER TABLE "chat_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_source";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "chat_draft" jsonb;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "chat_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_codes" ADD CONSTRAINT "chat_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_codes" ADD CONSTRAINT "chat_codes_house_id_spaces_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_codes" ADD CONSTRAINT "chat_codes_client_id_chat_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."chat_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD CONSTRAINT "chat_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD CONSTRAINT "chat_grants_house_id_spaces_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD CONSTRAINT "chat_grants_client_id_chat_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."chat_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_source" CHECK (source IN ('photo','file','text','voice','chat'));--> statement-breakpoint
CREATE POLICY "chat_clients_auth_select" ON "chat_clients" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_clients_auth_insert" ON "chat_clients" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "chat_clients_auth_delete" ON "chat_clients" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_codes_auth_select" ON "chat_codes" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_codes_auth_insert" ON "chat_codes" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "chat_codes_auth_delete" ON "chat_codes" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_events_own_select" ON "chat_events" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "chat_events_own_insert" ON "chat_events" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "chat_grants_auth_select" ON "chat_grants" AS PERMISSIVE FOR SELECT TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_grants_auth_insert" ON "chat_grants" AS PERMISSIVE FOR INSERT TO "homecrm_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "chat_grants_auth_update" ON "chat_grants" AS PERMISSIVE FOR UPDATE TO "homecrm_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "chat_grants_auth_delete" ON "chat_grants" AS PERMISSIVE FOR DELETE TO "homecrm_auth" USING (true);--> statement-breakpoint
CREATE POLICY "chat_grants_own_select" ON "chat_grants" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "chat_grants_own_delete" ON "chat_grants" AS PERMISSIVE FOR DELETE TO "homecrm_app" USING (account_id=app.current_account_id());
--> statement-breakpoint
ALTER TABLE chat_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_events FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON chat_clients,chat_codes TO homecrm_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON chat_grants TO homecrm_auth;
GRANT SELECT,DELETE ON chat_grants TO homecrm_app;
GRANT SELECT,INSERT ON chat_events TO homecrm_app;
GRANT UPDATE(chat_enabled) ON spaces TO homecrm_app;
GRANT UPDATE(chat_draft) ON inbox_items TO homecrm_app;
GRANT UPDATE ON chat_codes TO homecrm_auth;
--> statement-breakpoint
CREATE FUNCTION app.revoke_chat_password() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    DELETE FROM chat_grants WHERE account_id=NEW.user_id;
    DELETE FROM chat_codes WHERE account_id=NEW.user_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.revoke_chat_password() FROM PUBLIC;
CREATE TRIGGER credentials_revoke_chat AFTER UPDATE OF password ON credentials FOR EACH ROW EXECUTE FUNCTION app.revoke_chat_password();
