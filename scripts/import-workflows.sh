#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Only this isolated synthetic project; no global n8n instance selection.
node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const workflows=[2,3,4,5,7,1,6].map(n=>JSON.parse(readFileSync(`workflows/WF-0${n}.json`)));
writeFileSync('.local/import-workflows.json',JSON.stringify(workflows),{mode:0o644});
JS
docker compose -f infra/compose.yaml exec -T n8n n8n import:credentials --input=/handoff/credentials.json
docker compose -f infra/compose.yaml exec -T n8n n8n import:workflow --input=/handoff/import-workflows.json
