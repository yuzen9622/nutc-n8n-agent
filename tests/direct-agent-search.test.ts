import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskService} from '../apps/gateway/src/modules/tasks/task.service.js';
import {readFileSync,mkdirSync,mkdtempSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {isolatedGraph,liveGoogleRef,parseLocalBase,failedChecks,extractReport} from '../scripts/check-live-gemini.mjs';
const auth={taskId:'task',lease:'lease',capability:'capability'};
function harness(){
 const calls:string[]=[];
 const task={id:'task',userId:'owner',generation:'1',prompt:'',lease:'lease',capability:'capability'};
 const repository={
  recordKnowledgeEvidence:async()=>{calls.push('knowledgeEvidence');},
  recordEvidence:async()=>{calls.push('evidence');},
  forCompletion:async(value:unknown)=>{assert.deepEqual(value,auth);calls.push('forCompletion');return task;},
  complete:async(...args:unknown[])=>{calls.push('complete');completed.push(args);},
  authorizeTool:async()=>{calls.push('authorize');return task;},
 };
 const completed:unknown[][]=[];
 return {calls,completed,task,service:new TaskService(repository as never,{} as never)};
}
test('direct Google summary completes through the normal repository path with no source ids or evidence',async()=>{
 const {service,calls,completed,task}=harness();
 const answer='公開查證結果：官網已更新。\n來源：https://vertexaisearch.cloud.google.com/grounding-api-redirect/example';
 assert.deepEqual(await service.complete(auth,JSON.stringify({answer,sourceIds:[]})),{status:'queued'});
 assert.deepEqual(calls,['forCompletion','complete']);
 assert.deepEqual(completed,[[task,answer,[]]]);
});
test('plain-text Agent output is accepted unchanged and Google data is never written as evidence',async()=>{
 const {service,calls,completed,task}=harness();
 const answer='摘要\nhttps://www.nutc.edu.tw/';
 await service.complete(auth,answer);
 assert(!calls.includes('evidence')&&!calls.includes('knowledgeEvidence'));
 assert.equal(completed[0]![0],task);assert.equal(completed[0]![1],answer);assert.deepEqual(completed[0]![2],[]);
});
test('knowledge observations remain validated and invalid ones still reject before completion',async()=>{
 const {service,calls}=harness();
 await assert.rejects(service.complete(auth,'answer',['not-a-knowledge-observation']),/INVALID_KNOWLEDGE_OBSERVATION/);
 assert.deepEqual(calls,[]);
});
test('formal gateway wiring has no web search provider: web tool fails closed without evidence',async()=>{
 const {service,calls}=harness();
 await assert.rejects(service.tool(auth,'web','public question'),/SEARCH_NOT_CONFIGURED/);
 assert.deepEqual(calls,['authorize']);
});

test('isolated runtime graph keeps production search rules and excludes every private or persistent path',()=>{
 const source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
 const before=JSON.stringify(source),graph=isolatedGraph(source);
 assert.deepEqual(graph.nodes.map(n=>n.name),['Manual Trigger','AI Agent','驗證搜尋來源','Gemini Chat Model','official_search']);
 assert.deepEqual(graph.connections['AI Agent'],{main:[[{node:'驗證搜尋來源',type:'main',index:0}]]});
 assert(!JSON.stringify(graph).includes('credentials'));
 assert(!JSON.stringify(graph).includes('$now'));
 assert.match(String(graph.nodes[1]!.parameters!.options&& (graph.nodes[1]!.parameters!.options as any).systemMessage),/groundingMetadata/);
 assert.equal(JSON.stringify(source),before);
});
test('runtime parser unwraps the native HTTP Request Tool single-item array',()=>{
 const require=createRequire(import.meta.url);
 const {parseGroundedObservation}=require('../scripts/check-direct-agent-runtime.cjs');
 const response=[{candidates:[{content:{parts:[{text:'grounded answer'}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://example.edu.tw/source'}}]}}]}];
 assert.deepEqual(parseGroundedObservation(JSON.stringify(response)),{textLength:15,uris:['https://example.edu.tw/source']});
});
test('missing/mismatched refs and remote base fail closed with fixed codes only',()=>{
 assert.throws(()=>liveGoogleRef({nodes:[]}),/GOOGLE_CREDENTIAL_REF_MISSING/);
 const node=(name:string,id:string)=>({name,credentials:{googlePalmApi:{id,name:'fixture'}}});
 assert.throws(()=>liveGoogleRef({nodes:[node('Gemini Chat Model','a'),node('Google Gemini Embeddings','b')]}),/^Error: GOOGLE_CREDENTIAL_REF_MISMATCH$/);
 for(const url of ['https://evil.test','http://user:password@localhost:15680','http://127.0.0.1:15680/other'])assert.throws(()=>parseLocalBase(url),/N8N_BASE_URL_NOT_LOCAL/);
 assert.equal(parseLocalBase(),'http://127.0.0.1:15680');
 assert.throws(()=>extractReport('raw secret-shaped noise'),/^Error: RUNTIME_REPORT_MISSING$/);
 assert.deepEqual(extractReport('untrusted logs\n@@DIRECT_AGENT_REPORT@@{"ok":false,"code":"RUNTIME_TIMEOUT"}'),{ok:false,code:'RUNTIME_TIMEOUT'});
 const report={ok:true,n8nVersion:'2.41.7',toolCallCount:1,toolNames:['official_search'],observationTextLengths:[10],groundingUrlCount:1,answerLength:10,answerUrlCount:1,answerUrlsSubsetOfGrounding:true,publicQueryOnly:true,persistentWorkflowCreated:false,lineMessagesSent:0,memoryNodesUsed:false};
 assert.deepEqual(failedChecks(report),[]);
 for(const [key,value] of Object.entries({ok:false,toolCallCount:0,groundingUrlCount:0,answerLength:0,answerUrlsSubsetOfGrounding:false,publicQueryOnly:false,persistentWorkflowCreated:true,lineMessagesSent:1,memoryNodesUsed:true}))assert(failedChecks({...report,[key]:value}).length>0,key);
});
test('artifact checker rejects direct-tool host/model/auth/header/ref/body/connection mutants',()=>{
 const root=resolve('.'),base='.local/verification/agent-direct-google-search';mkdirSync(base,{recursive:true,mode:0o700});
 const dir=mkdtempSync(join(base,'mutants-'));
 try{
  for(const path of ['Dockerfile','docker-compose.yml','docs','apps'])symlinkSync(join(root,path),join(dir,path));
  mkdirSync(join(dir,'workflows/agent'),{recursive:true});
  writeFileSync(join(dir,'workflows/agent/campusKnowledgeIngest.json'),readFileSync('workflows/agent/campusKnowledgeIngest.json'));
  const source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
  const check=(w:any)=>{writeFileSync(join(dir,'workflows/agent/campusNativeAgentLive.json'),JSON.stringify(w));return spawnSync(process.execPath,[join(root,'scripts/check-artifacts.mjs')],{cwd:dir,stdio:'pipe'}).status;};
  assert.equal(check(source),0);
  const mutations=[
   (n:any)=>{n.parameters.url=n.parameters.url.replace('generativelanguage.googleapis.com','evil.test');},
   (n:any)=>{n.parameters.url=n.parameters.url.replace('gemini-3.8-flash','other-model');},
   (n:any)=>{n.parameters.sendHeaders=true;},
   (n:any)=>{n.credentials={googlePalmApi:{id:'fake',name:'fake'}};},
   (n:any)=>{n.parameters.authentication='genericCredentialType';},
   (n:any)=>{n.parameters.jsonBody=n.parameters.jsonBody.replace('text:q','text:$json.prompt');},
   (n:any)=>{n.parameters.jsonBody=n.parameters.jsonBody.replace('text:q','text:q,extra:"unexpected"');},
   (_n:any,w:any)=>{w.connections.official_search.ai_tool[0][0].node='campus_knowledge';},
  ];
  for(const mutate of mutations){const w=structuredClone(source);mutate(w.nodes.find((n:any)=>n.name==='official_search'),w);assert.notEqual(check(w),0);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
