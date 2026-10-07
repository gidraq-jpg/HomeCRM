-- OBJ-4: фото профиля не наследует доступ заметок или объектов.
ALTER TABLE profile_files FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON profile_files TO homecrm_app;
GRANT UPDATE(deleted_at) ON profile_files TO homecrm_app;
GRANT SELECT(id,storage_key,preview_storage_key,deleted_at), DELETE ON profile_files TO homecrm_worker;
--> statement-breakpoint
CREATE FUNCTION app.profile_file_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.file_blobs WHERE key IN (OLD.storage_key, OLD.preview_storage_key);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)-'deleted_at') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at') THEN
    RAISE EXCEPTION 'profile file content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.size_bytes < 1 OR NEW.size_bytes > 26214400 OR NEW.mime_type NOT IN ('image/jpeg','image/png','image/webp')
    OR (NEW.preview_storage_key IS NULL) <> (NEW.preview_envelope IS NULL) THEN
    RAISE EXCEPTION 'invalid profile file metadata' USING ERRCODE = 'check_violation';
  END IF;
  IF app.current_account_id() IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'new profile file cannot be trashed' USING ERRCODE = 'insufficient_privilege';
    ELSIF OLD.deleted_at IS NULL THEN NEW.deleted_at := now();
    ELSE NEW.deleted_at := OLD.deleted_at;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_blobs(key) VALUES (NEW.storage_key);
    IF NEW.preview_storage_key IS NOT NULL THEN INSERT INTO public.file_blobs(key) VALUES (NEW.preview_storage_key); END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profile_files_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON profile_files FOR EACH ROW EXECUTE FUNCTION app.profile_file_lifecycle();
--> statement-breakpoint
-- Старые вложения и блоки остаются в своих карточках. Нельзя автоматически открыть
-- семейной аудитории изображение, которое раньше могло быть личным.
ALTER TABLE member_profiles NO FORCE ROW LEVEL SECURITY;
UPDATE member_profiles SET photo_file_id=NULL WHERE photo_file_id IS NOT NULL;
ALTER TABLE member_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_profile_file() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.photo_file_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_files f WHERE f.id=NEW.photo_file_id
      AND f.account_id=NEW.account_id AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'profile file unavailable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
