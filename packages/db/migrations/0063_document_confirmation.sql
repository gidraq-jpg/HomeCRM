ALTER TABLE "documents" ADD COLUMN "invalidated_at" timestamp with time zone;
--> statement-breakpoint
-- Точный переход есть только в истории (в том числе личных документов). Прежнее invalid без события
-- сохраняют NULL: updated_at и дата новой версии сами по себе не доказывают момент перехода.
-- Временные политики и отключение триггеров живут только в транзакции миграции:
-- не меняем прежнее updated_at, историю, вклад участников и производные сроки/поиск.
CREATE POLICY document_confirmation_backfill ON documents FOR ALL TO homecrm_owner USING (true) WITH CHECK (true);
CREATE POLICY document_confirmation_history_backfill ON documents_history FOR SELECT TO homecrm_owner USING (true);
ALTER TABLE documents DISABLE TRIGGER USER;
UPDATE documents d SET invalidated_at=h.at
FROM (
 SELECT record_id,max(created_at) AS at FROM documents_history
 WHERE changes->'status'->>'new'='invalid'
 AND (changes->'status'->>'old'='valid' OR operation='create')
 GROUP BY record_id
) h WHERE d.id=h.record_id AND d.status='invalid';
ALTER TABLE documents ENABLE TRIGGER USER;
DROP POLICY document_confirmation_history_backfill ON documents_history;
DROP POLICY document_confirmation_backfill ON documents;
--> statement-breakpoint
-- База фиксирует смену статуса на всех путях, включая продление и прямые разрешённые
-- операции роли приложения. Повторное назначение, правка, перенос и корзина её не меняют.
CREATE FUNCTION app.document_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.invalidated_at := CASE WHEN NEW.status='invalid' THEN now() ELSE NULL END;
 ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status='invalid' THEN
  NEW.invalidated_at := now();
 ELSE
  NEW.invalidated_at := OLD.invalidated_at;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app.document_confirmation() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER documents_01_confirmation BEFORE INSERT OR UPDATE ON documents
 FOR EACH ROW EXECUTE FUNCTION app.document_confirmation();
--> statement-breakpoint
-- Worker читает только устойчивый служебный момент, без текстов и истории.
REVOKE SELECT(updated_at) ON documents FROM homecrm_worker;
GRANT SELECT(invalidated_at) ON documents TO homecrm_worker;
