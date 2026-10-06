CREATE TABLE "household_access" (
	"space_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	CONSTRAINT "household_access_space_id_account_id_pk" PRIMARY KEY("space_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "household_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"photo_file_id" uuid,
	"birth_date" date,
	"phone" text
);
--> statement-breakpoint
ALTER TABLE "member_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_access" ADD CONSTRAINT "household_access_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_access" ADD CONSTRAINT "household_access_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_items_history" ADD CONSTRAINT "note_items_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL));--> statement-breakpoint
ALTER TABLE "notes_history" ADD CONSTRAINT "notes_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL));--> statement-breakpoint
ALTER TABLE "shopping_items_history" ADD CONSTRAINT "shopping_items_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL));--> statement-breakpoint
ALTER TABLE "tasks_history" ADD CONSTRAINT "tasks_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL));--> statement-breakpoint
CREATE POLICY "space_members_admin_update" ON "space_members" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (left_at IS NULL AND space_id IN (
  SELECT space_id FROM household_access WHERE account_id = app.current_account_id() AND role = 'admin'
)) WITH CHECK (space_id IN (
        SELECT space_id FROM household_access
        WHERE account_id = app.current_account_id() AND role = 'admin'
      ));--> statement-breakpoint
CREATE POLICY "space_members_self_leave" ON "space_members" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id() AND left_at IS NULL) WITH CHECK (account_id = app.current_account_id() AND left_at IS NOT NULL AND left_by = app.current_account_id());--> statement-breakpoint
CREATE POLICY "household_access_select" ON "household_access" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "household_access_sync" ON "household_access" AS PERMISSIVE FOR ALL TO "homecrm_owner" USING (pg_trigger_depth() = 1) WITH CHECK (pg_trigger_depth() = 1);--> statement-breakpoint
CREATE POLICY "member_profiles_select" ON "member_profiles" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id = app.current_account_id() OR EXISTS (
  SELECT 1 FROM space_members m WHERE m.account_id = member_profiles.account_id
    AND m.space_id IN (SELECT space_id FROM household_access WHERE account_id = app.current_account_id())
));--> statement-breakpoint
CREATE POLICY "member_profiles_update" ON "member_profiles" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (account_id = app.current_account_id()) WITH CHECK (account_id = app.current_account_id());--> statement-breakpoint
CREATE POLICY "member_profiles_initialize" ON "member_profiles" AS PERMISSIVE FOR INSERT TO "homecrm_owner" WITH CHECK (pg_trigger_depth() = 1);--> statement-breakpoint
ALTER POLICY "password_resets_ack" ON "password_resets" TO homecrm_app USING (account_id = app.current_account_id() AND completed_at <= now() - interval '7 days') WITH CHECK (account_id = app.current_account_id() AND completed_at <= now() - interval '7 days');--> statement-breakpoint
ALTER POLICY "space_members_select" ON "space_members" TO homecrm_app USING (account_id = app.current_account_id() OR space_id IN (SELECT space_id FROM household_access WHERE account_id = app.current_account_id()));
--> statement-breakpoint

-- Миграция выполняется одной транзакцией. Временное снятие FORCE нужно только для заполнения
-- производных таблиц существующими строками; перед завершением FORCE возвращается.
ALTER TABLE space_members NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

INSERT INTO household_access(space_id, account_id, role)
SELECT space_id, account_id, role FROM space_members WHERE left_at IS NULL;

--> statement-breakpoint

ALTER TABLE space_members FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

INSERT INTO member_profiles(account_id, display_name) SELECT id, display_name FROM accounts;

--> statement-breakpoint

ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE household_access FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE member_profiles FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE FUNCTION app.sync_household_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'space_members'
    OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'invalid synchronization context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.household_access WHERE space_id = NEW.space_id AND account_id = NEW.account_id;
  IF NEW.left_at IS NULL THEN
    INSERT INTO public.household_access(space_id, account_id, role)
    VALUES (NEW.space_id, NEW.account_id, NEW.role);
  END IF;
  RETURN NULL;
END;
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app.sync_household_access() FROM PUBLIC;

--> statement-breakpoint

CREATE TRIGGER space_members_sync_access AFTER INSERT OR UPDATE ON space_members
FOR EACH ROW EXECUTE FUNCTION app.sync_household_access();

--> statement-breakpoint

CREATE FUNCTION app.initialize_member_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'accounts' OR TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'invalid profile initialization context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.member_profiles(account_id, display_name) VALUES (NEW.id, NEW.display_name);
  RETURN NULL;
END;
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app.initialize_member_profile() FROM PUBLIC;

--> statement-breakpoint

CREATE TRIGGER accounts_initialize_profile AFTER INSERT ON accounts
FOR EACH ROW EXECUTE FUNCTION app.initialize_member_profile();

--> statement-breakpoint

GRANT SELECT ON household_access, member_profiles TO homecrm_app;

--> statement-breakpoint

GRANT UPDATE(display_name, photo_file_id, birth_date, phone) ON member_profiles TO homecrm_app;

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

GRANT UPDATE(role, left_at, left_by) ON space_members TO homecrm_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text'];
BEGIN
  NEW.has_other_contributions := OLD.has_other_contributions OR
    (pg_trigger_depth() > 1 AND NEW.has_other_contributions);
  IF app.current_account_id() IS NOT NULL AND
    (NEW.space_id IS DISTINCT FROM OLD.space_id OR NEW.space_kind IS DISTINCT FROM OLD.space_kind) THEN
    IF TG_ARGV[0] = 'root' OR (to_jsonb(NEW)->>'parent_id') IS DISTINCT FROM (to_jsonb(OLD)->>'parent_id') THEN
      IF OLD.space_kind = 'personal' AND NEW.space_kind = 'household' THEN
        IF NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = OLD.space_id AND s.owner_account_id = app.current_account_id()) THEN
          RAISE EXCEPTION 'only the owner can share a record' USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSIF OLD.space_kind = 'household' AND NEW.space_kind = 'personal' THEN
        IF OLD.author_id IS DISTINCT FROM app.current_account_id() OR OLD.has_other_contributions
          OR NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = NEW.space_id AND s.owner_account_id = app.current_account_id()) THEN
          RAISE EXCEPTION 'a record with other contributions cannot become personal' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'notes' AND EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSE
        RAISE EXCEPTION 'use a copy to change households or personal owners' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  IF app.current_account_id() IS NOT NULL AND app.current_account_id() <> OLD.author_id AND
    (OLD.space_kind = 'household' OR NEW.space_kind = 'household') AND
    (
      (TG_TABLE_NAME = 'notes' AND (NEW.title, to_jsonb(NEW)->>'body') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'body'))
      OR (TG_TABLE_NAME = 'note_items' AND
        (NEW.title, to_jsonb(NEW)->>'done', to_jsonb(NEW)->>'position', to_jsonb(NEW)->>'parent_id') IS DISTINCT FROM
        (OLD.title, to_jsonb(OLD)->>'done', to_jsonb(OLD)->>'position', to_jsonb(OLD)->>'parent_id'))
      OR (TG_TABLE_NAME NOT IN ('notes', 'note_items') AND (to_jsonb(NEW) - array_remove(ignored, 'deleted_at')) IS DISTINCT FROM (to_jsonb(OLD) - array_remove(ignored, 'deleted_at')))
    ) THEN
    NEW.has_other_contributions := true;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'id, author_id and created_at of a record cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    IF TG_ARGV[0] = 'child' AND NEW.deleted_at IS NULL AND OLD.space_kind = 'household' AND app.current_account_id() IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = OLD.space_id
        AND m.account_id = app.current_account_id() AND m.left_at IS NULL
        AND (m.role = 'admin' OR (m.role = 'adult' AND OLD.author_id = app.current_account_id()))) THEN
      RAISE EXCEPTION 'only the author or an administrator can restore a shared record'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_ARGV[0] = 'child' THEN
      ignored := ignored || ARRAY['space_id', 'space_kind', 'audience'];
      IF (NEW.space_id, NEW.space_kind, NEW.audience) IS DISTINCT FROM (OLD.space_id, OLD.space_kind, OLD.audience) THEN
        ignored := ignored || ARRAY['assignee_id'];
      END IF;
    END IF;
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'a record in the trash cannot be changed or moved; restore it first'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Чужой вклад в пункт остаётся вкладом в заметку даже после корзины или смены родителя.
-- Блокировка родителя сериализует изменение пункта с «Сделать личной».
CREATE OR REPLACE FUNCTION app.lock_note_parent() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  parents uuid[];
  parent_row public.notes;
  changed boolean := true;
BEGIN
  -- Обработчик меняет только assignee_id: прав на текст и SELECT всей строки родителя нет.
  -- Это не вклад и не перенос пункта; RLS передачи ответственности остаётся обязательной.
  IF current_user = 'homecrm_worker' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    parents := ARRAY[OLD.parent_id, NEW.parent_id];
    changed := (NEW.title, NEW.done, NEW.position, NEW.parent_id)
      IS DISTINCT FROM (OLD.title, OLD.done, OLD.position, OLD.parent_id);
  ELSE
    parents := ARRAY[NEW.parent_id];
  END IF;
  FOR parent_row IN SELECT n.* FROM public.notes n WHERE n.id = ANY(parents) ORDER BY n.id FOR UPDATE LOOP
    IF changed AND parent_row.space_kind = 'household' AND app.current_account_id() IS NOT NULL
      AND parent_row.author_id <> app.current_account_id() THEN
      UPDATE public.notes SET has_other_contributions = true WHERE id = parent_row.id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER TABLE notes NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE note_items NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notes_history NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE note_items_history NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE notes DISABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE note_items DISABLE TRIGGER USER;
--> statement-breakpoint
UPDATE note_items i SET has_other_contributions = EXISTS (
  SELECT 1 FROM note_items_history h WHERE h.record_id = i.id AND h.actor_id <> i.author_id
    AND h.changes ?| ARRAY['title', 'done', 'position', 'parent_id']
);
--> statement-breakpoint
UPDATE notes n SET has_other_contributions = EXISTS (
  SELECT 1 FROM notes_history h WHERE h.record_id = n.id AND h.actor_id <> n.author_id
    AND h.changes ?| ARRAY['title', 'body']
) OR EXISTS (
  SELECT 1 FROM note_items i WHERE i.parent_id = n.id AND (i.author_id <> n.author_id OR i.has_other_contributions)
) OR EXISTS (
  SELECT 1 FROM note_items_history h JOIN note_items i ON i.id = h.record_id
  WHERE (h.actor_id <> n.author_id OR (h.operation = 'create' AND i.author_id <> n.author_id))
    AND h.changes ?| ARRAY['title', 'done', 'position', 'parent_id']
    AND (h.changes->'parent_id'->>'old' = n.id::text OR coalesce(
      (SELECT previous.changes->'parent_id'->>'new' FROM note_items_history previous
       WHERE previous.record_id = h.record_id AND previous.changes ? 'parent_id'
         AND (previous.created_at, previous.id) <= (h.created_at, h.id)
       ORDER BY previous.created_at DESC, previous.id DESC LIMIT 1),
      (SELECT following.changes->'parent_id'->>'old' FROM note_items_history following
       WHERE following.record_id = h.record_id AND following.changes ? 'parent_id'
         AND (following.created_at, following.id) > (h.created_at, h.id)
       ORDER BY following.created_at, following.id LIMIT 1),
      i.parent_id::text
    ) = n.id::text)
);
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE notes ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE note_items ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE note_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notes_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE note_items_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
