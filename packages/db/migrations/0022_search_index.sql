CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
-- SECURITY INVOKER: родитель читается под RLS вызывающего, без служебного обхода.
-- SET не даёт встроить вложенные политики objects в стоимость каждой строки общего поиска.
CREATE FUNCTION app.search_parent_visible(parent uuid) RETURNS boolean
LANGUAGE sql STABLE STRICT SECURITY INVOKER SET search_path = '' COST 10
AS $$ SELECT EXISTS (SELECT 1 FROM public.objects p WHERE p.id=parent AND p.deleted_at IS NULL) $$;
REVOKE ALL ON FUNCTION app.search_parent_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_parent_visible(uuid) TO homecrm_app;
--> statement-breakpoint
CREATE TABLE "search_index" (
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
  "access_key" text NOT NULL,
	"target_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"space_kind" "space_kind" NOT NULL,
	"audience" "audience",
	"owner_id" uuid,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"origin_space_id" uuid,
	"origin_space_kind" "space_kind",
	"origin_audience" "audience",
	"document" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian'::regconfig, content)) STORED,
	"digits" text GENERATED ALWAYS AS (regexp_replace(content, '[^0-9]', '', 'g')) STORED,
	CONSTRAINT "search_index_source_type_source_id_pk" PRIMARY KEY("source_type","source_id")
);
--> statement-breakpoint
ALTER TABLE "search_index" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "search_index_space_idx" ON "search_index" USING btree ("space_id","audience");--> statement-breakpoint
CREATE INDEX "search_index_document_idx" ON "search_index" USING gin ("access_key" text_ops,"document") WITH (fastupdate=off);--> statement-breakpoint
CREATE INDEX "search_index_content_idx" ON "search_index" USING gin ("access_key" text_ops,"content" gin_trgm_ops) WITH (fastupdate=off);--> statement-breakpoint
CREATE INDEX "search_index_digits_idx" ON "search_index" USING gin ("access_key" text_ops,"digits" gin_trgm_ops) WITH (fastupdate=off);--> statement-breakpoint
CREATE POLICY "search_index_select" ON "search_index" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (((
    (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = app.current_account_id()))
    OR (space_kind = 'household' AND (
      space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult'))
      OR (audience = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id() AND m.left_at IS NULL AND m.role IN ('admin', 'adult', 'child')))
    ))
  ) AND (
  source_type <> 'object_event' OR (
    app.placement_visible(origin_space_id,origin_space_kind,origin_audience)
    AND app.search_parent_visible(target_id)
  )
)) AND ((
  document @@ plainto_tsquery('russian', nullif(current_setting('app.search_query',true),''))
  OR content ILIKE current_setting('app.search_pattern',true) ESCAPE E'\\'
  OR digits LIKE current_setting('app.search_digit_pattern',true)
)));--> statement-breakpoint
CREATE POLICY "search_index_sync" ON "search_index" AS PERMISSIVE FOR ALL TO "homecrm_owner" USING (pg_trigger_depth() > 0) WITH CHECK (pg_trigger_depth() > 0);
--> statement-breakpoint
ALTER TABLE public.search_index FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.search_index TO homecrm_app;
--> statement-breakpoint
-- Закрытый триггер пишет только производную строку из NEW/OLD, исходные записи не читает.
CREATE FUNCTION app.sync_search_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d jsonb; source text := TG_ARGV[0]; content text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
    OR TG_TABLE_NAME NOT IN ('notes','note_items','objects','object_fields','object_events') THEN
    RAISE EXCEPTION 'invalid search source';
  END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.search_index WHERE source_type=source AND source_id=OLD.id;
    RETURN NULL;
  END IF;
  d := to_jsonb(NEW);
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.search_index WHERE source_type=source AND source_id=NEW.id;
    RETURN NULL;
  END IF;
  content := NEW.title || ' ' || coalesce(d->>'body','') || ' ' || coalesce(d->>'value','');
  INSERT INTO public.search_index(source_type,source_id,access_key,target_id,space_id,space_kind,audience,
    owner_id,author_id,title,content,origin_space_id,origin_space_kind,origin_audience)
  VALUES(source,NEW.id,NEW.space_id::text || ':' || coalesce(NEW.audience::text,'personal'),coalesce((d->>'parent_id')::uuid,NEW.id),NEW.space_id,NEW.space_kind,
    NEW.audience,CASE WHEN NEW.space_kind='personal' THEN NEW.assignee_id END,NEW.author_id,
    NEW.title,content,(d->>'origin_space_id')::uuid,(d->>'origin_space_kind')::public.space_kind,
    (d->>'origin_audience')::public.audience)
  ON CONFLICT(source_type,source_id) DO UPDATE SET
    access_key=EXCLUDED.access_key,target_id=EXCLUDED.target_id,space_id=EXCLUDED.space_id,space_kind=EXCLUDED.space_kind,
    audience=EXCLUDED.audience,owner_id=EXCLUDED.owner_id,author_id=EXCLUDED.author_id,
    title=EXCLUDED.title,content=EXCLUDED.content,origin_space_id=EXCLUDED.origin_space_id,
    origin_space_kind=EXCLUDED.origin_space_kind,origin_audience=EXCLUDED.origin_audience;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app.sync_search_entry() FROM PUBLIC,homecrm_app,homecrm_auth,homecrm_worker;
--> statement-breakpoint
DO $$
DECLARE src record;
BEGIN
  FOR src IN SELECT * FROM (VALUES ('notes','note'),('note_items','note_item'),
    ('objects','object'),('object_fields','object_field'),('object_events','object_event')) x(tbl,kind)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.sync_search_entry(%L)',src.tbl || '_search',src.tbl,src.kind);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Заполнение без UPDATE источников: даты, история и содержательный вклад не меняются.
-- NO FORCE и временная политика существуют только внутри общей транзакции миграций.
CREATE POLICY search_index_backfill ON public.search_index TO homecrm_owner USING (true) WITH CHECK (true);
DO $$
DECLARE src record;
BEGIN
  FOR src IN SELECT * FROM (VALUES ('notes','note'),('note_items','note_item'),
    ('objects','object'),('object_fields','object_field'),('object_events','object_event')) x(tbl,kind)
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY',src.tbl);
    EXECUTE format($q$INSERT INTO public.search_index(source_type,source_id,access_key,target_id,space_id,space_kind,
      audience,owner_id,author_id,title,content,origin_space_id,origin_space_kind,origin_audience)
      SELECT %L,r.id,r.space_id::text || ':' || coalesce(r.audience::text,'personal'),coalesce((to_jsonb(r)->>'parent_id')::uuid,r.id),r.space_id,r.space_kind,r.audience,
        CASE WHEN r.space_kind='personal' THEN r.assignee_id END,r.author_id,r.title,
        r.title || ' ' || coalesce(to_jsonb(r)->>'body','') || ' ' || coalesce(to_jsonb(r)->>'value',''),
        (to_jsonb(r)->>'origin_space_id')::uuid,(to_jsonb(r)->>'origin_space_kind')::public.space_kind,
        (to_jsonb(r)->>'origin_audience')::public.audience
      FROM public.%I r WHERE r.deleted_at IS NULL$q$,src.kind,src.tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',src.tbl);
  END LOOP;
END;
$$;
DROP POLICY search_index_backfill ON public.search_index;
