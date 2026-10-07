-- Keep explicit, unrecognized school login rejection distinct from a wrong
-- password and from technical failures; both rejection categories are throttled.
ALTER TABLE campus_school_login_attempts
 DROP CONSTRAINT campus_school_login_attempts_outcome_check;
ALTER TABLE campus_school_login_attempts
 ADD CONSTRAINT campus_school_login_attempts_outcome_check
 CHECK (outcome IN ('legacy_unknown','pending','success','technical_failure',
                   'credentials_rejected','account_locked',
                   'authentication_rejected'));
