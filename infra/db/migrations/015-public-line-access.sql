BEGIN;
-- Public LINE access: only revoked/generation control authority. The legacy invited
-- column is retained for old-schema compatibility and no longer affects anything.
COMMENT ON COLUMN campus_identities.invited IS 'Deprecated by migration 015: ignored for access, cleanup and authorization.';

CREATE OR REPLACE FUNCTION campus_guard_memory_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM campus_conversations c JOIN campus_identities i ON i.user_id=c.user_id
    WHERE c.session_key=NEW.session_id AND c.generation=i.generation AND NOT i.revoked
    FOR SHARE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_SESSION_REVOKED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION campus_revoke_school_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked THEN
  DELETE FROM campus_school_sessions WHERE user_id=NEW.user_id;
  DELETE FROM campus_school_login_jobs WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION campus_clear_grounded_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation IS DISTINCT FROM OLD.generation OR NEW.revoked THEN
    UPDATE campus_tasks SET grounded_reply=NULL,grounded_at=NULL WHERE user_id=NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campus_school_identity_revoke ON campus_identities;
CREATE TRIGGER campus_school_identity_revoke AFTER UPDATE OF revoked ON campus_identities
  FOR EACH ROW EXECUTE FUNCTION campus_revoke_school_session();
DROP TRIGGER IF EXISTS campus_identity_liff_cleanup ON campus_identities;
CREATE TRIGGER campus_identity_liff_cleanup AFTER UPDATE OF generation,revoked ON campus_identities
  FOR EACH ROW EXECUTE FUNCTION campus_expire_liff_sessions();
DROP TRIGGER IF EXISTS campus_identity_private_cleanup ON campus_identities;
CREATE TRIGGER campus_identity_private_cleanup AFTER UPDATE OF generation,revoked ON campus_identities
  FOR EACH ROW EXECUTE FUNCTION campus_clear_private_results();
DROP TRIGGER IF EXISTS campus_grounded_identity_cleanup ON campus_identities;
CREATE TRIGGER campus_grounded_identity_cleanup AFTER UPDATE OF generation,revoked ON campus_identities
  FOR EACH ROW EXECUTE FUNCTION campus_clear_grounded_results();
COMMIT;
