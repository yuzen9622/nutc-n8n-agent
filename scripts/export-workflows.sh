#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# The Compose project is dedicated to these seven workflows. Never export credentials.
mkdir -p .local/exports
docker compose --env-file .env -f infra/compose.yaml exec -T n8n n8n export:workflow --all --output=/handoff/exports/workflows.json --pretty
node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const all=JSON.parse(readFileSync('.local/exports/workflows.json'));
for(let n=1;n<=7;n++){
 const w=all.find(w=>w.id===`campusWF0${n}phase1`);if(!w)throw new Error(`Missing WF-0${n}`);
 writeFileSync(`.local/exports/WF-0${n}.json`,JSON.stringify(w,null,2)+'\n');
}
console.log('Exported seven workflows; no credentials exported.');
JS
