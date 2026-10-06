import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=readdirSync('workflows').filter(x=>/^WF-/.test(x));assert.equal(files.length,7);
const workflows=files.map(f=>JSON.parse(readFileSync(`workflows/${f}`)));const ids=new Set(workflows.map(w=>w.id));
for(const w of workflows) {
 const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
 for(const [source,ports]of Object.entries(w.connections)){assert(names.has(source));for(const output of ports.main)for(const target of output)assert(names.has(target.node),`dangling ${target.node}`);}
 for(const n of w.nodes){if(n.type.endsWith('.executeWorkflow'))assert(ids.has(n.parameters.workflowId.value));if(n.type.endsWith('.switch'))assert.equal(n.parameters.options.fallbackOutput,'extra');if(n.type.endsWith('.httpRequest')){assert.equal(n.retryOnFail,false);assert(n.credentials.httpHeaderAuth);}}
 assert.equal(w.active,false);assert.deepEqual(w.pinData,{});
}
// Small dependency-direction gate, no global mocking of the actual service behavior.
const root='apps/mock-gateway/src/modules/mock/';
const router=readFileSync(root+'mock.router.ts','utf8');assert(!/from ['"].*(service|repository)\.js/.test(router));
const service=readFileSync(root+'mock.service.ts','utf8');assert(!/from ['"].*(controller|router|node:http)/.test(service));assert(!/\bfetch\s*\(/.test(service));
for(const f of ['SDD.md','WORKFLOWS.md','ROADMAP.md','RAG.md']) {
 const md=readFileSync(`docs/${f}`,'utf8');for(const m of md.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)){if(!m[1].includes('://'))readFileSync(new URL(m[1],new URL(`../docs/${f}`,import.meta.url)));}
}
console.log('7 workflow graphs, references, fallback switches, layer boundaries and Phase 0 document links passed.');
const nativeFiles=readdirSync('workflows/agent').filter(f=>f.endsWith('.json'));
const native=nativeFiles.map(f=>JSON.parse(readFileSync(`workflows/agent/${f}`)));
const nativeIds=new Set(native.map(w=>w.id));
for(const w of native){const names=new Set(w.nodes.map(n=>n.name));for(const [source,ports]of Object.entries(w.connections)){assert(names.has(source));for(const outputs of Object.values(ports))for(const targets of outputs)for(const target of targets)assert(names.has(target.node));}for(const n of w.nodes)if(n.type.endsWith('.toolWorkflow'))assert(nativeIds.has(n.parameters.workflowId.value));}
const main=native.find(w=>w.id==='campusNativeAgentV2');assert(main.nodes.some(n=>n.type==='@n8n/n8n-nodes-langchain.agent'));
assert.equal(Object.values(main.connections).filter(p=>p.ai_tool).length,5);assert.equal(Object.values(main.connections).filter(p=>p.ai_languageModel).length,1);
assert.equal(main.settings.saveDataSuccessExecution,'none');
console.log('Native Agent model/tool ports, child references and graph connections passed.');

assert.equal(Object.values(main.connections).filter(p=>p.ai_memory).length,1);
assert.equal(Object.values(main.connections).filter(p=>p.ai_embedding).length,1);
assert(!main.nodes.some(n=>n.type.endsWith('.toolWorkflow')));
const live=native.find(w=>w.id==='campusNativeAgentLive');
assert(live && !live.active);
assert.equal(live.nodes.find(n=>n.id==='memory').parameters.tableName,'live_agent_chat_histories');
assert.equal(live.nodes.filter(n=>n.type.endsWith('.httpRequestTool')).length,4);
assert(!live.nodes.some(n=>n.parameters.url?.includes('mock-gateway')));
for(const n of live.nodes.filter(n=>n.parameters.url)) {
 assert.equal(n.credentials.httpHeaderAuth.id,'campus-live-service');
 if(n.id!=='prepare') assert(n.parameters.jsonBody.includes('lease:'));
}
assert.equal(live.settings.saveDataSuccessExecution,'none');
console.log('Live draft uses real gateway routes, isolated credentials, task leases and guarded memory.');
// school-adapter remains independently layered and never imports gateway state.
const schoolRoot='apps/school-adapter/src/modules/school/';
for(const file of readdirSync(schoolRoot).filter(name=>name.endsWith('.ts'))){
 const text=readFileSync(schoolRoot+file,'utf8');
 assert(!/from ['"].*gateway/.test(text));
 if(file.endsWith('.service.ts'))assert(!/from ['"].*(controller|router|node:http)/.test(text));
 if(file.endsWith('.parse.ts'))assert(!/from ['"].*(service|client|provider|repository)\.js/.test(text));
}
console.log('School service and parser dependency boundaries passed.');
