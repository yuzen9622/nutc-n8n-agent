import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ensureEnv} from './env.mjs';
import {importCredentials} from './n8n-credentials.mjs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {session,base} from './n8n-client.mjs';
assert.equal(base,'http://localhost:15679','Only the verified local instance may receive this draft');
const api=await session();
let source;
try{source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));}
catch{throw new Error('Live workflow JSON missing or invalid; refusing import.');}
const list=await api('/workflows');
if(list.some(w=>w.id===source.id)) throw new Error('Live draft already exists; inspect it before changing or re-importing.');
const types=await api('/../types/nodes.json');
for(const node of source.nodes) assert(types.some(t=>t.name===node.type && [t.version].flat().includes(node.typeVersion)),`Unregistered node: ${node.type}`);
const credentials=[];
for(const [id,name,header,file] of [
 ['campus-live-service','Campus live service','X-Campus-Service','SERVICE_TOKEN'],
 ['campus-live-webhook','Campus live webhook','X-Campus-Webhook','N8N_WEBHOOK_TOKEN'],
]) {
 const value=ensureEnv(file,()=>randomBytes(32).toString('hex'));assert(value.length>=32);
 credentials.push({id,name,type:'httpHeaderAuth',data:{name:header,value}});
}
importCredentials(credentials);
writeFileSync('.local/live-agent-draft.json',JSON.stringify([source]),{mode:0o600});
for(const [kind,path] of [['workflow','live-agent-draft.json']]) {
 try {execFileSync('docker',['compose','--env-file','.env','exec','-T','n8n','n8n',`import:${kind}`,`--input=/handoff/${path}`],{stdio:['pipe','pipe','pipe']});}
 catch {throw new Error(`Local draft ${kind} import failed; raw output withheld.`);}
}
let actual;
for(let attempt=0;attempt<3;attempt++) {
 try {const reader=await session();actual=await reader(`/workflows/${source.id}`);break;}
 catch {if(attempt===2) throw new Error('Draft imported but read-back verification unavailable; inspect existing draft before retrying any import.');}
}
assert.equal(actual.active,false);assert.deepEqual(actual.nodes,source.nodes);assert.deepEqual(actual.connections,source.connections);
mkdirSync('.local/verification',{recursive:true});
writeFileSync('.local/verification/live-agent-draft.json',JSON.stringify({recordedAt:new Date().toISOString(),workflowId:source.id,versionId:actual.versionId,registeredTypes:true,importedGraphMatches:true,active:false,externalCalls:'not-run',modelConfiguration:'from standalone live workflow source',gateway:'not-started; LINE settings and acceptance gates pending'},null,2)+'\n');
console.log('Live draft imported inactive into the verified local n8n instance; existing user workflows unchanged.');
