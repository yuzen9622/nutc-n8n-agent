import {session,base} from './n8n-client.mjs';
import {parse as parseFlatted} from 'flatted';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const api=await session();const results=[];
for(const [number,trigger,data,last]of [
 [7,'K02 手動同步',null,'K10R 回復引用上下文'],
 [5,'T01M 手動維護',null,'T06 維護完成'],
 [4,'E01 執行錯誤',{workflow:{id:'synthetic-workflow'},execution:{id:'synthetic-execution',error:{message:'DO_NOT_FORWARD'}}},'E03R 回復引用上下文'],
]) {
 const started=await api(`/workflows/campusWF0${number}phase1/run`,'POST',{triggerToStartFrom:{name:trigger,...(data?{data:{main:[[{json:data}]]}}:{})}});
 let execution;const deadline=Date.now()+90_000;
 do {execution=await api(`/executions/${started.executionId}`);if(['success','error','crashed'].includes(execution.status))break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline);
 assert.equal(execution.status,'success',JSON.stringify(execution).slice(-1500));
 const decoded=typeof execution.data==='string'?parseFlatted(execution.data):execution.data;
 const output=decoded.resultData.runData[last].at(-1).data.main[0][0].json;
 if(number===7){assert.equal(output.published,1);assert.deepEqual(output.counts,{updated:1,unchanged:1,withdrawn:1,failed:1});}
 if(number===5)assert.equal(output.healthy,true);
 if(number===4){assert.equal(output.recorded,true);assert(!JSON.stringify(output).includes('DO_NOT_FORWARD'));}
 const result={workflow:`WF-0${number}`,executionId:started.executionId,status:'pass',output};results.push(result);console.log(JSON.stringify(result));
}
writeFileSync('docs/verification/system-results.json',JSON.stringify({base,recordedAt:new Date().toISOString(),results},null,2)+'\n');
