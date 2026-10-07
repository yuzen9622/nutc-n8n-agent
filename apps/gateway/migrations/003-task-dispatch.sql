BEGIN;
ALTER TABLE campus_tasks ADD COLUMN IF NOT EXISTS capability_hash TEXT;
ALTER TABLE campus_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE campus_tasks ADD COLUMN IF NOT EXISTS tool_calls INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS campus_conversations (
  session_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
  generation BIGINT NOT NULL,
  UNIQUE(user_id,generation)
);
CREATE TABLE IF NOT EXISTS live_agent_chat_histories (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_agent_chat_session_idx ON live_agent_chat_histories(session_id,id);
-- Native n8n Memory writes must pass the same identity generation lock as clear/revoke.
CREATE OR REPLACE FUNCTION campus_guard_memory_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM campus_conversations c JOIN campus_identities i ON i.user_id=c.user_id
    WHERE c.session_key=NEW.session_id AND c.generation=i.generation AND i.invited AND NOT i.revoked
    FOR SHARE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_SESSION_REVOKED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS campus_memory_identity ON live_agent_chat_histories;
CREATE TRIGGER campus_memory_identity BEFORE INSERT OR UPDATE ON live_agent_chat_histories
  FOR EACH ROW EXECUTE FUNCTION campus_guard_memory_insert();
COMMIT;
