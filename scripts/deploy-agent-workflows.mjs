import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {session} from './n8n-client.mjs';
const api=await session();const types=await api('/../types/nodes.json');
const source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentV2.json'));
for(const n of source.nodes)assert(types.some(t=>t.name===n.type&&[t.version].flat().includes(n.typeVersion)),`${n.type}@${n.typeVersion} not registered`);
const list=await api('/workflows');
if(list.some(w=>w.id===source.id)) {
 const live=await api(`/workflows/${source.id}`);
 // Preserve user-supplied external credential bindings on repeat deployment.
 for(const n of source.nodes)if(['gemini','embedding'].includes(n.id)){const previous=live.nodes.find(p=>p.id===n.id);if(previous?.credentials)n.credentials=previous.credentials;}
 await api(`/workflows/${source.id}`,'PATCH',{name:source.name,nodes:source.nodes,connections:source.connections,settings:source.settings,versionId:live.versionId});
} else {
 writeFileSync('.local/import-agent-workflows.json',JSON.stringify([source]),{mode:0o644});
 execFileSync('docker',['compose','-f','infra/compose.yaml','exec','-T','n8n','n8n','import:workflow','--input=/handoff/import-agent-workflows.json'],{stdio:'inherit'});
}
const live=await api(`/workflows/${source.id}`);assert.deepEqual(live.nodes,source.nodes);assert.deepEqual(live.connections,source.connections);
writeFileSync('docs/verification/direct-agent-manifest.json',JSON.stringify({recordedAt:new Date().toISOString(),workflowId:source.id,versionId:live.versionId,registeredTypes:true,liveGraphMatches:true,nodeTypes:source.nodes.map(n=>({name:n.name,type:n.type,version:n.typeVersion})),externalExecution:'not-run'},null,2)+'\n');
console.log('Direct native Agent graph deployed and matched; external model execution remains pending.');
