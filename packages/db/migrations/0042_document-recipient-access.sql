ALTER TABLE "documents" ADD COLUMN "is_identity" boolean GENERATED ALWAYS AS (data->>'type' IN ('russian_passport','international_passport','birth_certificate','snils','inn','driver_license')) STORED;--> statement-breakpoint
GRANT SELECT(owner_account_id,is_identity) ON documents TO homecrm_worker;
--> statement-breakpoint
ALTER POLICY "documents_select" ON "documents" TO homecrm_app USING (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  )) AND (NOT (documents.is_identity AND documents.space_kind='household' AND EXISTS(SELECT 1 FROM space_members owner WHERE owner.space_id=documents.space_id AND owner.account_id=documents.owner_account_id AND owner.role='child') AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL))));--> statement-breakpoint
ALTER POLICY "documents_update" ON "documents" TO homecrm_app USING (((deleted_at IS NULL AND ((
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
  )))) AND (NOT (documents.is_identity AND documents.space_kind='household' AND EXISTS(SELECT 1 FROM space_members owner WHERE owner.space_id=documents.space_id AND owner.account_id=documents.owner_account_id AND owner.role='child') AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL)))) WITH CHECK (((deleted_at IS NULL AND ((
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
  )))) AND (NOT (documents.is_identity AND documents.space_kind='household' AND EXISTS(SELECT 1 FROM space_members owner WHERE owner.space_id=documents.space_id AND owner.account_id=documents.owner_account_id AND owner.role='child') AND EXISTS(SELECT 1 FROM space_members viewer WHERE viewer.space_id=documents.space_id AND viewer.account_id=app.current_account_id() AND viewer.role='child' AND viewer.left_at IS NULL))));
