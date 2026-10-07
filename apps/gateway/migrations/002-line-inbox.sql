-- Additive migration; apply explicitly to campus_agent as its owner.
BEGIN;
CREATE TABLE IF NOT EXISTS campus_identities (
  user_id TEXT PRIMARY KEY,
  invited BOOLEAN NOT NULL DEFAULT false,
  revoked BOOLEAN NOT NULL DEFAULT false,
  generation BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campus_inbox (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campus_tasks (
  id UUID PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES campus_inbox(event_id),
  user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
  generation BIGINT NOT NULL,
  prompt TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','cancelled','failed')),
  lease UUID,
  leased_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_tasks_pending_idx ON campus_tasks(state,created_at);
CREATE TABLE IF NOT EXISTS campus_outbox (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL UNIQUE REFERENCES campus_tasks(id),
  user_id TEXT NOT NULL REFERENCES campus_identities(user_id),
  generation BIGINT NOT NULL,
  reply TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','cancelled','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
