BEGIN;
ALTER TABLE campus_tasks ADD COLUMN school_login_required BOOLEAN NOT NULL DEFAULT false;
COMMIT;
