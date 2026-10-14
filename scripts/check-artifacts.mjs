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
assert.deepEqual(readdirSync('workflows/agent').sort(), ['campusKnowledgeIngest.json','campusNativeAgentLive.json']);
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
for(const [port,count] of Object.entries({ai_tool:10,ai_languageModel:1,ai_memory:1,ai_embedding:1})) {
 assert.equal(Object.values(live.connections).filter(ports=>ports[port]).length,count);
}
assert.equal(live.nodes.find(node=>node.id==='memory').parameters.tableName,'live_agent_chat_histories');
assert.equal(live.nodes.filter(node=>node.type.endsWith('.httpRequestTool')).length,9);
assert(!JSON.stringify(workflows).includes('campus-live-gemini-proxy'),'Google credentials are selected in the n8n editor, never referenced by id');
for(const workflow of workflows)for(const node of workflow.nodes)assert(!node.credentials?.googlePalmApi,'No fake Google credential reference');
const GOOGLE_URL='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
const direct=live.nodes.filter(node=>node.name==='official_search');
assert.equal(direct.length,1);
{
 const tool=direct[0],p=tool.parameters;
 assert.equal(tool.id,'direct-official_search');assert.equal(tool.type,'n8n-nodes-base.httpRequestTool');assert.equal(tool.typeVersion,4.5);
 assert.equal(tool.credentials,undefined);assert.equal(tool.retryOnFail,false);
 assert.equal(p.method,'POST');assert.equal(p.url,GOOGLE_URL);
 assert.equal(p.authentication,'predefinedCredentialType');assert.equal(p.nodeCredentialType,'googlePalmApi');
 assert.deepEqual(Object.keys(p).sort(),['authentication','jsonBody','method','nodeCredentialType','options','sendBody','specifyBody','toolDescription','url']);
 assert.equal(p.sendBody,true);assert.equal(p.specifyBody,'json');
 assert.deepEqual(p.options,{timeout:25000,redirect:{redirect:{followRedirects:false}}});
 assert.equal((p.jsonBody.match(/\$fromAI\(/g)??[]).length,1);
 assert(p.jsonBody.includes("$fromAI('query'")&&p.jsonBody.includes('google_search'));
 assert(!/\$json|\$\(|\$node|\$env|lease|taskId|capability|userId|sessionKey|cookie|password|gateway/i.test(p.jsonBody));
 assert.deepEqual(live.connections.official_search,{ai_tool:[[{node:'AI Agent',type:'ai_tool',index:0}]]});
 assert(!p.jsonBody.replace('$fromAI','').includes('$'),'Only the AI query can be dynamic');
 assert(p.jsonBody.startsWith('={{ ')&&p.jsonBody.endsWith(' }}'));
 const expectedPrompt='你是國立臺中科技大學的校園助理。使用 Google 搜尋查證公開資訊後，以繁體中文統整回答使用者；優先引用 nutc.edu.tw 官方資料，找不到官方依據就明說無法確認。不要猜測系所、承辦人或期限。不要要求或查詢個人帳密、學號、私人紀錄。回答正文不要輸出任何網址，來源網址由外層依 groundingMetadata 處理。';
 const expectedBody='={{ (() => { const value = $fromAI(\'query\', \'要搜尋的公開校園問題，不含個人識別、私人校務或對話紀錄\', \'string\'); if (typeof value !== \'string\') throw new Error(\'INVALID_SEARCH_QUERY\'); const q = value.trim(); '
  + "if (q.length === 0 || q.length > 500) throw new Error('INVALID_SEARCH_QUERY'); "
  + 'return JSON.stringify({systemInstruction:{parts:[{text:' + JSON.stringify(expectedPrompt) + '}]},contents:[{role:\'user\',parts:[{text:q}]}],tools:[{google_search:{ } }],generationConfig:{maxOutputTokens:2048,candidateCount:1} }); })() }}';
 assert.equal(p.jsonBody,expectedBody,'The direct tool body has no additional data or dynamic settings');
}
for(const node of live.nodes.filter(node=>node.parameters.url&&node.name!=='official_search')) {
 assert(/^http:\/\/gateway:3100\/internal\/v1\/agent\/(prepare|tool|complete)$/.test(node.parameters.url));
 assert.equal(node.credentials.httpHeaderAuth.id,'campus-live-service');
 if(node.id!=='prepare')for(const field of ['lease:','taskId:','capability:'])assert(node.parameters.jsonBody.includes(field));
}
assert.equal(live.settings.saveDataSuccessExecution,'none');
assert.equal(live.settings.saveDataErrorExecution,'none');

const schoolRoot='apps/school-adapter/src/modules/school/';
for(const file of readdirSync(schoolRoot).filter(name=>name.endsWith('.ts'))) {
 const text=readFileSync(schoolRoot+file,'utf8');
 assert(!/from ['"].*gateway/.test(text));
 if(file.endsWith('.service.ts'))assert(!/from ['"].*(controller|router|node:http)/.test(text));
 if(file.endsWith('.parse.ts'))assert(!/from ['"].*(service|client|provider|repository)\.js/.test(text));
}
console.log('Root deployment, two design docs, live workflow graphs/credentials/leases and school layer boundaries passed.');

assert(!live.nodes.some(n=>n.name==='student_leave'));
for(const name of ['student_leave_preview','student_leave_confirm','student_leave_notes'])assert(live.nodes.some(n=>n.name===name));
