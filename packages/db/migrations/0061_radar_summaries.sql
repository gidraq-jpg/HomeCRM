CREATE FUNCTION app.radar_calendar_key(rule jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT md5((rule-ARRAY['warnings','endWarnings','warningTime'])::text);
$$;
REVOKE ALL ON FUNCTION app.radar_calendar_key(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.radar_calendar_key(jsonb) TO homecrm_app,homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.radar_can_write(did uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT d.deleted_at IS NULL AND CASE
 WHEN d.profile_account_id IS NOT NULL THEN d.profile_account_id=app.current_account_id()
 WHEN d.task_id IS NOT NULL THEN app.record_ref_allowed('tasks',d.task_id,true)
 WHEN d.document_id IS NOT NULL THEN app.record_ref_allowed('documents',d.document_id,true)
 WHEN d.contact_id IS NOT NULL THEN app.record_ref_allowed('contacts',d.contact_id,true)
 ELSE app.deadline_source_allowed(d.note_id,d.object_id,true) END FROM public.deadlines d WHERE d.id=did),false);
$$;
REVOKE ALL ON FUNCTION app.radar_can_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.radar_can_write(uuid) TO homecrm_app;
--> statement-breakpoint
CREATE TABLE "radar_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deadline_id" uuid NOT NULL,
	"calendar_key" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"actor_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"author_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "radar_actions_once" UNIQUE("deadline_id","calendar_key","date"),
	CONSTRAINT "radar_actions_state" CHECK (status IN ('active','snoozed','dismissed','completed') AND version>0 AND (status<>'dismissed' OR length(trim(reason)) BETWEEN 1 AND 2000) AND (status<>'snoozed' OR snoozed_until IS NOT NULL) AND calendar_key ~ '^[a-f0-9]{32}$')
);
--> statement-breakpoint
ALTER TABLE "radar_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"time_zone" text NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summaries_period" UNIQUE("account_id","household_id","kind","local_date"),
	CONSTRAINT "summaries_calendar" CHECK (kind IN ('morning','weekly') AND period_start<period_end)
);
--> statement-breakpoint
ALTER TABLE "summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_operations" DROP CONSTRAINT "api_operations_operation";--> statement-breakpoint
ALTER TABLE "notification_settings" DROP CONSTRAINT "notification_settings_kinds";--> statement-breakpoint
ALTER TABLE "notification_settings" ALTER COLUMN "enabled_kinds" SET DEFAULT '["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification","document","task_reminder","task_assignment","task_done"]'::jsonb;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "morning_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "weekly_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "radar_actions" ADD CONSTRAINT "radar_actions_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_actions" ADD CONSTRAINT "radar_actions_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_actions" ADD CONSTRAINT "radar_actions_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_actions" ADD CONSTRAINT "radar_actions_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_household_id_spaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_operation" CHECK (operation IN ('contact_import','charge','payment','task_create','task_patch','task_status','radar_action'));--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_kinds" CHECK (enabled_kinds <@ '["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification","document","task_reminder","task_assignment","task_done"]'::jsonb AND jsonb_typeof(enabled_kinds) = 'array');--> statement-breakpoint
CREATE POLICY "radar_actions_select" ON "radar_actions" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id));--> statement-breakpoint
CREATE POLICY "radar_actions_insert" ON "radar_actions" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (app.radar_can_write(deadline_id));--> statement-breakpoint
CREATE POLICY "radar_actions_update" ON "radar_actions" AS PERMISSIVE FOR UPDATE TO "homecrm_app" USING (app.radar_can_write(deadline_id)) WITH CHECK (app.radar_can_write(deadline_id));--> statement-breakpoint
CREATE POLICY "radar_actions_worker_select" ON "radar_actions" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "summaries_select" ON "summaries" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (account_id=app.current_account_id() AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=household_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL));--> statement-breakpoint
CREATE POLICY "summaries_worker_select" ON "summaries" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (true);--> statement-breakpoint
CREATE POLICY "summaries_worker_insert" ON "summaries" AS PERMISSIVE FOR INSERT TO "homecrm_worker" WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE radar_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE summaries FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON radar_actions TO homecrm_app;
GRANT UPDATE(status,snoozed_until,reason,version) ON radar_actions TO homecrm_app;
GRANT SELECT(id,deadline_id,calendar_key,date,status,snoozed_until,version) ON radar_actions TO homecrm_worker;
GRANT SELECT ON summaries TO homecrm_app;
GRANT SELECT,INSERT ON summaries TO homecrm_worker;
GRANT UPDATE(morning_enabled,weekly_enabled) ON notification_settings TO homecrm_app;
--> statement-breakpoint
-- Сохраняем намеренно отключённые виды. Ранее deadline включал документы и дела.
ALTER TABLE notification_settings NO FORCE ROW LEVEL SECURITY;
UPDATE notification_settings SET enabled_kinds=enabled_kinds || '["document","task_reminder","task_assignment","task_done"]'::jsonb WHERE enabled_kinds ? 'deadline';
UPDATE notification_settings SET morning_enabled=false,weekly_enabled=false WHERE enabled_kinds='[]'::jsonb;
ALTER TABLE notification_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app.guard_radar_action() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.deadlines; prior jsonb; tbl text; rid uuid;
BEGIN
 SELECT * INTO d FROM public.deadlines WHERE id=NEW.deadline_id;
 tbl:=CASE WHEN d.task_id IS NOT NULL THEN 'tasks' WHEN d.document_id IS NOT NULL THEN 'documents' WHEN d.contact_id IS NOT NULL THEN 'contacts' WHEN d.note_id IS NOT NULL THEN 'notes' WHEN d.object_id IS NOT NULL THEN 'objects' END;
 rid:=coalesce(d.task_id,d.document_id,d.contact_id,d.note_id,d.object_id);
 IF tbl IS NOT NULL THEN EXECUTE format('SELECT id FROM public.%I WHERE id=$1 FOR UPDATE',tbl) USING rid; END IF;
 IF d.profile_account_id IS NOT NULL THEN PERFORM account_id FROM public.member_profiles WHERE account_id=d.profile_account_id FOR UPDATE; END IF;
 IF d.source_kind='record' THEN SELECT * INTO d FROM public.deadlines WHERE id=NEW.deadline_id FOR UPDATE;
 ELSE SELECT * INTO d FROM public.deadlines WHERE id=NEW.deadline_id; END IF;
 IF d.id IS NULL OR NOT app.radar_can_write(d.id) THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='insufficient_privilege'; END IF;
 IF NEW.calendar_key<>app.radar_calendar_key(d.rule) OR d.needs_refresh OR NOT EXISTS(SELECT 1 FROM public.deadline_occurrences o WHERE o.deadline_id=d.id AND o.date=NEW.date AND o.deleted_at IS NULL) THEN RAISE EXCEPTION 'calendar changed' USING ERRCODE='check_violation'; END IF;
 IF NEW.status='completed' AND d.source_kind<>'record' THEN RAISE EXCEPTION 'complete source instead' USING ERRCODE='check_violation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.deadline_occurrences o WHERE o.deadline_id=d.id AND o.date=NEW.date AND o.deleted_at IS NULL AND (o.completed_at IS NULL OR d.source_kind='readings')
 AND (d.task_id IS NULL OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=d.task_id AND t.status IN ('open','waiting') AND t.deleted_at IS NULL))
 AND (d.document_id IS NULL OR EXISTS(SELECT 1 FROM public.documents doc WHERE doc.id=d.document_id AND doc.status='valid' AND doc.deleted_at IS NULL))
 AND (d.source_kind<>'payment' OR app.utility_payment_open(d.utility_account_id,d.charge_id,o.date))
 AND (d.source_kind<>'readings' OR app.utility_window_open(d.utility_account_id,o.starts_at,o.ends_at,o.time_zone))
 AND (d.source_kind<>'birthday' OR o.ends_at>=now())) THEN RAISE EXCEPTION 'source closed' USING ERRCODE='check_violation'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.deadline_id,NEW.calendar_key,NEW.date) IS DISTINCT FROM (OLD.id,OLD.deadline_id,OLD.calendar_key,OLD.date) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'action version changed' USING ERRCODE='check_violation'; END IF;
  prior:=to_jsonb(OLD)-ARRAY['history','space_id','space_kind','audience','assignee_id','deleted_at'];
  NEW.history:=OLD.history || jsonb_build_array(prior);
 ELSE
  NEW.version:=1; NEW.history:='[]'::jsonb; NEW.author_id:=app.current_account_id();
 END IF;
 NEW.actor_id:=app.current_account_id(); NEW.changed_at:=now();
 NEW.space_id:=d.space_id; NEW.space_kind:=d.space_kind; NEW.audience:=d.audience; NEW.assignee_id:=d.assignee_id; NEW.deleted_at:=NULL;
 IF NEW.status='snoozed' AND NEW.snoozed_until<=now() THEN RAISE EXCEPTION 'snooze must be in future' USING ERRCODE='check_violation'; END IF;
 tbl:=CASE WHEN d.task_id IS NOT NULL THEN 'tasks' WHEN d.document_id IS NOT NULL THEN 'documents' WHEN d.contact_id IS NOT NULL THEN 'contacts' WHEN d.note_id IS NOT NULL THEN 'notes' WHEN d.object_id IS NOT NULL THEN 'objects' END;
 rid:=coalesce(d.task_id,d.document_id,d.contact_id,d.note_id,d.object_id);
 IF tbl IS NOT NULL THEN
  EXECUTE format('UPDATE public.%I SET has_other_contributions=true WHERE id=$1 AND space_kind=''household'' AND author_id<>app.current_account_id() AND NOT has_other_contributions',tbl) USING rid;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER radar_actions_guard BEFORE INSERT OR UPDATE ON radar_actions FOR EACH ROW EXECUTE FUNCTION app.guard_radar_action();
REVOKE ALL ON FUNCTION app.guard_radar_action() FROM PUBLIC;
