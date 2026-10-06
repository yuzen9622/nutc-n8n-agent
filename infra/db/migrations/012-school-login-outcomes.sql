ALTER TABLE campus_school_login_attempts
 ADD COLUMN outcome text NOT NULL DEFAULT 'legacy_unknown'
 CHECK (outcome IN ('legacy_unknown','pending','success','technical_failure','credentials_rejected','account_locked')),
 ADD COLUMN completed_at timestamptz;
-- Previous attempts lack a recorded cause; never relabel them as bad passwords.
ALTER TABLE campus_school_login_attempts ALTER COLUMN outcome SET DEFAULT 'pending';
