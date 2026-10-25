DROP POLICY "ai_usage_member" ON "ai_daily_usage" CASCADE;--> statement-breakpoint
CREATE POLICY "ai_usage_consume" ON "ai_daily_usage" AS PERMISSIVE FOR INSERT TO "homecrm_app" WITH CHECK (house_id IN (SELECT s.id FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE s.kind='household' AND s.ai_enabled AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND usage_date=(now() AT TIME ZONE coalesce(s.time_zone,'UTC'))::date));--> statement-breakpoint
CREATE POLICY "ai_usage_increment" ON "ai_daily_usage" AS PERMISSIVE FOR ALL TO "homecrm_owner" USING (pg_trigger_depth()=1) WITH CHECK (pg_trigger_depth()=1);--> statement-breakpoint
CREATE POLICY "ai_usage_member" ON "ai_daily_usage" AS PERMISSIVE FOR SELECT TO "homecrm_app" USING (house_id IN (SELECT space_id FROM space_members WHERE account_id=app.current_account_id() AND left_at IS NULL));
--> statement-breakpoint
REVOKE UPDATE ON ai_daily_usage FROM homecrm_app;
-- Проверка вызывающего идёт раньше закрытого триггера: чужой дом не даёт
-- даже косвенно сравнить счётчик с переданным пределом по результату INSERT.
CREATE FUNCTION app.authorize_ai_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.spaces s JOIN public.space_members m ON m.space_id=s.id
  WHERE s.id=NEW.house_id AND s.kind='household' AND s.ai_enabled
   AND m.account_id=app.current_account_id() AND m.left_at IS NULL
   AND NEW.usage_date=(now() AT TIME ZONE coalesce(s.time_zone,'UTC'))::date)
 THEN RAISE EXCEPTION 'AI usage denied' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.authorize_ai_usage() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER ai_usage_00_authorize BEFORE INSERT ON ai_daily_usage FOR EACH ROW EXECUTE FUNCTION app.authorize_ai_usage();
-- FORCE RLS сохраняется. Приложение может только подать запрос на расход;
-- закрытый триггер монотонно заменяет счётчик, не получая доступа к другим таблицам.
CREATE FUNCTION app.increment_ai_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE used integer; request_limit integer:=NEW.requests;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.house_id::text||':'||NEW.usage_date::text,0));
 SELECT requests INTO used FROM public.ai_daily_usage WHERE house_id=NEW.house_id AND usage_date=NEW.usage_date;
 IF request_limit<1 OR coalesce(used,0)>=request_limit THEN RETURN NULL; END IF;
 DELETE FROM public.ai_daily_usage WHERE house_id=NEW.house_id AND usage_date=NEW.usage_date;
 NEW.requests:=coalesce(used,0)+1;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.increment_ai_usage() FROM PUBLIC,homecrm_app,homecrm_worker,homecrm_auth;
CREATE TRIGGER ai_usage_increment BEFORE INSERT ON ai_daily_usage FOR EACH ROW EXECUTE FUNCTION app.increment_ai_usage();
CREATE OR REPLACE FUNCTION app.consume_ai_request(house uuid, daily_limit integer) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE used integer; day date;
BEGIN
 IF daily_limit<1 OR NOT EXISTS (SELECT 1 FROM public.space_members WHERE space_id=house AND account_id=app.current_account_id() AND left_at IS NULL) THEN RETURN false; END IF;
 SELECT (now() AT TIME ZONE coalesce(time_zone,'UTC'))::date INTO day FROM public.spaces WHERE id=house AND kind='household' AND ai_enabled;
 IF day IS NULL THEN RETURN false; END IF;
 INSERT INTO public.ai_daily_usage VALUES(house,day,daily_limit) RETURNING requests INTO used;
 RETURN used IS NOT NULL;
END $$;
