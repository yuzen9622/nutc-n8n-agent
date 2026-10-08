# syntax=docker/dockerfile:1
FROM pgvector/pgvector:0.8.2-pg17-trixie@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75 AS postgres
# Only runs for a new empty volume. Existing roles, databases and data are untouched.
COPY --chmod=644 <<'INIT' /docker-entrypoint-initdb.d/10-campus.sh
#!/bin/sh
set -eu
: "${N8N_DB_PASSWORD:?Required}" "${AGENT_DB_PASSWORD:?Required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv n8n_password N8N_DB_PASSWORD
\getenv agent_password AGENT_DB_PASSWORD
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';
CREATE DATABASE n8n OWNER n8n;
CREATE ROLE campus_agent LOGIN PASSWORD :'agent_password';
CREATE DATABASE campus_agent OWNER campus_agent;
REVOKE CONNECT ON DATABASE campus_agent FROM PUBLIC;
GRANT CONNECT ON DATABASE campus_agent TO campus_agent;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname campus_agent <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SQL
INIT

# The bootstrap CLI and server must use the exact same n8n release.
FROM docker.n8n.io/n8nio/n8n:2.41.7@sha256:bcef56dd44014e09774219536a3f8cb07f1b553fcba94044bd9fc0f21f8676a3 AS n8n-init
COPY --chown=node:node scripts/bootstrap-n8n.mjs /bootstrap/scripts/bootstrap-n8n.mjs
COPY --chown=node:node workflows/agent /bootstrap/workflows/agent
USER node
ENTRYPOINT ["node", "/bootstrap/scripts/bootstrap-n8n.mjs"]

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build
WORKDIR /app
RUN npm install -g pnpm@10.32.1
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps ./apps
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS live
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/gateway/migrations ./apps/gateway/migrations
COPY --chown=node:node scripts/migrate-live-database.mjs scripts/env.mjs ./scripts/
USER node
CMD ["node", "dist/apps/gateway/src/server.js"]

# Only the tunnel target includes cloudflared; the host needs Docker, not Node/pnpm.
FROM cloudflare/cloudflared:2026.6.1@sha256:6d91c121b803126f7a5344005d17a9324788fc09d305b6e2560ec6040a7ae283 AS cloudflared
FROM live AS tunnel
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --chown=node:node scripts/start-tunnel.mjs ./scripts/
CMD ["node", "scripts/start-tunnel.mjs"]
