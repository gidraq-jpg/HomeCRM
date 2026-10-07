-- Custom SQL migration file, put your code below! --
-- Сервер проверяет доступ к контакту в том же запросе UNION ALL, отдельно от политики события.
CREATE FUNCTION app.record_ref_facts(tbl text, rid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT app.record_ref_allowed(tbl,rid,false) THEN RETURN NULL; END IF;
  EXECUTE format('SELECT jsonb_build_object(''spaceId'',r.space_id,''spaceKind'',r.space_kind,''audience'',r.audience,''ownerId'',s.owner_account_id) FROM public.%I r LEFT JOIN public.spaces s ON s.id=r.space_id WHERE r.id=$1',tbl) INTO result USING rid;
  RETURN result;
END;
$$;
--> statement-breakpoint
-- Восстановление полей тоже сериализовано с лимитом, даже когда содержимое не меняется.
CREATE OR REPLACE FUNCTION app.object_field_limits() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'homecrm_worker' THEN RETURN NEW; END IF;
  IF length(NEW.title) NOT BETWEEN 1 AND 100 OR length(NEW.value) > 4000 OR NEW.position NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'invalid field' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deleted_at IS NULL THEN
    PERFORM id FROM public.objects WHERE id=NEW.parent_id FOR UPDATE;
    IF (SELECT count(*) FROM public.object_fields f WHERE f.parent_id=NEW.parent_id AND f.deleted_at IS NULL AND f.id<>NEW.id) >= 50 THEN
      RAISE EXCEPTION 'too many fields' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
