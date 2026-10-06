import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';
assert.equal(base,'http://localhost:15679');
const reportPath='docs/verification/knowledge-ingest.json';
if(existsSync(reportPath))throw Error('Ingestion record exists. Inspect its execution before starting another paid run.');
const api=await session(),source=JSON.parse(readFileSync('workflows/agent/campusKnowledgeIngest.json','utf8'));
const types=await api('/../types/nodes.json');
for(const n of source.nodes)assert(types.some(t=>t.name===n.type&&[t.version].flat().includes(n.typeVersion)),`Unknown node ${n.type}`);
const existing=await api('/workflows');assert(!existing.some(w=>w.name===source.name),'Inspect existing ingestion workflow before importing');
const {id,active,...body}=source;
const workflow=await api('/workflows','POST',body);
const report={checkedAt:new Date().toISOString(),workflowId:workflow.id,status:'created',active:false,paid:true,privateDataSubmitted:false};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:'管理者手動匯入'}});
report.executionId=started.executionId;report.status='running';writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
let execution;
for(let i=0;i<300;i++){
 execution=await api(`/executions/${started.executionId}`);
 if(['success','error','crashed','canceled'].includes(execution.status))break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
report.status=execution.status;
const data=typeof execution.data==='string'?parse(execution.data):execution.data;
if(execution.status==='success')report.publication=data?.resultData?.runData?.['驗證整批並原子發布']?.[0]?.data?.main?.[0]?.[0]?.json;
else report.error=String(data?.resultData?.error?.message??'Execution did not finish').slice(0,300);
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
assert.equal(execution.status,'success','Ingestion did not complete; do not blindly retry paid calls');
