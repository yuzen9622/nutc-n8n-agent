CREATE TABLE campus_private_results (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES campus_tasks(id) ON DELETE CASCADE,
 lease uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('schedule','absence','announcements')),
 school_session_id uuid NOT NULL,
 encrypted_reply text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 UNIQUE(task_id,lease,operation)
);
ALTER TABLE campus_outbox ADD COLUMN encrypted boolean NOT NULL DEFAULT false;
ALTER TABLE campus_outbox ADD COLUMN school_session_id uuid;
CREATE FUNCTION campus_clear_private_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM campus_private_results p USING campus_tasks t WHERE p.task_id=t.id AND t.user_id=NEW.user_id;
 RETURN NEW;
END $$;
CREATE TRIGGER campus_identity_private_cleanup AFTER UPDATE OF generation,revoked,invited ON campus_identities
 FOR EACH ROW EXECUTE FUNCTION campus_clear_private_results();
