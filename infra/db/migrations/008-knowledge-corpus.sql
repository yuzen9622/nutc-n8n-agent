BEGIN;
CREATE TABLE campus_knowledge_batches (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'staging' CHECK(state IN ('staging','published')),
  documents JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
-- Native n8n PGVector Insert writes here. Nothing staged is visible to the Agent.
CREATE TABLE campus_knowledge_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  metadata JSONB NOT NULL,
  embedding vector(3072) NOT NULL
);
CREATE INDEX campus_knowledge_staging_batch ON campus_knowledge_staging((metadata->>'batchId'));
CREATE TABLE campus_knowledge_chunks (
  id UUID PRIMARY KEY,
  source_id TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL,
  embedding vector(3072) NOT NULL,
  FOREIGN KEY(source_id,version) REFERENCES campus_source_versions(source_id,version)
);
CREATE UNIQUE INDEX campus_knowledge_chunk_version ON campus_knowledge_chunks(source_id,version,(metadata->>'chunkId'));
CREATE VIEW campus_knowledge_current AS
 SELECT c.id,c.text,c.metadata,c.embedding FROM campus_knowledge_chunks c
 JOIN campus_sources s ON s.source_id=c.source_id AND s.current_version=c.version
 WHERE s.state='active' AND s.valid_until>now();
COMMIT;
