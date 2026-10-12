ALTER TABLE "deadline_notifications" DROP CONSTRAINT "deadline_notifications_source";--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD COLUMN "summary_id" uuid;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_notifications" ADD CONSTRAINT "deadline_notifications_source" CHECK ((occurrence_id IS NOT NULL AND event_key IS NULL AND record_id IS NULL AND record_table IS NULL AND event_kind IS NULL AND event_household_id IS NULL) OR (occurrence_id IS NULL AND event_key IS NOT NULL AND record_id IS NOT NULL AND ((record_table IN ('tasks','objects','documents','deadlines') AND event_kind IN ('assignment','task_done')) OR (record_table='summaries' AND event_kind='summary')) AND event_household_id IS NOT NULL));GRANT SELECT(household_id,status,done_at) ON tasks TO homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.radar_occurrence_open(oid uuid, moment timestamptz, recipient uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT d.deleted_at IS NULL AND NOT d.needs_refresh AND o.deleted_at IS NULL AND (o.completed_at IS NULL OR d.source_kind='readings')
 AND d.assignee_id=recipient AND EXISTS(SELECT 1 FROM public.space_members m WHERE m.space_id=d.household_id AND m.account_id=recipient AND m.left_at IS NULL)
 AND (CASE WHEN d.source_kind='birthday' THEN app.birthday_delivery_name(d.contact_id,d.profile_account_id,recipient) IS NOT NULL AND o.ends_at>=moment ELSE app.record_notification_visible('deadlines',d.id,recipient) END)
 AND (d.source_kind<>'payment' OR app.utility_payment_open(d.utility_account_id,d.charge_id,o.date))
 AND (d.source_kind<>'readings' OR app.utility_window_open(d.utility_account_id,o.starts_at,o.ends_at,o.time_zone))
 AND NOT EXISTS(SELECT 1 FROM public.radar_actions a WHERE a.deadline_id=d.id AND a.calendar_key=app.radar_calendar_key(d.rule) AND a.date=o.date AND (a.status IN ('dismissed','completed') OR a.status='snoozed' AND a.snoozed_until>moment))
 FROM public.deadline_occurrences o JOIN public.deadlines d ON d.id=o.deadline_id WHERE o.id=oid),false);
$$;
REVOKE ALL ON FUNCTION app.radar_occurrence_open(uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.radar_occurrence_open(uuid,timestamptz,uuid) TO homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.summary_event_current(nid uuid, moment timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE n record; enabled jsonb; kind text;
BEGIN
 SELECT * INTO n FROM public.deadline_notifications WHERE id=nid;
 IF n.id IS NULL OR n.status NOT IN ('summary','pending','sent') OR n.record_table='summaries' THEN RETURN false; END IF;
 SELECT enabled_kinds INTO enabled FROM public.notification_settings WHERE account_id=n.recipient_id;
 enabled:=coalesce(enabled,'["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification","document","task_reminder","task_assignment","task_done"]'::jsonb);
 kind:=CASE WHEN n.record_table='tasks' AND n.event_kind='assignment' THEN 'task_assignment' WHEN n.event_kind='task_done' THEN 'task_done' WHEN n.event_kind='assignment' THEN 'deadline' ELSE n.notification_kind END;
 IF NOT enabled ? kind THEN RETURN false; END IF;
 IF n.occurrence_id IS NOT NULL THEN RETURN app.radar_occurrence_open(n.occurrence_id,moment,n.recipient_id); END IF;
 RETURN app.record_notification_current(n.record_table,n.record_id,n.recipient_id,n.event_kind,n.event_key);
END; $$;
REVOKE ALL ON FUNCTION app.summary_event_current(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.summary_event_current(uuid,timestamptz) TO homecrm_worker;
--> statement-breakpoint
-- Только служебные моменты подтверждённых действий, без текстов записей.
GRANT SELECT(status,updated_at) ON documents TO homecrm_worker;
GRANT SELECT(created_at,cancelled_at) ON utility_payments TO homecrm_worker;
CREATE POLICY utility_payments_summary_worker ON utility_payments FOR SELECT TO homecrm_worker USING (EXISTS(SELECT 1 FROM utility_charges c WHERE c.id=parent_id));
GRANT SELECT(changed_at) ON radar_actions TO homecrm_worker;

