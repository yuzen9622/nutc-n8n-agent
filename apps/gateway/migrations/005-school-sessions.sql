BEGIN;
CREATE TABLE IF NOT EXISTS campus_school_sessions (
 user_id TEXT PRIMARY KEY REFERENCES campus_identities(user_id),
 id UUID NOT NULL UNIQUE,
 account_hash TEXT NOT NULL UNIQUE,
 encrypted_cookies TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '8 hours'
);
CREATE TABLE IF NOT EXISTS campus_school_login_attempts (
 id UUID PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
 account_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_school_login_user_idx ON campus_school_login_attempts(user_id,created_at);
CREATE INDEX IF NOT EXISTS campus_school_login_account_idx ON campus_school_login_attempts(account_hash,created_at);
CREATE TABLE IF NOT EXISTS campus_school_login_jobs (
 id UUID PRIMARY KEY REFERENCES campus_school_login_attempts(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL UNIQUE REFERENCES campus_identities(user_id),
 account_hash TEXT NOT NULL UNIQUE,
 generation BIGINT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '35 seconds'
);
-- Revocation removes durable cookies and login leases in the same identity transaction.
-- Clearing chat rotates its generation but does not log the student out of school.
CREATE OR REPLACE FUNCTION campus_revoke_school_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked OR NOT NEW.invited THEN
  DELETE FROM campus_school_sessions WHERE user_id=NEW.user_id;
  DELETE FROM campus_school_login_jobs WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS campus_school_identity_revoke ON campus_identities;
CREATE TRIGGER campus_school_identity_revoke AFTER UPDATE OF revoked,invited ON campus_identities
FOR EACH ROW EXECUTE FUNCTION campus_revoke_school_session();
COMMIT;
