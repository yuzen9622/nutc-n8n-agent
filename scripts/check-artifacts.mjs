import {readFileSync,readdirSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';

assert(!existsSync('infra'), 'Deployment must not depend on infra/');
assert(!existsSync('apps/mock-gateway'), 'Historical mock app must not return');
assert(existsSync('Dockerfile') && existsSync('docker-compose.yml'));
assert.deepEqual(readdirSync('docs').sort(), ['ROADMAP.md','SDD.md']);
for(const file of ['SDD.md','ROADMAP.md']) {
 const md=readFileSync(`docs/${file}`,'utf8');
 for(const match of md.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
  if(!match[1].includes('://'))readFileSync(new URL(match[1],new URL(`../docs/${file}`,import.meta.url)));
 }
}
assert.deepEqual(readdirSync('workflows').sort(), ['agent']);
assert.deepEqual(readdirSync('workflows/agent').sort(), ['campusGoogleSearch.json','campusKnowledgeIngest.json','campusNativeAgentLive.json']);
const workflows=readdirSync('workflows/agent').map(file=>{
 try{return JSON.parse(readFileSync(`workflows/agent/${file}`,'utf8'));}
 catch(error){throw new Error(`Invalid workflow ${file}: ${error.message}`);}
});
for(const workflow of workflows) {
 const names=new Set(workflow.nodes.map(node=>node.name));
 assert.equal(names.size,workflow.nodes.length);
 assert.equal(workflow.active,false); // Source JSON must never publish implicitly.
 assert.deepEqual(workflow.pinData,{});
 for(const [source,ports] of Object.entries(workflow.connections)) {
  assert(names.has(source));
  for(const outputs of Object.values(ports))for(const targets of outputs)for(const target of targets)assert(names.has(target.node));
 }
 assert(!workflow.nodes.some(node=>node.type.endsWith('.toolWorkflow')));
 assert(!JSON.stringify(workflow).includes('mock-gateway'));
}
const live=workflows.find(workflow=>workflow.id==='campusNativeAgentLive');
assert(live.nodes.some(node=>node.type==='@n8n/n8n-nodes-langchain.agent'));
for(const [port,count] of Object.entries({ai_tool:8,ai_languageModel:1,ai_memory:1,ai_embedding:1})) {
 assert.equal(Object.values(live.connections).filter(ports=>ports[port]).length,count);
}
assert.equal(live.nodes.find(node=>node.id==='memory').parameters.tableName,'live_agent_chat_histories');
assert.equal(live.nodes.filter(node=>node.type.endsWith('.httpRequestTool')).length,7);
assert(!JSON.stringify(workflows).includes('campus-live-gemini-proxy'),'Google credentials are selected in the n8n editor, never referenced by id');
for(const workflow of workflows)for(const node of workflow.nodes)assert(!node.credentials?.googlePalmApi,'No fake Google credential reference');
for(const node of live.nodes.filter(node=>node.parameters.url)) {
 assert.equal(node.credentials.httpHeaderAuth.id,'campus-live-service');
 if(node.id!=='prepare')assert(node.parameters.jsonBody.includes('lease:'));
}
assert.equal(live.settings.saveDataSuccessExecution,'none');
assert.equal(live.settings.saveDataErrorExecution,'none');
const search=workflows.find(workflow=>workflow.id==='campusGoogleSearch');
assert.deepEqual(search.nodes.map(node=>node.type).sort(),['n8n-nodes-base.httpRequest','n8n-nodes-base.if','n8n-nodes-base.respondToWebhook','n8n-nodes-base.respondToWebhook','n8n-nodes-base.respondToWebhook','n8n-nodes-base.webhook']);
const searchHook=search.nodes.find(node=>node.type==='n8n-nodes-base.webhook');
assert.equal(searchHook.parameters.path,'campus-google-search');assert.equal(searchHook.parameters.authentication,'headerAuth');assert.equal(searchHook.credentials.httpHeaderAuth.id,'campus-live-webhook');
const searchCall=search.nodes.find(node=>node.type==='n8n-nodes-base.httpRequest');
assert.equal(searchCall.parameters.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
assert.equal(searchCall.parameters.authentication,'predefinedCredentialType');assert.equal(searchCall.parameters.nodeCredentialType,'googlePalmApi');assert.equal(searchCall.credentials,undefined);
assert(searchCall.parameters.jsonBody.includes('google_search')&&searchCall.parameters.jsonBody.includes('maxOutputTokens:2048'));
assert(searchCall.parameters.options.timeout<=25000&&search.settings.executionTimeout===30);
assert.equal(search.settings.saveDataSuccessExecution,'none');assert.equal(search.settings.saveDataErrorExecution,'none');

const schoolRoot='apps/school-adapter/src/modules/school/';
for(const file of readdirSync(schoolRoot).filter(name=>name.endsWith('.ts'))) {
 const text=readFileSync(schoolRoot+file,'utf8');
 assert(!/from ['"].*gateway/.test(text));
 if(file.endsWith('.service.ts'))assert(!/from ['"].*(controller|router|node:http)/.test(text));
 if(file.endsWith('.parse.ts'))assert(!/from ['"].*(service|client|provider|repository)\.js/.test(text));
}
console.log('Root deployment, two design docs, live workflow graphs/credentials/leases and school layer boundaries passed.');
