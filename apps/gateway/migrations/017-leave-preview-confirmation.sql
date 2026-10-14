BEGIN;
ALTER TABLE campus_tasks ADD COLUMN leave_controlled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campus_tasks ADD COLUMN leave_result_state TEXT;
ALTER TABLE campus_tasks ADD COLUMN leave_result_ciphertext TEXT;
ALTER TABLE campus_tasks ADD COLUMN leave_result_session_id UUID;
ALTER TABLE campus_tasks ADD COLUMN leave_preview_id UUID;
ALTER TABLE campus_tasks ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'line' CHECK(delivery_mode IN ('line','capture'));
CREATE TABLE campus_leave_previews (
 id UUID PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
 generation BIGINT NOT NULL,
 school_session_id UUID NOT NULL,
 origin_task_id UUID NOT NULL UNIQUE,
 preview_task_id UUID UNIQUE REFERENCES campus_tasks(id) ON DELETE SET NULL,
 preview_lease UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '5 minutes',
 presented_at TIMESTAMPTZ,
 state TEXT NOT NULL CHECK(state IN ('pending','attempted','succeeded','rejected','ambiguous','expired','cancelled')),
 confirm_task_id UUID REFERENCES campus_tasks(id) ON DELETE SET NULL,
 confirm_origin_task_id UUID,
 confirm_lease UUID,
 attempt_id UUID UNIQUE,
 attempted_at TIMESTAMPTZ,
 finished_at TIMESTAMPTZ,
 outcome_code TEXT,
 encrypted_payload TEXT,
 encrypted_before_ids TEXT,
 encrypted_outcome TEXT
);
CREATE UNIQUE INDEX campus_leave_one_pending ON campus_leave_previews(user_id,generation) WHERE state='pending';
CREATE INDEX campus_leave_owner ON campus_leave_previews(user_id,created_at);
CREATE FUNCTION campus_leave_cancel_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.generation IS DISTINCT FROM OLD.generation OR NEW.revoked THEN
  UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE user_id=NEW.user_id AND state='pending';
  UPDATE campus_tasks SET leave_result_ciphertext=NULL WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER campus_leave_identity AFTER UPDATE OF generation,revoked ON campus_identities FOR EACH ROW EXECUTE FUNCTION campus_leave_cancel_identity();
CREATE FUNCTION campus_leave_cancel_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.expires_at<=now() OR NEW.encrypted_cookies='' THEN
  UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE school_session_id=OLD.id AND state='pending';
  -- Never touch campus_tasks here: task completion locks task->session; inactive-session ciphertext is cleared by TaskRepository.cleanup.
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER campus_leave_session AFTER UPDATE OR DELETE ON campus_school_sessions FOR EACH ROW EXECUTE FUNCTION campus_leave_cancel_session();
COMMIT;
