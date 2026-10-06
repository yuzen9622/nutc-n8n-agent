BEGIN;
CREATE TABLE IF NOT EXISTS campus_sources (
  source_id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  current_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','withdrawn')),
  fetched_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS campus_source_versions (
  source_id TEXT NOT NULL REFERENCES campus_sources(source_id),
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  PRIMARY KEY(source_id,version)
);
CREATE TABLE IF NOT EXISTS campus_task_evidence (
  task_id UUID NOT NULL REFERENCES campus_tasks(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  version TEXT NOT NULL,
  lease UUID NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('web','knowledge')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,source_id,version),
  FOREIGN KEY(source_id,version) REFERENCES campus_source_versions(source_id,version)
);
CREATE TABLE IF NOT EXISTS campus_outbox_sources (
  outbox_id UUID NOT NULL REFERENCES campus_outbox(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY(outbox_id,source_id),
  FOREIGN KEY(source_id,version) REFERENCES campus_source_versions(source_id,version)
);
CREATE TABLE IF NOT EXISTS campus_usage_reservations (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES campus_tasks(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK(provider IN ('gemini','embedding','brave')),
  amount_micro_usd BIGINT NOT NULL CHECK(amount_micro_usd>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_usage_day_idx ON campus_usage_reservations(created_at);
COMMIT;
