CREATE POLICY "object_events_contact_purge_select" ON "object_events" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING ((pg_trigger_depth() > 0 AND nullif(current_setting('app.contact_purge_id',true),'') IS NOT NULL) AND ((contact_table = current_setting('app.contact_purge_table',true)
  AND contact_id = nullif(current_setting('app.contact_purge_id',true),'')::uuid) OR (contact_id IS NULL AND contact_table IS NULL)));--> statement-breakpoint
CREATE POLICY "object_events_contact_purge" ON "object_events" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING ((pg_trigger_depth() > 0 AND nullif(current_setting('app.contact_purge_id',true),'') IS NOT NULL) AND (contact_table = current_setting('app.contact_purge_table',true)
  AND contact_id = nullif(current_setting('app.contact_purge_id',true),'')::uuid)) WITH CHECK ((pg_trigger_depth() > 0 AND nullif(current_setting('app.contact_purge_id',true),'') IS NOT NULL) AND contact_id IS NULL AND contact_table IS NULL);--> statement-breakpoint
ALTER POLICY "object_events_select" ON "object_events" TO homecrm_app USING (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)));--> statement-breakpoint
ALTER POLICY "object_events_update" ON "object_events" TO homecrm_app USING (((deleted_at IS NULL AND ((
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
  )))) AND (((
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)) AND nullif(current_setting('app.object_cascade_id',true),'') IS NULL) OR (pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)))) WITH CHECK (((deleted_at IS NULL AND ((
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
  )))) AND (((
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)) AND nullif(current_setting('app.object_cascade_id',true),'') IS NULL) OR (pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz))));