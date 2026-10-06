import {session} from './n8n-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
const api=await session();const main=JSON.parse(readFileSync('workflows/agent/campusNativeAgentV2.json'));
const unique=`verify-${Date.now()}`;
const clone=id=>structuredClone(main.nodes.find(n=>n.id===id));
const prepare=clone('prepare');prepare.onError='stopWorkflow';prepare.parameters.jsonBody=JSON.stringify({eventId:unique,scenario:'mixed',session:'demo-a'});
const nodes=[{id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},prepare,clone('input')];
const connections={};const link=(a,b,type='main')=>connections[a]={[type]:[[{node:b,type,index:0}]]};link('測試入口',prepare.name);link(prepare.name,'整理訊息');let last='整理訊息';
for(const [id,kind,query] of [['direct-official_search','web','開館時間'],['direct-student_schedule','personal','schedule'],['direct-student_absence','personal','absence'],['direct-student_announcements','personal','announcements']]){
 const n=clone(id);n.type='n8n-nodes-base.httpRequest';n.typeVersion=4.4;delete n.parameters.toolDescription;
 n.parameters.jsonBody=`={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,capability:$('整理訊息').first().json.capability,kind:'${kind}',query:'${query}'}) }}`;
 nodes.push(n);link(last,n.name);last=n.name;
}
const complete=clone('validate');complete.onError='stopWorkflow';complete.parameters.jsonBody="={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,capability:$('整理訊息').first().json.capability,output:JSON.stringify({answer:'合成開館時間09:00–17:00',sourceIds:['synthetic-library-hours']})}) }}";nodes.push(complete);link(last,complete.name);last=complete.name;
for(const [suffix,mode,key] of [['insert','insert','a'],['read-a','load','a'],['read-b','load','b']]){
 const name='memory-'+suffix;
 const m={id:name,name,type:'@n8n/n8n-nodes-langchain.memoryManager',typeVersion:1.1,position:[0,0],parameters:{mode,...(mode==='insert'?{insertMode:'insert',messages:{messageValues:[{type:'user',message:'synthetic memory isolation probe',hideFromUI:false}]}}:{simplifyOutput:true,options:{groupMessages:true}})}};
 const memory=clone('memory');memory.id=name+'-db';memory.name=name+'-db';memory.parameters.sessionKey=`${unique}-${key}`;
 nodes.push(m,memory);link(memory.name,name,'ai_memory');link(last,name);last=name;
}
const w=await api('/workflows','POST',{name:'TEMP direct tools and Postgres memory verification',nodes,connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
try {
 const started=await api(`/workflows/${w.id}/run`,'POST',{triggerToStartFrom:{name:'測試入口'}});
 let e;for(let i=0;i<100;i++){e=await api(`/executions/${started.executionId}`);if(['success','error','crashed'].includes(e.status))break;await new Promise(r=>setTimeout(r,500));}
 const data=typeof e.data==='string'?parse(e.data):e.data;assert.equal(e.status,'success',JSON.stringify(data.resultData.error));
 const run=data.resultData.runData;const output=n=>run[n].at(-1).data.main[0];
 assert(JSON.stringify(output('memory-read-a')).includes('synthetic memory isolation probe'));
 assert(!JSON.stringify(output('memory-read-b')).includes('synthetic memory isolation probe'));
 assert.equal(output('official_search')[0].json.data.sources[0].sourceId,'synthetic-library-hours');
 for(const name of ['student_schedule','student_absence','student_announcements'])assert.equal(output(name)[0].json.data.status,'prepared_locally');
 const report={recordedAt:new Date().toISOString(),executionId:started.executionId,status:'pass',memory:'Native Postgres Chat Memory insert/read and session isolation passed through Memory Manager',tools:'Four direct HTTP configurations executed with fixed inputs as HTTP Request nodes; AI selection and $fromAI remain untested',gemini:'not-run',pgvectorRetrieval:'not-run-no-embedding-credential-or-corpus',reply:output(complete.name)[0].json.data};writeFileSync('docs/verification/direct-agent-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
 await api(`/workflows/${w.id}/archive`,'POST');await api(`/workflows/${w.id}`,'DELETE');
 execFileSync('docker',['compose','-f','infra/compose.yaml','exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','bootstrap','-d','campus_agent'],{input:`DELETE FROM agent_chat_histories WHERE session_id IN ('${unique}-a','${unique}-b');`,stdio:['pipe','pipe','pipe']});
}
