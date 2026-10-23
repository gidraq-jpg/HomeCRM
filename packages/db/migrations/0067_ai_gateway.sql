CREATE TABLE "ai_daily_usage" (
	"house_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"requests" integer NOT NULL,
	CONSTRAINT "ai_daily_usage_house_id_usage_date_pk" PRIMARY KEY("house_id","usage_date"),
	CONSTRAINT "ai_daily_usage_requests_check" CHECK ("ai_daily_usage"."requests" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_daily_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_daily_usage" ADD CONSTRAINT "ai_daily_usage_house_id_spaces_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "ai_usage_member" ON "ai_daily_usage" AS PERMISSIVE FOR ALL TO "homecrm_app" USING (house_id IN (SELECT space_id FROM space_members WHERE account_id=app.current_account_id() AND left_at IS NULL)) WITH CHECK (house_id IN (SELECT space_id FROM space_members WHERE account_id=app.current_account_id() AND left_at IS NULL));
--> statement-breakpoint
ALTER TABLE ai_daily_usage FORCE ROW LEVEL SECURITY;
GRANT UPDATE(ai_enabled) ON spaces TO homecrm_app;
GRANT SELECT, INSERT, UPDATE ON ai_daily_usage TO homecrm_app;
--> statement-breakpoint
CREATE FUNCTION app.consume_ai_request(house uuid, daily_limit integer) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE used integer; day date;
BEGIN
 IF daily_limit < 1 OR NOT EXISTS (SELECT 1 FROM space_members WHERE space_id=house AND account_id=app.current_account_id() AND left_at IS NULL) THEN RETURN false; END IF;
 SELECT (now() AT TIME ZONE coalesce(time_zone,'UTC'))::date INTO day FROM spaces WHERE id=house AND kind='household' AND ai_enabled;
 IF day IS NULL THEN RETURN false; END IF;
 INSERT INTO ai_daily_usage VALUES(house,day,1) ON CONFLICT(house_id,usage_date) DO UPDATE SET requests=ai_daily_usage.requests+1 WHERE ai_daily_usage.requests < daily_limit RETURNING requests INTO used;
 RETURN used IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION app.consume_ai_request(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_ai_request(uuid,integer) TO homecrm_app;
CREATE FUNCTION app.ai_remaining(house uuid, daily_limit integer) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT greatest(0,daily_limit-coalesce((SELECT requests FROM ai_daily_usage u WHERE u.house_id=house AND u.usage_date=(now() AT TIME ZONE coalesce(s.time_zone,'UTC'))::date),0)) FROM spaces s WHERE s.id=house AND s.kind='household' AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=house AND m.account_id=app.current_account_id() AND m.left_at IS NULL)
$$;
REVOKE ALL ON FUNCTION app.ai_remaining(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_remaining(uuid,integer) TO homecrm_app;
