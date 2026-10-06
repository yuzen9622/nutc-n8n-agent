#!/bin/sh
set -eu
# Separate n8n login and database; campus reserved for extension verification.
n8n_password="${N8N_DB_PASSWORD:?Set N8N_DB_PASSWORD}"
test -n "$n8n_password"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres --set=n8n_password="$n8n_password" <<'SQL'
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';
CREATE ROLE campus NOLOGIN;
CREATE DATABASE n8n OWNER n8n;
CREATE DATABASE campus OWNER campus;
REVOKE CONNECT ON DATABASE campus FROM PUBLIC;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname campus <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SQL
