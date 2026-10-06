import {session} from './n8n-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
const api=await session(),template=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
const vector=structuredClone(template.nodes.find(n=>n.id==='vector')),embedding=structuredClone(template.nodes.find(n=>n.id==='embedding'));
vector.parameters={...vector.parameters,mode:'load',tableName:'campus_knowledge_current',prompt:'缺曠資料如果被誤記，應該如何更正？',topK:3};
embedding.credentials={googlePalmApi:{id:'campus-live-gemini-proxy',name:'Campus Gemini budget proxy'}};
const start={id:'manual',name:'真實檢索驗證',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
const workflow=await api('/workflows','POST',{name:'TEMP official corpus native retrieval verification',nodes:[start,vector,embedding],connections:{[start.name]:{main:[[{node:vector.name,type:'main',index:0}]]},[embedding.name]:{ai_embedding:[[{node:vector.name,type:'ai_embedding',index:0}]]}},settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
try{
 const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});let e;
 for(let i=0;i<60;i++){e=await api(`/executions/${started.executionId}`);if(['success','error','crashed','canceled'].includes(e.status))break;await new Promise(r=>setTimeout(r,1000));}
 const data=typeof e.data==='string'?parse(e.data):e.data;
 assert.equal(e.status,'success',String(data?.resultData?.error?.message??e.status));
 const items=data.resultData.runData[vector.name][0].data.main[0].map(item=>item.json);
 assert.equal(items.length,3);assert(JSON.stringify(items).includes('任課老師'));assert(JSON.stringify(items).includes('生活輔導組'));
 const report={checkedAt:new Date().toISOString(),status:'pass',executionId:started.executionId,query:vector.parameters.prompt,returned:items.length,model:embedding.parameters.modelName,dimension:3072,realOfficialCorpus:true,matchingCorrectionText:true,results:items};
 writeFileSync('docs/verification/knowledge-retrieval.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,results:undefined},null,2));
}finally{await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');}
