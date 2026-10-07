CREATE TABLE campus_liff_sessions (
 token_hash text PRIMARY KEY,
 csrf_hash text NOT NULL,
 user_id text NOT NULL REFERENCES campus_identities(user_id) ON DELETE CASCADE,
 generation bigint NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX campus_liff_sessions_expiry ON campus_liff_sessions(expires_at);
CREATE FUNCTION campus_expire_liff_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM campus_liff_sessions WHERE user_id=NEW.user_id;
 RETURN NEW;
END $$;
CREATE TRIGGER campus_identity_liff_cleanup AFTER UPDATE OF generation,revoked,invited ON campus_identities
 FOR EACH ROW EXECUTE FUNCTION campus_expire_liff_sessions();
