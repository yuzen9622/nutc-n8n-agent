BEGIN;
CREATE TABLE campus_runtime_key (
  id integer PRIMARY KEY CHECK (id = 1),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
