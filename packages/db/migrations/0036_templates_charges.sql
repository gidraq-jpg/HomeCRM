CREATE TABLE "template_applications" (
	"account_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"object_id" uuid,
	CONSTRAINT "template_applications_key" UNIQUE("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "template_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "utility_charges" (
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
	"period" text DEFAULT '2026-10' NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_on" date DEFAULT '2026-11-15' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"is_paid" boolean DEFAULT false NOT NULL,
	CONSTRAINT "utility_charges_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "utility_charges_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "utility_charges_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL)),
	CONSTRAINT "charges_cents" CHECK (total_cents BETWEEN 0 AND 1000000000000),
	CONSTRAINT "charges_period" CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "utility_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "utility_charges_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "utility_charges_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "utility_charges_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "utility_payments" (
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
	"paid_on" date DEFAULT '2026-10-08' NOT NULL,
	"amount_cents" bigint DEFAULT 1 NOT NULL,
	"payer" jsonb DEFAULT '{"kind":"tenant"}'::jsonb NOT NULL,
	"method" text DEFAULT 'tenant' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "utility_payments_id_space_key" UNIQUE("id","space_id","space_kind"),
	CONSTRAINT "utility_payments_id_audience_key" UNIQUE("id","audience"),
	CONSTRAINT "utility_payments_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL)),
	CONSTRAINT "payments_cents" CHECK (amount_cents BETWEEN 1 AND 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "utility_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "utility_payments_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" "history_operation" NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "utility_payments_history_audience_iff_household" CHECK ((space_kind = 'personal') = (audience IS NULL))
);
--> statement-breakpoint
ALTER TABLE "utility_payments_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "charge_id" uuid;--> statement-breakpoint
ALTER TABLE "template_applications" ADD CONSTRAINT "template_applications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_applications" ADD CONSTRAINT "template_applications_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges_history" ADD CONSTRAINT "utility_charges_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_charges_history" ADD CONSTRAINT "utility_charges_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."utility_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_space_fk" FOREIGN KEY ("space_id","space_kind") REFERENCES "public"."spaces"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_assignee_member_fk" FOREIGN KEY ("space_id","assignee_house_id") REFERENCES "public"."space_members"("space_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_assignee_adult_fk" FOREIGN KEY ("space_id","assignee_adult_id","assignee_adult_flag") REFERENCES "public"."space_members"("space_id","account_id","is_adult") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments_history" ADD CONSTRAINT "utility_payments_history_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_payments_history" ADD CONSTRAINT "utility_payments_history_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."utility_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "utility_charges_space_id_idx" ON "utility_charges" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "utility_charges_trash_idx" ON "utility_charges" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "utility_charges_parent_id_idx" ON "utility_charges" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "utility_charges_history_record_id_idx" ON "utility_charges_history" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "utility_payments_space_id_idx" ON "utility_payments" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "utility_payments_trash_idx" ON "utility_payments" USING btree ("deleted_at") WHERE deleted_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "utility_payments_parent_id_idx" ON "utility_payments" USING btree (parent_id);--> statement-breakpoint
CREATE INDEX "utility_payments_history_record_id_idx" ON "utility_payments_history" USING btree ("record_id","created_at");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_charge_id_utility_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."utility_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_charge_id_unique" UNIQUE("charge_id");--> statement-breakpoint
CREATE POLICY "template_applications_select" ON "template_applications" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "template_applications_insert" ON "template_applications" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (account_id=app.current_account_id());--> statement-breakpoint
CREATE POLICY "utility_charges_select" ON "utility_charges" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "utility_charges_insert" ON "utility_charges" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "utility_charges_update" ON "utility_charges" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
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
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
CREATE POLICY "utility_charges_purge_select" ON "utility_charges" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "utility_charges_purge" ON "utility_charges" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "utility_charges_reassign_select" ON "utility_charges" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((utility_charges.space_kind = 'household' AND utility_charges.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = utility_charges.space_id AND l.account_id = utility_charges.assignee_id AND l.left_at IS NOT NULL
  )) OR (utility_charges.space_kind = 'household' AND utility_charges.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = utility_charges.space_id AND a.account_id = utility_charges.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "utility_charges_reassign" ON "utility_charges" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (utility_charges.space_kind = 'household' AND utility_charges.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = utility_charges.space_id AND l.account_id = utility_charges.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = utility_charges.space_id AND a.account_id = utility_charges.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "utility_charges_deadline_worker_select" ON "utility_charges" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id IN (SELECT a.parent_id FROM utility_accounts a WHERE a.id=utility_charges.parent_id)));--> statement-breakpoint
CREATE POLICY "utility_charges_history_select" ON "utility_charges_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM utility_charges r WHERE r.id = utility_charges_history.record_id));--> statement-breakpoint
CREATE POLICY "utility_charges_history_insert" ON "utility_charges_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "utility_charges_history_worker_insert" ON "utility_charges_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
CREATE POLICY "utility_payments_select" ON "utility_payments" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ));--> statement-breakpoint
CREATE POLICY "utility_payments_insert" ON "utility_payments" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (deleted_at IS NULL AND author_id = app.current_account_id() AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
  )));--> statement-breakpoint
CREATE POLICY "utility_payments_update" ON "utility_payments" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING ((deleted_at IS NULL AND ((
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
  ))) OR (deleted_at IS NOT NULL AND pg_trigger_depth() > 0 AND ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
    space_kind = 'personal' OR space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
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
CREATE POLICY "utility_payments_purge_select" ON "utility_payments" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "utility_payments_purge" ON "utility_payments" AS PERMISSIVE FOR DELETE TO "homecrm_worker" USING (deleted_at < now() - interval '30 days');--> statement-breakpoint
CREATE POLICY "utility_payments_reassign_select" ON "utility_payments" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((utility_payments.space_kind = 'household' AND utility_payments.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = utility_payments.space_id AND l.account_id = utility_payments.assignee_id AND l.left_at IS NOT NULL
  )) OR (utility_payments.space_kind = 'household' AND utility_payments.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = utility_payments.space_id AND a.account_id = utility_payments.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )));--> statement-breakpoint
CREATE POLICY "utility_payments_reassign" ON "utility_payments" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (utility_payments.space_kind = 'household' AND utility_payments.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = utility_payments.space_id AND l.account_id = utility_payments.assignee_id AND l.left_at IS NOT NULL
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = utility_payments.space_id AND a.account_id = utility_payments.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  ));--> statement-breakpoint
CREATE POLICY "utility_payments_history_select" ON "utility_payments_history" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING ((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND EXISTS (SELECT 1 FROM utility_payments r WHERE r.id = utility_payments_history.record_id));--> statement-breakpoint
CREATE POLICY "utility_payments_history_insert" ON "utility_payments_history" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM app.current_account_id());--> statement-breakpoint
CREATE POLICY "utility_payments_history_worker_insert" ON "utility_payments_history" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (pg_trigger_depth() > 0 AND actor_id IS NULL);--> statement-breakpoint
ALTER POLICY "deadlines_utility_insert" ON "deadlines" TO homecrm_app WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);--> statement-breakpoint
ALTER POLICY "deadlines_utility_update" ON "deadlines" TO homecrm_app USING (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid) WITH CHECK (pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'deleted_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid'];
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NEW; END IF;
  -- Новый вид записи требует явного решения о содержательном вкладе.
  IF TG_TABLE_NAME NOT IN ('notes','note_items','shopping_items','tasks','objects','object_fields','object_events','note_files','object_files','contacts','utility_accounts','meters','meter_readings','utility_charges','utility_payments') THEN
    RAISE EXCEPTION 'record contribution rules are not registered' USING ERRCODE = 'check_violation';
  END IF;
  -- Очистка контакта меняет только ссылку, в том числе у события в корзине.
  IF TG_TABLE_NAME = 'object_events' AND pg_trigger_depth() > 1
    AND (to_jsonb(OLD)->>'contact_table') = current_setting('app.contact_purge_table',true)
    AND (to_jsonb(OLD)->>'contact_id') = nullif(current_setting('app.contact_purge_id',true),'') THEN
    IF NEW.contact_table IS NOT NULL OR NEW.contact_id IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['contact_table','contact_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN
      RAISE EXCEPTION 'contact cleanup changes only the reference' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
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
        IF TG_TABLE_NAME = 'notes' AND (EXISTS (SELECT 1 FROM public.note_items i WHERE i.parent_id = OLD.id AND
          (i.author_id <> OLD.author_id OR i.has_other_contributions)) OR EXISTS (SELECT 1 FROM public.note_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions))) THEN
          RAISE EXCEPTION 'children have other contributions' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF TG_TABLE_NAME = 'objects' AND (
          EXISTS (SELECT 1 FROM public.meters i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.utility_accounts i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.object_files i WHERE i.parent_id=OLD.id AND (i.author_id<>OLD.author_id OR i.has_other_contributions)) OR
          EXISTS (SELECT 1 FROM public.object_fields i WHERE i.parent_id = OLD.id AND (i.author_id <> OLD.author_id OR i.has_other_contributions))
          OR EXISTS (SELECT 1 FROM public.object_events i WHERE i.parent_id = OLD.id AND (i.author_id <> OLD.author_id OR i.has_other_contributions))
        ) THEN
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
      OR (TG_TABLE_NAME = 'tasks' AND NEW.title IS DISTINCT FROM OLD.title)
      OR (TG_TABLE_NAME = 'objects' AND (NEW.title, to_jsonb(NEW)->'type_data', to_jsonb(NEW)->'object_type') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->'type_data', to_jsonb(OLD)->'object_type'))
      OR (TG_TABLE_NAME = 'shopping_items' AND (NEW.title, to_jsonb(NEW)->>'quantity', to_jsonb(NEW)->>'bought_at') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>'quantity', to_jsonb(OLD)->>'bought_at'))
      OR (TG_TABLE_NAME IN ('object_fields', 'object_events','contacts','utility_accounts','meters','meter_readings','utility_charges','utility_payments') AND (to_jsonb(NEW) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])) IS DISTINCT FROM (to_jsonb(OLD) - (ignored || ARRAY['space_id', 'space_kind', 'audience', 'assignee_id', 'created_at', 'deleted_at'])))
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
      AND NOT coalesce((pg_trigger_depth() > 1
        AND TG_TABLE_NAME = current_setting('app.parent_restore_table',true)
        AND (to_jsonb(OLD)->>'parent_id') = current_setting('app.parent_restore_id',true)
        AND OLD.deleted_at = nullif(current_setting('app.parent_restore_time',true),'')::timestamptz),false)
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
CREATE OR REPLACE FUNCTION app.record_history() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  hidden text[] := ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  new_json jsonb := to_jsonb(NEW) - ARRAY['updated_at', 'assignee_house_id', 'assignee_adult_id', 'assignee_adult_flag', 'has_other_contributions', 'search_text','is_active','is_paid','storage_key','envelope','preview_storage_key','preview_envelope','supplier_id'];
  old_json jsonb;
  changes jsonb;
  operation text;
  place_id uuid := NEW.space_id;
  place_kind public.space_kind := NEW.space_kind;
  place_audience public.audience := NEW.audience;
BEGIN
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)->>'previous_meter_id') IS NOT NULL AND (to_jsonb(NEW)->>'previous_meter_id') IS NULL AND (to_jsonb(NEW)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['previous_meter_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meters' AND TG_OP='UPDATE' AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') AND (to_jsonb(OLD)->>'utility_account_id') IS NOT NULL AND (to_jsonb(NEW)->>'utility_account_id') IS NULL AND (to_jsonb(NEW)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag'])=(to_jsonb(OLD)-ARRAY['utility_account_id','search_text','is_active','is_paid','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='meter_readings' THEN new_json := app.reading_decimal_json(new_json); END IF;
  IF TG_TABLE_NAME = 'utility_accounts' AND TG_OP = 'UPDATE' AND (pg_trigger_depth() > 1 OR current_user='homecrm_owner')
    AND (to_jsonb(OLD)->>'supplier_id') IS NOT NULL AND (to_jsonb(NEW)->>'supplier_id') IS NULL
    AND (to_jsonb(NEW)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) = (to_jsonb(OLD)-ARRAY['supplier_id','assignee_house_id','assignee_adult_id','assignee_adult_flag']) THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments') THEN
      RETURN NULL;
    END IF;
    operation := 'create';
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json - ARRAY['id', 'created_at']) AS e
      WHERE e.value <> 'null'::jsonb;
  ELSE
    IF OLD.space_kind <> 'household' AND NEW.space_kind <> 'household' AND TG_TABLE_NAME NOT IN ('utility_charges','utility_payments') THEN
      RETURN NULL;
    END IF;
    old_json := to_jsonb(OLD) - hidden;
    IF TG_TABLE_NAME='meter_readings' THEN old_json := app.reading_decimal_json(old_json); END IF;
    SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', old_json -> e.key, 'new', e.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(new_json) AS e
      WHERE e.value IS DISTINCT FROM (old_json -> e.key);
    IF TG_TABLE_NAME='utility_accounts' AND (to_jsonb(NEW)->'supplier_id') IS DISTINCT FROM (to_jsonb(OLD)->'supplier_id') THEN
      changes := changes || jsonb_build_object('supplier_changed',jsonb_build_object('new',true));
    END IF;
    IF changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    operation := CASE
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'trash'
      WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore'
      WHEN OLD.space_id <> NEW.space_id OR OLD.space_kind <> NEW.space_kind THEN 'move'
      WHEN OLD.audience IS DISTINCT FROM NEW.audience THEN 'audience'
      ELSE 'update'
    END;
    -- Более узкое из двух мест.
    IF OLD.space_kind = 'personal' THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND OLD.space_id <> NEW.space_id THEN
      place_id := OLD.space_id;
      place_kind := OLD.space_kind;
      place_audience := OLD.audience;
    ELSIF NEW.space_kind = 'household' AND (OLD.audience = 'adults' OR NEW.audience = 'adults') THEN
      place_audience := 'adults';
    END IF;
  END IF;
  EXECUTE format(
    'INSERT INTO public.%I (record_id, space_id, space_kind, audience, actor_id, operation, changes) '
    'VALUES ($1, $2, $3, $4, $5, $6::public.history_operation, $7)',
    TG_TABLE_NAME || '_history'
  ) USING NEW.id, place_id, place_kind, place_audience, app.current_account_id(), operation, changes;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p record; tbl text; rid uuid; cascading boolean;
BEGIN
 cascading := pg_trigger_depth()>1 AND coalesce(NEW.note_id,NEW.object_id)=nullif(current_setting('app.deadline_source_id',true),'')::uuid;
 IF NEW.source_kind<>'record' AND coalesce(NEW.charge_id,NEW.utility_account_id,NEW.meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid AND (pg_trigger_depth()>1 OR current_user='homecrm_owner') THEN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.object_id,NEW.source_kind,NEW.utility_account_id,NEW.meter_id,NEW.charge_id,NEW.author_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.object_id,OLD.source_kind,OLD.utility_account_id,OLD.meter_id,OLD.charge_id,OLD.author_id,OLD.created_at) THEN
   RAISE EXCEPTION 'immutable utility source' USING ERRCODE='insufficient_privilege';
  END IF;
  -- Источник уже удерживает блокировку объекта; FOR UPDATE скрыл бы чужую корзину от взрослого.
  SELECT * INTO p FROM public.objects WHERE id=NEW.object_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
  NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
  IF p.space_kind='household' THEN NEW.household_id:=p.space_id; END IF;
  NEW.deleted_at:=coalesce(p.deleted_at,NEW.deleted_at); NEW.updated_at:=now(); NEW.needs_refresh:=true;
  RETURN NEW;
 END IF;
 IF NEW.source_kind<>'record' AND current_user<>'homecrm_worker' AND NOT cascading THEN
  RAISE EXCEPTION 'edit utility source instead' USING ERRCODE='insufficient_privilege';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['rule','label','deleted_at','updated_at','needs_refresh','space_id','space_kind','audience','assignee_id','household_id']) THEN
    RAISE EXCEPTION 'immutable deadline fields' USING ERRCODE='insufficient_privilege';
  END IF;
  IF current_user='homecrm_worker' THEN
   IF (to_jsonb(NEW)-'needs_refresh') IS DISTINCT FROM (to_jsonb(OLD)-'needs_refresh') THEN
    RAISE EXCEPTION 'worker only clears refresh flag' USING ERRCODE='insufficient_privilege';
   END IF;
   RETURN NEW;
  END IF;
  IF cascading THEN
   IF NEW.rule IS DISTINCT FROM OLD.rule THEN RAISE EXCEPTION 'cascade cannot change rule' USING ERRCODE='insufficient_privilege'; END IF;
   NEW.updated_at:=now(); NEW.needs_refresh:=true; RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS NOT NULL OR
    (to_jsonb(NEW)-ARRAY['deleted_at','updated_at','needs_refresh']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['deleted_at','updated_at','needs_refresh'])) THEN
    RAISE EXCEPTION 'restore only' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR (NEW.space_id,NEW.space_kind,NEW.audience,NEW.assignee_id) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience,OLD.assignee_id) THEN
   RAISE EXCEPTION 'deadline follows source' USING ERRCODE='insufficient_privilege';
  END IF;
 END IF;
 tbl:=CASE WHEN NEW.note_id IS NOT NULL THEN 'notes' ELSE 'objects' END; rid:=coalesce(NEW.note_id,NEW.object_id);
 EXECUTE format('SELECT space_id,space_kind,audience,assignee_id,deleted_at FROM public.%I WHERE id=$1 FOR UPDATE',tbl) INTO p USING rid;
 IF p.space_id IS NULL OR p.deleted_at IS NOT NULL OR NOT app.deadline_source_allowed(NEW.note_id,NEW.object_id,true) THEN
  RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF (TG_OP='INSERT' OR NEW.space_kind='household') AND (NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id=NEW.household_id AND s.kind='household') OR
    NOT EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id=NEW.household_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL)) THEN
  RAISE EXCEPTION 'house unavailable' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p.space_kind='household' AND p.space_id<>NEW.household_id THEN RAISE EXCEPTION 'wrong house' USING ERRCODE='check_violation'; END IF;
 NEW.space_id:=p.space_id; NEW.space_kind:=p.space_kind; NEW.audience:=p.audience; NEW.assignee_id:=p.assignee_id;
 NEW.updated_at:=now(); NEW.needs_refresh:=true;
 IF TG_OP='INSERT' THEN NEW.author_id:=app.current_account_id(); NEW.created_at:=now();
 ELSIF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at:=now(); END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.put_utility_deadline(kind text, source_id uuid, parent_id uuid, author_id uuid, rule jsonb, trashed_at timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.objects; house uuid; prior_source text:=current_setting('app.utility_source_id',true); prior_object text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF pg_trigger_depth()=0 AND current_user<>'homecrm_owner' THEN RAISE EXCEPTION 'trigger only' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO p FROM public.objects WHERE id=parent_id;
 IF p.id IS NULL THEN RETURN; END IF;
 house:=CASE WHEN p.space_kind='household' THEN p.space_id ELSE
  coalesce((SELECT d.household_id FROM public.deadlines d WHERE d.object_id=p.id ORDER BY d.created_at,d.id LIMIT 1),
  (SELECT m.space_id FROM public.space_members m WHERE m.account_id=p.author_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN; END IF;
 PERFORM set_config('app.utility_source_id',source_id::text,true);
 PERFORM set_config('app.deadline_source_id',parent_id::text,true);
 IF rule IS NULL OR rule='null'::jsonb THEN
  UPDATE public.deadlines d SET deleted_at=coalesce(d.deleted_at,now()),needs_refresh=true
   WHERE d.charge_id IS NULL AND d.source_kind=kind AND coalesce(d.utility_account_id,d.meter_id)=source_id AND d.deleted_at IS NULL;
 ELSE
  INSERT INTO public.deadlines(object_id,source_kind,utility_account_id,meter_id,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
  VALUES(parent_id,kind,CASE WHEN kind<>'verification' THEN source_id END,CASE WHEN kind='verification' THEN source_id END,
   house,rule,p.space_id,p.space_kind,p.audience,author_id,p.assignee_id,coalesce(p.deleted_at,trashed_at))
  ON CONFLICT DO NOTHING;
  UPDATE public.deadlines d SET rule=put_utility_deadline.rule,deleted_at=coalesce(p.deleted_at,trashed_at),needs_refresh=true
   WHERE d.charge_id IS NULL AND d.source_kind=kind AND coalesce(d.utility_account_id,d.meter_id)=source_id
   AND (d.rule,d.deleted_at,d.space_id,d.audience,d.assignee_id) IS DISTINCT FROM (put_utility_deadline.rule,coalesce(p.deleted_at,trashed_at),p.space_id,p.audience,p.assignee_id);
 END IF;
 PERFORM set_config('app.utility_source_id',coalesce(prior_source,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_object,''),true);
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_ref_allowed(tbl text, rid uuid, writing boolean DEFAULT false) RETURNS boolean
  LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE r record;
BEGIN
  IF tbl IS NULL OR rid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = tbl
      AND t.tgfoid = 'app.record_defaults()'::regprocedure AND NOT t.tgisinternal
  ) THEN RETURN false; END IF;
  EXECUTE format('SELECT space_id, space_kind, audience, assignee_id, deleted_at FROM public.%I WHERE id = $1', tbl) INTO r USING rid;
  IF r.space_id IS NULL OR NOT app.placement_visible(r.space_id, r.space_kind, r.audience) THEN RETURN false; END IF;
  IF NOT writing THEN RETURN true; END IF;
  RETURN r.deleted_at IS NULL AND (r.space_kind = 'personal' OR tbl = 'shopping_items'
    OR (tbl = 'tasks' AND r.assignee_id = app.current_account_id())
    OR EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id = r.space_id
      AND m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('adult', 'admin')));
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_occurrence_cascade() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user='homecrm_app' THEN
  IF (to_jsonb(NEW)-'completed_at')=(to_jsonb(OLD)-'completed_at') AND EXISTS
   (SELECT 1 FROM public.deadlines d WHERE d.id=NEW.deadline_id AND ((d.source_kind='payment' AND d.charge_id IS NULL AND app.utility_payment_open(d.utility_account_id,NULL,NEW.date)) OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true)) THEN RETURN NEW; END IF;
  IF pg_trigger_depth()<2 OR NEW.deadline_id<>nullif(current_setting('app.deadline_cascade_id',true),'')::uuid OR
   (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) THEN
   RAISE EXCEPTION 'occurrence is derived' USING ERRCODE='insufficient_privilege'; END IF;
 END IF; RETURN NEW;
END; $$;
--> statement-breakpoint

SELECT app.attach_record_table('utility_charges','utility_accounts');
SELECT app.attach_record_table('utility_payments','utility_charges');
ALTER TABLE template_applications FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON template_applications TO homecrm_app;
GRANT SELECT(charge_id) ON deadlines TO homecrm_worker;
GRANT SELECT(parent_id,period,due_on,is_paid,cancelled_at) ON utility_charges TO homecrm_worker;
GRANT SELECT(id,parent_id) ON utility_accounts TO homecrm_worker;


--> statement-breakpoint
CREATE FUNCTION app.financial_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.utility_accounts; c public.utility_charges; p public.objects; content_changed boolean:=true;
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.parent_id<>OLD.parent_id THEN RAISE EXCEPTION 'reparenting is not supported' USING ERRCODE='insufficient_privilege'; END IF;
  IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at AND pg_trigger_depth()<2 THEN
   RAISE EXCEPTION 'cancel financial record instead' USING ERRCODE='insufficient_privilege'; END IF;
  IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at,NEW.cancellation_reason) IS DISTINCT FROM (OLD.cancelled_at,OLD.cancellation_reason) THEN
   RAISE EXCEPTION 'cancellation is permanent' USING ERRCODE='check_violation'; END IF;
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
   IF length(trim(coalesce(NEW.cancellation_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'reason required' USING ERRCODE='check_violation'; END IF;
   NEW.cancelled_at:=now();
  END IF;
  content_changed := (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','updated_at','deleted_at','has_other_contributions','assignee_house_id','assignee_adult_id','assignee_adult_flag','is_paid']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','updated_at','deleted_at','has_other_contributions','assignee_house_id','assignee_adult_id','assignee_adult_flag','is_paid']);
  IF OLD.cancelled_at IS NOT NULL AND content_changed THEN RAISE EXCEPTION 'cancelled record is immutable' USING ERRCODE='check_violation'; END IF;
 ELSE
  IF app.current_account_id() IS NOT NULL AND (NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL) THEN RAISE EXCEPTION 'new financial record cannot be cancelled' USING ERRCODE='check_violation'; END IF;
 END IF;
 IF TG_TABLE_NAME='utility_payments' THEN
  IF TG_OP='UPDATE' AND (NEW.amount_cents,NEW.paid_on,NEW.payer,NEW.method) IS DISTINCT FROM (OLD.amount_cents,OLD.paid_on,OLD.payer,OLD.method) THEN
   RAISE EXCEPTION 'cancel payment instead' USING ERRCODE='check_violation'; END IF;
  SELECT * INTO c FROM public.utility_charges WHERE id=NEW.parent_id;
  SELECT * INTO a FROM public.utility_accounts WHERE id=c.parent_id;
 ELSE
  SELECT * INTO a FROM public.utility_accounts WHERE id=NEW.parent_id;
  IF TG_OP='UPDATE' AND NEW.is_paid IS DISTINCT FROM OLD.is_paid AND NOT (pg_trigger_depth()>1 AND NEW.id::text=current_setting('app.settling_charge',true)) THEN
   RAISE EXCEPTION 'settlement is derived' USING ERRCODE='insufficient_privilege'; END IF;
  IF TG_OP='INSERT' OR NEW.total_cents IS DISTINCT FROM OLD.total_cents THEN
   NEW.is_paid := NEW.total_cents <= coalesce((SELECT sum(amount_cents) FROM public.utility_payments WHERE parent_id=NEW.id AND cancelled_at IS NULL AND deleted_at IS NULL),0);
  END IF;
 END IF;
 IF TG_TABLE_NAME='utility_charges' AND TG_OP='UPDATE' AND OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.utility_payments WHERE parent_id=NEW.id AND cancelled_at IS NULL AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'cancel payments first' USING ERRCODE='check_violation'; END IF;
 IF NOT content_changed THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.objects WHERE id=a.parent_id FOR UPDATE;
 PERFORM id FROM public.utility_accounts WHERE id=a.id FOR UPDATE;
 IF TG_TABLE_NAME='utility_payments' THEN
  SELECT * INTO c FROM public.utility_charges WHERE id=NEW.parent_id FOR UPDATE;
  IF c.cancelled_at IS NOT NULL OR c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'charge unavailable' USING ERRCODE='check_violation'; END IF;
  IF TG_OP='INSERT' AND NEW.payer->>'kind'='member' AND NOT (
   (NEW.payer->>'accountId')::uuid=app.current_account_id() OR EXISTS (SELECT 1 FROM public.space_members m WHERE m.space_id=p.space_id AND m.account_id=(NEW.payer->>'accountId')::uuid AND m.left_at IS NULL)) THEN
   RAISE EXCEPTION 'payer unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
 IF p.id IS NULL OR a.id IS NULL OR p.deleted_at IS NOT NULL OR a.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'parent unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF p.space_kind='household' AND app.current_account_id() IS NOT NULL THEN
  IF p.author_id<>app.current_account_id() THEN UPDATE public.objects SET has_other_contributions=true WHERE id=p.id; END IF;
  IF a.author_id<>app.current_account_id() THEN UPDATE public.utility_accounts SET has_other_contributions=true WHERE id=a.id; END IF;
  IF c.id IS NOT NULL AND c.author_id<>app.current_account_id() THEN UPDATE public.utility_charges SET has_other_contributions=true WHERE id=c.id; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.financial_guard() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER utility_charges_00_financial BEFORE INSERT OR UPDATE ON utility_charges FOR EACH ROW EXECUTE FUNCTION app.financial_guard();
CREATE TRIGGER utility_payments_00_financial BEFORE INSERT OR UPDATE ON utility_payments FOR EACH ROW EXECUTE FUNCTION app.financial_guard();

--> statement-breakpoint
CREATE FUNCTION app.cascade_financial_placement() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (NEW.space_id,NEW.space_kind,NEW.audience) IS DISTINCT FROM (OLD.space_id,OLD.space_kind,OLD.audience) THEN
  IF TG_TABLE_NAME='utility_accounts' THEN UPDATE public.utility_charges SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id;
  ELSE UPDATE public.utility_payments SET space_id=NEW.space_id,space_kind=NEW.space_kind,audience=NEW.audience WHERE parent_id=NEW.id; END IF;
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.cascade_financial_placement() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER utility_accounts_financial_placement AFTER UPDATE OF space_id,space_kind,audience ON utility_accounts FOR EACH ROW EXECUTE FUNCTION app.cascade_financial_placement();
CREATE TRIGGER utility_charges_financial_placement AFTER UPDATE OF space_id,space_kind,audience ON utility_charges FOR EACH ROW EXECUTE FUNCTION app.cascade_financial_placement();
CREATE FUNCTION app.settle_charge() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE prior text:=current_setting('app.settling_charge',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 PERFORM set_config('app.settling_charge',NEW.parent_id::text,true);
 UPDATE public.utility_charges c SET is_paid=c.total_cents<=coalesce((SELECT sum(p.amount_cents) FROM public.utility_payments p WHERE p.parent_id=c.id AND p.cancelled_at IS NULL AND p.deleted_at IS NULL),0)
 WHERE c.id=NEW.parent_id AND c.deleted_at IS NULL AND c.is_paid IS DISTINCT FROM (c.total_cents<=coalesce((SELECT sum(p.amount_cents) FROM public.utility_payments p WHERE p.parent_id=c.id AND p.cancelled_at IS NULL AND p.deleted_at IS NULL),0));
 PERFORM set_config('app.settling_charge',coalesce(prior,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.settle_charge() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER utility_payments_settle AFTER INSERT OR UPDATE OF cancelled_at,deleted_at ON utility_payments FOR EACH ROW EXECUTE FUNCTION app.settle_charge();

--> statement-breakpoint
CREATE FUNCTION app.charge_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.utility_accounts; p public.objects; house uuid; r jsonb;
 prior text:=current_setting('app.utility_source_id',true); prior_object text:=current_setting('app.deadline_source_id',true);
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.utility_accounts WHERE id=NEW.parent_id;
 SELECT * INTO p FROM public.objects WHERE id=a.parent_id;
 house:=CASE WHEN p.space_kind='household' THEN p.space_id ELSE coalesce(
  (SELECT d.household_id FROM public.deadlines d WHERE d.object_id=p.id ORDER BY d.id LIMIT 1),
  (SELECT m.space_id FROM public.space_members m WHERE m.account_id=p.author_id AND m.left_at IS NULL ORDER BY m.space_id LIMIT 1)) END;
 IF house IS NULL THEN RETURN NULL; END IF;
 r:=jsonb_build_object('kind','date','date',NEW.due_on,'time','00:00','durationDays',0,'warnings',coalesce(a.data#>'{paymentRule,warnings}','[3,0]'::jsonb),'warningTime',coalesce(a.data#>>'{paymentRule,warningTime}','09:00'));
 PERFORM set_config('app.utility_source_id',NEW.id::text,true);
 PERFORM set_config('app.deadline_source_id',p.id::text,true);
 INSERT INTO public.deadlines(object_id,source_kind,utility_account_id,charge_id,household_id,rule,space_id,space_kind,audience,author_id,assignee_id,deleted_at)
 VALUES(p.id,'payment',a.id,NEW.id,house,r,NEW.space_id,NEW.space_kind,NEW.audience,NEW.author_id,p.assignee_id,coalesce(NEW.deleted_at,NEW.cancelled_at)) ON CONFLICT DO NOTHING;
 UPDATE public.deadlines d SET rule=r,deleted_at=coalesce(NEW.deleted_at,NEW.cancelled_at),needs_refresh=true WHERE d.charge_id=NEW.id AND
 (d.rule,d.deleted_at) IS DISTINCT FROM (r,coalesce(NEW.deleted_at,NEW.cancelled_at));
 PERFORM set_config('app.utility_source_id',coalesce(prior,''),true);
 PERFORM set_config('app.deadline_source_id',coalesce(prior_object,''),true);
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app.charge_deadline() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER utility_charges_deadlines AFTER INSERT OR UPDATE OF due_on,cancelled_at,deleted_at,space_id,space_kind,audience ON utility_charges FOR EACH ROW EXECUTE FUNCTION app.charge_deadline();
CREATE FUNCTION app.utility_payment_open(account_id uuid, charge_id uuid, occurrence_date date) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN $2 IS NOT NULL THEN EXISTS (SELECT 1 FROM public.utility_charges c WHERE c.id=$2 AND c.deleted_at IS NULL AND c.cancelled_at IS NULL AND NOT c.is_paid)
 ELSE NOT EXISTS (SELECT 1 FROM public.utility_charges c WHERE c.parent_id=$1 AND c.deleted_at IS NULL AND c.cancelled_at IS NULL AND c.period=to_char($3-interval '1 month','YYYY-MM')) END;
$$;
REVOKE ALL ON FUNCTION app.utility_payment_open(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.utility_payment_open(uuid,uuid,date) TO homecrm_app,homecrm_worker;
