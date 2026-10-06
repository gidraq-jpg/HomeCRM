ALTER TABLE "space_members" ADD COLUMN "display_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE POLICY "space_members_profile_name" ON "space_members" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id() AND pg_trigger_depth() = 1) WITH CHECK (account_id = app.current_account_id() AND pg_trigger_depth() = 1);--> statement-breakpoint
ALTER POLICY "member_profiles_select" ON "member_profiles" TO homecrm_app USING (account_id = app.current_account_id() OR EXISTS (
  SELECT 1 FROM space_members m WHERE m.account_id = member_profiles.account_id AND m.left_at IS NULL
    AND m.space_id IN (SELECT space_id FROM household_access WHERE account_id = app.current_account_id())
));
--> statement-breakpoint
ALTER TABLE space_members NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE member_profiles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE space_members m SET display_name = p.display_name FROM member_profiles p WHERE p.account_id = m.account_id;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE space_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE member_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
--> statement-breakpoint
CREATE FUNCTION app.member_name_default() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  SELECT a.display_name INTO NEW.display_name FROM public.accounts a WHERE a.id = NEW.account_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.member_name_default() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER space_members_name_default BEFORE INSERT ON space_members
FOR EACH ROW EXECUTE FUNCTION app.member_name_default();
--> statement-breakpoint
CREATE FUNCTION app.sync_member_profile_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.space_members SET display_name = NEW.display_name WHERE account_id = NEW.account_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.sync_member_profile_name() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER member_profiles_sync_name AFTER UPDATE OF display_name ON member_profiles
FOR EACH ROW EXECUTE FUNCTION app.sync_member_profile_name();
--> statement-breakpoint
GRANT UPDATE(display_name) ON space_members TO homecrm_app;

--> statement-breakpoint
-- Блокировка дома сериализует уход и понижение: два администратора не могут одновременно
-- увидеть друг друга и оставить дом без администратора. Проверки выполняются после блокировки.
CREATE OR REPLACE FUNCTION app.guard_member_leave() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor uuid;
  actor_is_admin boolean;
BEGIN
  IF current_user = 'homecrm_app' THEN
    actor := app.current_account_id();
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.space_id::text, 0));
  IF (NEW.space_id, NEW.space_kind, NEW.account_id, NEW.created_at)
    IS DISTINCT FROM (OLD.space_id, OLD.space_kind, OLD.account_id, OLD.created_at) THEN
    RAISE EXCEPTION 'membership identity cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.left_at IS NOT NULL AND (NEW.role, NEW.left_at, NEW.left_by)
    IS DISTINCT FROM (OLD.role, OLD.left_at, OLD.left_by) THEN
    RAISE EXCEPTION 'a membership that has ended cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF actor IS NOT NULL THEN
    IF NEW.display_name IS DISTINCT FROM OLD.display_name AND (
      NEW.account_id <> actor OR pg_trigger_depth() <> 2 OR NOT EXISTS (
        SELECT 1 FROM public.member_profiles p WHERE p.account_id = actor AND p.display_name = NEW.display_name
      )) THEN
      RAISE EXCEPTION 'membership name changes only through the owner profile' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.household_access a
      WHERE a.space_id = OLD.space_id AND a.account_id = actor AND a.role = 'admin')
      INTO actor_is_admin;
    IF NEW.left_at IS DISTINCT FROM OLD.left_at OR NEW.left_by IS DISTINCT FROM OLD.left_by THEN
      IF NEW.left_at IS NULL OR NEW.left_by IS DISTINCT FROM actor OR NEW.role <> OLD.role
        OR (actor <> OLD.account_id AND NOT actor_is_admin) THEN
        RAISE EXCEPTION 'membership departure is not allowed' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NEW.role <> OLD.role AND NOT actor_is_admin THEN
      RAISE EXCEPTION 'only an administrator can change a role' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF OLD.role = 'admin' AND OLD.left_at IS NULL
    AND (NEW.left_at IS NOT NULL OR NEW.role <> 'admin')
    AND NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = OLD.space_id
      AND m.account_id <> OLD.account_id AND m.role = 'admin' AND m.left_at IS NULL) THEN
    RAISE EXCEPTION 'the last administrator cannot leave the household or give up the role'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER space_members_sync_access ON space_members;
--> statement-breakpoint
CREATE TRIGGER space_members_sync_access AFTER INSERT OR UPDATE OF role, left_at, left_by ON space_members
FOR EACH ROW EXECUTE FUNCTION app.sync_household_access();
