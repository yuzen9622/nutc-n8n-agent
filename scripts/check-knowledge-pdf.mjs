import {session,base} from './n8n-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
assert.equal(base,'http://localhost:15679');
const path='docs/verification/knowledge-pdf.json',report=JSON.parse(readFileSync(path,'utf8'));
assert.equal(report.status,'success','Publish PDF corpus before retrieval');
assert(!report.retrieval,'Inspect recorded retrieval before another paid attempt');
const save=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const api=await session(),template=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
const vector=structuredClone(template.nodes.find(n=>n.id==='vector')),embedding=structuredClone(template.nodes.find(n=>n.id==='embedding'));
vector.parameters={...vector.parameters,mode:'load',tableName:'campus_knowledge_current',prompt:'五專前三年請假，是否要列印紙本、貼郵票並經導師簽名？',topK:3};
embedding.credentials={googlePalmApi:{id:'campus-live-gemini-proxy',name:'Campus Gemini budget proxy'}};
const start={id:'manual',name:'PDF真實檢索驗證',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
const workflow=await api('/workflows','POST',{name:'TEMP official PDF native retrieval verification',nodes:[start,vector,embedding],connections:{[start.name]:{main:[[{node:vector.name,type:'main',index:0}]]},[embedding.name]:{ai_embedding:[[{node:vector.name,type:'ai_embedding',index:0}]]}},settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
report.retrieval={workflowId:workflow.id,status:'created',query:vector.parameters.prompt};save();
const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});
report.retrieval.executionId=started.executionId;report.retrieval.status='running';save();
let execution;
for(let i=0;i<50;i++){
  execution=await api(`/executions/${started.executionId}`);
  if(['success','error','crashed','canceled'].includes(execution.status))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
}
report.retrieval.status=execution.status;save();
if(!['success','error','crashed','canceled'].includes(execution.status))throw Error('Execution still live; inspect the recorded handle, do not restart');
try{
  const data=typeof execution.data==='string'?parse(execution.data):execution.data;
  assert.equal(execution.status,'success','PDF retrieval failed; inspect execution');
  const items=data.resultData.runData[vector.name][0].data.main[0].map(item=>item.json);
  report.retrieval.results=items;save();
  const match=items.find(item=>JSON.stringify(item).includes(report.source));
  assert(match,'Expected official PDF was not retrieved');
  const serialized=JSON.stringify(match);
  assert(serialized.includes('貼郵票')&&serialized.includes('導師簽名'));
  // n8n PGVector load returns a Document under json.document.
  const document=match.document??match;
  assert.equal(document.metadata.page,1);
  report.retrieval.pageVerified=true;report.retrieval.checkedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:'pass',executionId:started.executionId,returned:items.length,page:1}));
}finally{
  await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');
  report.retrieval.temporaryWorkflowRemoved=true;save();
}
