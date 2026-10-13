#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose exec -T gateway node scripts/n8n-credentials.mjs --json \
  | docker compose exec -T n8n node /opt/campus/setup-n8n.mjs
