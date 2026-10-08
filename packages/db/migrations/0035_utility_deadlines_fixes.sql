DROP INDEX "deadline_notifications_once";--> statement-breakpoint
ALTER TABLE "notification_settings" ALTER COLUMN "enabled_kinds" SET DEFAULT '["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification"]'::jsonb;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "notification_kind" text DEFAULT 'deadline' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_notifications_once" ON "deadline_notifications" USING btree ("occurrence_id","recipient_id","warning_at","notification_kind") WHERE status <> 'cancelled' OR cancellation_reason IS NOT NULL;--> statement-breakpoint
ALTER POLICY "deadline_occurrences_complete_payment" ON "deadline_occurrences" TO homecrm_app USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND (d.source_kind='payment' OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true))) WITH CHECK (deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND (d.source_kind='payment' OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true)));--> statement-breakpoint
ALTER POLICY "deadlines_purge" ON "deadlines" TO homecrm_worker USING (source_kind='record' AND deleted_at < now() - interval '30 days');
--> statement-breakpoint
-- Сохраняем прежний выбор всех сроков. Пустой и конкретные списки не меняются.
CREATE POLICY deadlines_fixes_seed ON notification_settings TO homecrm_owner USING (true) WITH CHECK (true);
UPDATE notification_settings SET enabled_kinds='["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification"]'::jsonb
 WHERE enabled_kinds ? 'deadline';
DROP POLICY deadlines_fixes_seed ON notification_settings;
GRANT SELECT(created_at) ON deadlines TO homecrm_worker;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.utility_source_deadlines() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='utility_accounts' THEN
  r:=NEW.data->'readingRule';
  IF NEW.data->'transmission'->>'method' IN ('automatic','not_required') THEN r:=NULL; END IF;
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',coalesce(r->'warnings','[0]'::jsonb),'endWarnings',coalesce(r->'endWarnings','[1,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('readings',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
  r:=NEW.data->'paymentRule';
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',coalesce(r->'warnings','[3,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('payment',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
 ELSE
  r:=CASE WHEN NEW.data->>'nextVerificationOn' IS NOT NULL AND NEW.data->>'status'='active' THEN
   jsonb_build_object('kind','date','date',NEW.data->>'nextVerificationOn','time','00:00','durationDays',0,'warnings',coalesce(NEW.data->'verificationWarnings','[60,30,7]'::jsonb),'warningTime',coalesce(NEW.data->>'verificationWarningTime','09:00')) END;
  PERFORM app.put_utility_deadline('verification',NEW.id,NEW.parent_id,NEW.author_id,r,NEW.deleted_at);
 END IF;
 PERFORM pg_notify('homecrm_deadlines',''); RETURN NULL;
END; $$;

--> statement-breakpoint
-- Нет активных приборов: окно открыто до отметки на счёте или конца окна.
CREATE OR REPLACE FUNCTION app.utility_window_open(account_id uuid, starts_at timestamptz, ends_at timestamptz, zone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (NOT EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=$1 AND m.deleted_at IS NULL AND m.is_active)
  AND $3>=CURRENT_TIMESTAMP AND NOT EXISTS (
    SELECT 1 FROM public.deadline_occurrences o JOIN public.deadlines d ON d.id=o.deadline_id
    WHERE d.utility_account_id=$1 AND d.source_kind='readings' AND o.starts_at=$2 AND o.ends_at=$3 AND o.completed_at IS NOT NULL))
 OR EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=$1 AND m.deleted_at IS NULL AND m.is_active
  AND NOT EXISTS (SELECT 1 FROM public.meter_readings r WHERE r.parent_id=m.id AND r.deleted_at IS NULL AND r.transmitted_at IS NOT NULL
    AND r.occurred_on BETWEEN ($2 AT TIME ZONE $4)::date AND ($3 AT TIME ZONE $4)::date));
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_occurrence_cascade() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user='homecrm_app' THEN
  IF (to_jsonb(NEW)-'completed_at')=(to_jsonb(OLD)-'completed_at') AND EXISTS
   (SELECT 1 FROM public.deadlines d WHERE d.id=NEW.deadline_id AND (d.source_kind='payment' OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM public.meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true)) THEN RETURN NEW; END IF;
  IF pg_trigger_depth()<2 OR NEW.deadline_id<>nullif(current_setting('app.deadline_cascade_id',true),'')::uuid OR
   (to_jsonb(NEW)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['space_id','space_kind','audience','assignee_id','deleted_at']) THEN
   RAISE EXCEPTION 'occurrence is derived' USING ERRCODE='insufficient_privilege'; END IF;
 END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE POLICY utility_seed ON objects TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY utility_seed ON utility_accounts TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY utility_seed ON meters FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY utility_seed ON space_members FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY utility_seed ON deadlines TO homecrm_owner USING (true) WITH CHECK (true);
-- До 0035 схема сама подставляла warnings: []; это отсутствие настройки, а не отказ пользователя.
-- Нормализуем источник, чтобы следующее сохранение не вернуло пустые предупреждения.
-- Служебное заполнение сохраняет историю, аудит, ответственного и записи в корзине.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE utility_accounts DISABLE TRIGGER USER;
UPDATE utility_accounts SET data=jsonb_set(data,'{readingRule,warnings}','[0]'::jsonb)
 WHERE data#>'{readingRule,warnings}'='[]'::jsonb;
UPDATE utility_accounts SET data=jsonb_set(data,'{paymentRule,warnings}','[3,0]'::jsonb)
 WHERE data#>'{paymentRule,warnings}'='[]'::jsonb;
ALTER TABLE utility_accounts ENABLE TRIGGER USER;
DO $$ DECLARE a record; r jsonb; BEGIN
 FOR a IN SELECT * FROM public.utility_accounts LOOP
  r:=a.data->'readingRule';
  IF a.data->'transmission'->>'method' IN ('automatic','not_required') THEN r:=NULL; END IF;
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',coalesce(r->'warnings','[0]'::jsonb),'endWarnings',coalesce(r->'endWarnings','[1,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('readings',a.id,a.parent_id,a.author_id,r,a.deleted_at);
  r:=a.data->'paymentRule';
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   r:=r || jsonb_build_object('warningTime',coalesce(r->>'warningTime','09:00'),'warnings',coalesce(r->'warnings','[3,0]'::jsonb));
  END IF;
  PERFORM app.put_utility_deadline('payment',a.id,a.parent_id,a.author_id,r,a.deleted_at);
 END LOOP;
 FOR a IN SELECT * FROM public.meters LOOP
  r:=CASE WHEN a.data->>'nextVerificationOn' IS NOT NULL AND a.data->>'status'='active' THEN
   jsonb_build_object('kind','date','date',a.data->>'nextVerificationOn','time','00:00','durationDays',0,'warnings',coalesce(a.data->'verificationWarnings','[60,30,7]'::jsonb),'warningTime',coalesce(a.data->>'verificationWarningTime','09:00')) END;
  PERFORM app.put_utility_deadline('verification',a.id,a.parent_id,a.author_id,r,a.deleted_at);
 END LOOP;
END $$;
DROP POLICY utility_seed ON objects;
DROP POLICY utility_seed ON utility_accounts;
DROP POLICY utility_seed ON meters;
DROP POLICY utility_seed ON space_members;
DROP POLICY utility_seed ON deadlines;

--> statement-breakpoint
-- Существующие UUID, статусы доставок и ручные отметки сохраняются.
CREATE POLICY deadlines_fixes_seed ON deadlines TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY deadlines_fixes_seed ON deadline_occurrences TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY deadlines_fixes_seed ON deadline_notifications TO homecrm_owner USING (true) WITH CHECK (true);
UPDATE deadline_notifications n SET notification_kind=CASE d.source_kind
 WHEN 'readings' THEN CASE
   WHEN coalesce(d.rule->'endWarnings','[]'::jsonb) @> to_jsonb(ARRAY[((o.ends_at AT TIME ZONE o.time_zone)::date-(n.warning_at AT TIME ZONE o.time_zone)::date)])
    THEN CASE WHEN (n.warning_at AT TIME ZONE o.time_zone)::date=(o.ends_at AT TIME ZONE o.time_zone)::date THEN 'readings_last_day' ELSE 'readings_closing' END
   ELSE 'readings_open' END
 WHEN 'payment' THEN CASE WHEN (n.warning_at AT TIME ZONE o.time_zone)::date=(o.starts_at AT TIME ZONE o.time_zone)::date THEN 'payment_due' ELSE 'payment_upcoming' END
 WHEN 'verification' THEN 'verification' ELSE 'deadline' END
 FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE n.occurrence_id=o.id;
DROP POLICY deadlines_fixes_seed ON deadline_notifications;
DROP POLICY deadlines_fixes_seed ON deadline_occurrences;
DROP POLICY deadlines_fixes_seed ON deadlines;
