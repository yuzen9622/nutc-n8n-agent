BEGIN;
-- Grounded results are owner-only chat history, never shared evidence or RAG.
ALTER TABLE campus_tasks ADD COLUMN grounded_reply text;
ALTER TABLE campus_tasks ADD COLUMN grounded_at timestamptz;
CREATE FUNCTION campus_clear_grounded_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation IS DISTINCT FROM OLD.generation OR NEW.revoked OR NOT NEW.invited THEN
    UPDATE campus_tasks SET grounded_reply=NULL,grounded_at=NULL WHERE user_id=NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campus_grounded_identity_cleanup AFTER UPDATE OF generation,revoked,invited ON campus_identities
FOR EACH ROW EXECUTE FUNCTION campus_clear_grounded_results();
COMMIT;
