ALTER TABLE "api_operations" DROP CONSTRAINT "api_operations_operation";--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "data" jsonb DEFAULT '{"note":"","store":"","category":""}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_operations" ADD COLUMN "receipt" jsonb;--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_operation" CHECK (operation IN ('contact_import','charge','payment','task_create','task_patch','task_status','radar_action','note_create','note_patch','reading_create','readings_create','file_upload','shopping_create','shopping_patch','shopping_bought','shopping_trash','shopping_restore'));--> statement-breakpoint
CREATE POLICY "shopping_items_bought_cleanup_select" ON "shopping_items" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (bought_at<=clock_timestamp()-interval '7 days');--> statement-breakpoint
CREATE POLICY "shopping_items_bought_cleanup_update" ON "shopping_items" AS PERMISSIVE FOR UPDATE TO "homecrm_worker" USING (deleted_at IS NULL AND bought_at<=clock_timestamp()-interval '7 days') WITH CHECK (deleted_at IS NOT NULL AND bought_at<=clock_timestamp()-interval '7 days');
--> statement-breakpoint
SELECT app.grant_record_table('shopping_items');
GRANT SELECT(bought_at) ON shopping_items TO homecrm_worker;
GRANT UPDATE(deleted_at) ON shopping_items TO homecrm_worker;
GRANT SELECT(receipt),INSERT(receipt) ON api_operations TO homecrm_app;
--> statement-breakpoint
-- Служебная уборка меняет только корзину, без права читать пользовательские тексты.
DO $guard$
DECLARE definition text:=pg_get_functiondef('app.record_guard()'::regprocedure);
BEGIN
 definition:=replace(definition,
  '(NEW.title, to_jsonb(NEW)->>''quantity'', to_jsonb(NEW)->>''bought_at'') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>''quantity'', to_jsonb(OLD)->>''bought_at'')',
  '(NEW.title, to_jsonb(NEW)->>''quantity'', to_jsonb(NEW)->>''bought_at'', to_jsonb(NEW)->''data'') IS DISTINCT FROM (OLD.title, to_jsonb(OLD)->>''quantity'', to_jsonb(OLD)->>''bought_at'', to_jsonb(OLD)->''data'')');
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n IF TG_TABLE_NAME=''shopping_items'' AND current_user=''homecrm_worker'' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN\n  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL OR (to_jsonb(OLD)->>''bought_at'') IS NULL OR (to_jsonb(OLD)->>''bought_at'')::timestamptz>clock_timestamp()-interval ''7 days'' OR (to_jsonb(NEW)-ARRAY[''deleted_at'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag'']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY[''deleted_at'',''updated_at'',''assignee_house_id'',''assignee_adult_id'',''assignee_adult_flag'']) THEN\n   RAISE EXCEPTION ''shopping cleanup changes only expired bought trash'' USING ERRCODE=''insufficient_privilege'';\n  END IF;\n END IF;\n');
 EXECUTE definition;
END; $guard$;
--> statement-breakpoint
CREATE FUNCTION app.cleanup_bought_shopping() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.shopping_items SET deleted_at=clock_timestamp()
 WHERE deleted_at IS NULL AND bought_at<=clock_timestamp()-interval '7 days';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END; $$;
REVOKE ALL ON FUNCTION app.cleanup_bought_shopping() FROM PUBLIC,homecrm_app,homecrm_auth;
GRANT EXECUTE ON FUNCTION app.cleanup_bought_shopping() TO homecrm_worker;
--> statement-breakpoint
-- Любая содержательная правка/корзина пункта меняет версию родителя под той же блокировкой.
CREATE OR REPLACE FUNCTION app.lock_note_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parents uuid[]; parent_row public.notes; changed boolean:=true; content_changed boolean:=true;
BEGIN
 IF current_user='homecrm_worker' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  parents:=ARRAY[OLD.parent_id,NEW.parent_id];
  changed:=(NEW.title,NEW.done,NEW.position,NEW.parent_id,NEW.deleted_at)
   IS DISTINCT FROM (OLD.title,OLD.done,OLD.position,OLD.parent_id,OLD.deleted_at);
  content_changed:=(NEW.title,NEW.done,NEW.position,NEW.parent_id)
   IS DISTINCT FROM (OLD.title,OLD.done,OLD.position,OLD.parent_id);
 ELSE parents:=ARRAY[NEW.parent_id]; END IF;
 FOR parent_row IN SELECT n.* FROM public.notes n WHERE n.id=ANY(parents) ORDER BY n.id FOR UPDATE LOOP
  IF changed THEN
   UPDATE public.notes SET has_other_contributions=parent_row.has_other_contributions OR
    (content_changed AND parent_row.space_kind='household' AND app.current_account_id() IS NOT NULL AND parent_row.author_id<>app.current_account_id())
   WHERE id=parent_row.id;
  END IF;
 END LOOP;
 RETURN NEW;
END; $$;
--> statement-breakpoint
DO $search$
DECLARE definition text:=pg_get_functiondef('app.sync_search_entry()'::regprocedure);
BEGIN
 definition:=regexp_replace(definition,'TG_TABLE_NAME NOT IN \(([^)]*)\)', 'TG_TABLE_NAME NOT IN (\1,''shopping_items'')');
 definition:=replace(definition,'INSERT INTO public.search_index',E'IF TG_TABLE_NAME=''shopping_items'' THEN\n content:=NEW.title || '' '' || coalesce(d->>''quantity'','''') || '' '' || coalesce(d->''data''->>''note'','''') || '' '' || coalesce(d->''data''->>''store'','''') || '' '' || coalesce(d->''data''->>''category'','''');\n END IF;\n INSERT INTO public.search_index');
 EXECUTE definition;
END; $search$;
CREATE TRIGGER shopping_items_search AFTER INSERT OR UPDATE OR DELETE ON shopping_items FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry('shopping_item');
--> statement-breakpoint
-- Старые данные/время/история не переписываются; политики существуют только внутри миграции.
CREATE POLICY shopping_search_backfill ON shopping_items FOR SELECT TO homecrm_owner USING (true);
CREATE POLICY shopping_index_backfill ON search_index FOR ALL TO homecrm_owner USING (true) WITH CHECK (true);
INSERT INTO search_index(source_type,source_id,access_key,target_id,space_id,space_kind,audience,owner_id,author_id,title,content)
 SELECT 'shopping_item',id,space_id::text||':'||coalesce(audience::text,'personal'),id,space_id,space_kind,audience,CASE WHEN space_kind='personal' THEN assignee_id END,author_id,title,title||' '||coalesce(quantity,'')||' '||coalesce(data->>'note','')||' '||coalesce(data->>'store','')||' '||coalesce(data->>'category','')
 FROM shopping_items WHERE deleted_at IS NULL;
DROP POLICY shopping_search_backfill ON shopping_items;
DROP POLICY shopping_index_backfill ON search_index;
