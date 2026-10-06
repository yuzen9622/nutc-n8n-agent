import {session,base} from './n8n-client.mjs';
import {parse} from 'flatted';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const api=await session();
const token=readFileSync('.local/secrets/webhook','utf8');
const before=await api('/executions?limit=20');const known=new Set(before.results.map(x=>x.id));
const denied=await fetch(`${base}/webhook/campus-message-v1`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
const response=await fetch(`${base}/webhook/campus-message-v1`,{method:'POST',headers:{'Content-Type':'application/json','X-Campus-Webhook':token},body:JSON.stringify({taskId:'synthetic-missing-task',requestId:'synthetic-error-probe',taskCapability:'invalid',deadlineAt:new Date(Date.now()+90_000).toISOString()})});
assert.equal(response.status,200);
let errorRun;const deadline=Date.now()+30_000;
while(Date.now()<deadline){const list=await api('/executions?limit=20');errorRun=list.results.find(x=>!known.has(x.id)&&x.workflowId==='campusWF04phase1'&&x.status==='success');if(errorRun)break;await new Promise(r=>setTimeout(r,500));}
assert(errorRun,'Automatic Error Trigger did not run');const execution=await api(`/executions/${errorRun.id}`);const data=typeof execution.data==='string'?parse(execution.data):execution.data;
const output=data.resultData.runData['E02 只留監控識別'][0].data.main[0][0].json;
assert.deepEqual(Object.keys(output).sort(),['errorCode','executionId','workflowId']);assert.equal(output.workflowId,'campusWF01phase1');
const report={status:'pass',webhookRejectedWithoutAuth:denied.status,webhookAcceptedWithAuth:response.status,errorExecutionId:errorRun.id,mode:execution.mode,redactedFields:Object.keys(output)};
writeFileSync('docs/verification/webhook-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
