import {session} from './n8n-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
const api=await session();
const main=JSON.parse(readFileSync('workflows/agent/campusNativeAgentV2.json'));
const prepare=structuredClone(main.nodes.find(n=>n.id==='prepare'));prepare.onError='stopWorkflow';prepare.parameters.jsonBody=JSON.stringify({eventId:`runtime-${Date.now()}`,scenario:'mixed'});
const normalize=structuredClone(main.nodes.find(n=>n.id==='input'));
const nodes=[{id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},prepare,normalize];
const connections={};const edge=(a,b)=>connections[a]={main:[[{node:b,type:'main',index:0}]]};edge('測試入口',prepare.name);edge(prepare.name,normalize.name);
let last=normalize.name;
for(const [kind,query]of [['knowledge','借書'],['web','時間'],['personal','schedule']]){
 const name=`run-${kind}`;nodes.push({id:name,name,type:'n8n-nodes-base.executeWorkflow',typeVersion:1.3,position:[0,0],parameters:{source:'database',workflowId:{__rl:true,value:`campusAgentTool${kind}`,mode:'id'},workflowInputs:{mappingMode:'defineBelow',value:{taskId:"={{ $('整理訊息').first().json.taskId }}",capability:"={{ $('整理訊息').first().json.capability }}",query},schema:['taskId','capability','query'].map(id=>({id,displayName:id,type:'string'})),matchingColumns:[],attemptToConvertTypes:false,convertFieldsToString:false},mode:'each',options:{waitForSubWorkflow:true}}});edge(last,name);last=name;
}
const complete=structuredClone(main.nodes.find(n=>n.id==='validate'));complete.onError='stopWorkflow';complete.parameters.jsonBody="={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,capability:$('整理訊息').first().json.capability,output:JSON.stringify({answer:'合成測試五本書',sourceIds:['synthetic-library-rules']})}) }}";nodes.push(complete);edge(last,complete.name);
const w=await api('/workflows','POST',{name:'TEMP synthetic Agent tool verification',nodes,connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
try {
 const started=await api(`/workflows/${w.id}/run`,'POST',{triggerToStartFrom:{name:'測試入口'}});
 let e;for(let i=0;i<100;i++){e=await api(`/executions/${started.executionId}`);if(['success','error','crashed'].includes(e.status))break;await new Promise(r=>setTimeout(r,500));}
 const data=typeof e.data==='string'?parse(e.data):e.data;
 assert.equal(e.status,'success',JSON.stringify(data.resultData.error));
 const run=data.resultData.runData;
 const result=n=>run[n].at(-1).data.main[0][0].json;
 assert.equal(result('run-knowledge').sources[0].sourceId,'synthetic-library-rules');
 assert.equal(result('run-web').sources[0].sourceId,'synthetic-library-hours');
 assert.equal(result('run-personal').status,'prepared_locally');
 assert.equal(result(complete.name).data.delivered,false);
 const report={recordedAt:new Date().toISOString(),executionId:started.executionId,status:'pass',coverage:'Real n8n child workflows and gateway; fixed harness, not AI Agent tool selection',gemini:'not-run-credential-pending',tools:['knowledge','web','personal'],reply:result(complete.name).data};writeFileSync('docs/verification/native-agent-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await api(`/workflows/${w.id}/archive`,'POST');await api(`/workflows/${w.id}`,'DELETE');}
