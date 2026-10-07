CREATE TYPE "public"."object_type" AS ENUM('property', 'car', 'appliance', 'other');--> statement-breakpoint
CREATE TABLE "object_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"has_other_contributions" boolean DEFAULT false NOT NULL,
	"assignee_house_id" uuid GENERATED ALWAYS AS (CASE WHEN space_kind = 'household' THEN assignee_id END) STORED,
	"assignee_adult_id" uuid GENERATED ALWAYS AS (CASE WHEN audience = 'adults' THEN assignee_id END) STORED,
	"assignee_adult_flag" boolean GENERATED ALWAYS AS (CASE WHEN audience = 'adults' AND assignee_id IS NOT NULL THEN true END) STORED,
	"parent_id" uuid NOT NULL,
	"occurred_on" date DEFAULT CURRENT_DATE NOT NULL,
	"amount_kopecks" bigint,
	"rating" integer,
	"contact_table" text,
	"contact_id" uuid,
	"origin_space_id" uuid NOT NULL,
	"origin_space_kind" "space_kind" NOT NULL,
	"origin_audience" "audience",
	"search_text" text GENERATED ALWAYS AS (title) STORED,
	CONSTRAINT "object_events_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "object_events_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "object_events_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_events_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "object_events_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_events_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"has_other_contributions" boolean DEFAULT false NOT NULL,
	"assignee_house_id" uuid GENERATED ALWAYS AS (CASE WHEN space_kind = 'household' THEN assignee_id END) STORED,
	"assignee_adult_id" uuid GENERATED ALWAYS AS (CASE WHEN audience = 'adults' THEN assignee_id END) STORED,
	"assignee_adult_flag" boolean GENERATED ALWAYS AS (CASE WHEN audience = 'adults' AND assignee_id IS NOT NULL THEN true END) STORED,
	"parent_id" uuid NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"search_text" text GENERATED ALWAYS AS (title || ' ' || value) STORED,
	CONSTRAINT "object_fields_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "object_fields_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "object_fields_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_fields_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "object_fields_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "object_fields_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"has_other_contributions" boolean DEFAULT false NOT NULL,
	"assignee_house_id" uuid GENERATED ALWAYS AS (CASE WHEN space_kind = 'household' THEN assignee_id END) STORED,
	"assignee_adult_id" uuid GENERATED ALWAYS AS (CASE WHEN audience = 'adults' THEN assignee_id END) STORED,
	"assignee_adult_flag" boolean GENERATED ALWAYS AS (CASE WHEN audience = 'adults' AND assignee_id IS NOT NULL THEN true END) STORED,
	"object_type" "object_type" DEFAULT 'other' NOT NULL,
	"type_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text GENERATED ALWAYS AS (title) STORED,
	CONSTRAINT "objects_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "objects_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "objects_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "objects_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "objects_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "objects_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "record_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"left_table" text NOT NULL,
	"left_id" uuid NOT NULL,
	"right_table" text NOT NULL,
	"right_id" uuid NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "record_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events_history" ADD CONSTRAINT "object_events_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events_history" ADD CONSTRAINT "object_events_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."object_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields" ADD CONSTRAINT "object_fields_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields" ADD CONSTRAINT "object_fields_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields" ADD CONSTRAINT "object_fields_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields" ADD CONSTRAINT "object_fields_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields" ADD CONSTRAINT "object_fields_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields_history" ADD CONSTRAINT "object_fields_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_fields_history" ADD CONSTRAINT "object_fields_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."object_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects_history" ADD CONSTRAINT "objects_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects_history" ADD CONSTRAINT "objects_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_events_space_id_idx" ON "object_events" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "object_events_trash_idx" ON "object_events" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "object_events_parent_id_idx" ON "object_events" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "object_events_history_record_id_idx" ON "object_events_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "object_fields_space_id_idx" ON "object_fields" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "object_fields_trash_idx" ON "object_fields" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "object_fields_parent_id_idx" ON "object_fields" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "object_fields_history_record_id_idx" ON "object_fields_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "objects_space_id_idx" ON "objects" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "objects_trash_idx" ON "objects" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "objects_history_record_id_idx" ON "objects_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "record_links_left_idx" ON "record_links" USING btree ("left_table","left_id");--> statement-breakpoint
CREATE INDEX "record_links_right_idx" ON "record_links" USING btree ("right_table","right_id");--> statement-breakpoint
CREATE POLICY "object_events_select" ON "object_events" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)
  AND (contact_id IS NULL OR app.record_ref_allowed(contact_table, contact_id, false))));--> statement-breakpoint
CREATE POLICY "object_events_insert" ON "object_events" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "object_events_update" ON "object_events" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))));--> statement-breakpoint
CREATE POLICY "object_events_purge_select" ON "object_events" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_events_purge" ON "object_events" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_events_reassign_select" ON "object_events" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((object_events.space_kind = 'household' AND object_events.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_events.space_id AND l.account_id = object_events.assignee_id AND l.left_at IS NOT NULL
  )) OR (object_events.space_kind = 'household' AND object_events.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_events.space_id AND a.account_id = object_events.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "object_events_reassign" ON "object_events" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (object_events.space_kind = 'household' AND object_events.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_events.space_id AND l.account_id = object_events.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_events.space_id AND a.account_id = object_events.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "object_events_history_select" ON "object_events_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM object_events r WHERE r.id = object_events_history.record_id));--> statement-breakpoint
CREATE POLICY "object_events_history_insert" ON "object_events_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "object_events_history_worker_insert" ON "object_events_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "object_fields_select" ON "object_fields" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "object_fields_insert" ON "object_fields" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "object_fields_update" ON "object_fields" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))));--> statement-breakpoint
CREATE POLICY "object_fields_purge_select" ON "object_fields" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_fields_purge" ON "object_fields" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "object_fields_reassign_select" ON "object_fields" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((object_fields.space_kind = 'household' AND object_fields.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_fields.space_id AND l.account_id = object_fields.assignee_id AND l.left_at IS NOT NULL
  )) OR (object_fields.space_kind = 'household' AND object_fields.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_fields.space_id AND a.account_id = object_fields.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "object_fields_reassign" ON "object_fields" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (object_fields.space_kind = 'household' AND object_fields.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = object_fields.space_id AND l.account_id = object_fields.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = object_fields.space_id AND a.account_id = object_fields.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "object_fields_history_select" ON "object_fields_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM object_fields r WHERE r.id = object_fields_history.record_id));--> statement-breakpoint
CREATE POLICY "object_fields_history_insert" ON "object_fields_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "object_fields_history_worker_insert" ON "object_fields_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "objects_select" ON "objects" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "objects_insert" ON "objects" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "objects_update" ON "objects" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal'
    OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin'))
    OR (space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult')) AND author_id = app.current_account_id())
  )))) WITH CHECK ((deleted_at IS NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))) OR (deleted_at IS NOT NULL AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  ))));--> statement-breakpoint
CREATE POLICY "objects_purge_select" ON "objects" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "objects_purge" ON "objects" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "objects_reassign_select" ON "objects" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((objects.space_kind = 'household' AND objects.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = objects.space_id AND l.account_id = objects.assignee_id AND l.left_at IS NOT NULL
  )) OR (objects.space_kind = 'household' AND objects.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = objects.space_id AND a.account_id = objects.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "objects_reassign" ON "objects" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (objects.space_kind = 'household' AND objects.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = objects.space_id AND l.account_id = objects.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = objects.space_id AND a.account_id = objects.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "objects_history_select" ON "objects_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM objects r WHERE r.id = objects_history.record_id));--> statement-breakpoint
CREATE POLICY "objects_history_insert" ON "objects_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "objects_history_worker_insert" ON "objects_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "record_links_select" ON "record_links" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (app.record_ref_allowed(left_table, left_id, false) AND app.record_ref_allowed(right_table, right_id, false));--> statement-breakpoint
CREATE POLICY "record_links_insert" ON "record_links" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (app.record_ref_allowed(left_table, left_id, false) AND app.record_ref_allowed(right_table, right_id, false) AND (app.record_ref_allowed(left_table, left_id, true) OR app.record_ref_allowed(right_table, right_id, true)) AND author_id = app.current_account_id() AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY "record_links_update" ON "record_links" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (app.record_ref_allowed(left_table, left_id, false) AND app.record_ref_allowed(right_table, right_id, false) AND (app.record_ref_allowed(left_table, left_id, true) OR app.record_ref_allowed(right_table, right_id, true))) WITH CHECK (app.record_ref_allowed(left_table, left_id, false) AND app.record_ref_allowed(right_table, right_id, false) AND (app.record_ref_allowed(left_table, left_id, true) OR app.record_ref_allowed(right_table, right_id, true)));--> statement-breakpoint
CREATE POLICY "record_links_purge_select" ON "record_links" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days' OR pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "record_links_purge" ON "record_links" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days' OR pg_trigger_depth() > 0);