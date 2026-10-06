import {parse as parseFlatted} from 'flatted';
import {session,base} from './n8n-client.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const api=await session();
const fixtures=JSON.parse(readFileSync('tests/fixtures/scenarios.json'));
const selected=process.argv.slice(2);const cases=selected.length?fixtures.filter(f=>selected.includes(f.scenario)):fixtures;
const report=[];
async function run(id,trigger,data) {
 const run=await api(`/workflows/${id}/run`,'POST',{triggerToStartFrom:{name:trigger,...(data?{data:{main:[[{json:data}]]}}:{})}});
 const executionId=run.executionId;assert(executionId,JSON.stringify(run));
 const deadline=Date.now()+110_000;
 while(Date.now()<deadline) {
  const execution=await api(`/executions/${executionId}`);
  if(['success','error','crashed','canceled'].includes(execution.status))return {executionId,execution};
  await new Promise(r=>setTimeout(r,300));
 }
 throw new Error(`Execution ${executionId} timed out`);
}
const baseline=await api('/workflows/campusWF06phase1');
try {
for(const fixture of cases) {
 const workflow=await api('/workflows/campusWF06phase1');
 workflow.nodes.find(n=>n.id==='D02').parameters.jsonOutput='={{ JSON.stringify('+JSON.stringify({scenario:fixture.scenario})+') }}';
 await api('/workflows/campusWF06phase1','PATCH',{name:workflow.name,nodes:workflow.nodes,connections:workflow.connections,settings:workflow.settings,versionId:workflow.versionId});
 const {executionId,execution}=await run('campusWF06phase1','D01 手動展示');
 // n8n REST returns flattened execution data on some versions; full decode below is runtime-specific.
 const data=typeof execution.data==='string'?parseFlatted(execution.data):execution.data;
 const result={scenario:fixture.scenario,executionId,status:execution.status,expectedOutcome:fixture.expectedOutcome};
 mkdirSync('.local/executions',{recursive:true});writeFileSync(`.local/executions/${executionId}.json`,JSON.stringify(execution));
 if(execution.status!=='success') {console.log(JSON.stringify(result));console.log(JSON.stringify({error:data.resultData.error,lastNode:data.resultData.lastNodeExecuted}));throw new Error('Workflow failed; inspect local execution');}
 const output=data.resultData.runData['D06 展示合成結果'].at(-1).data.main[0][0].json;
 assert.equal(output.outcome,fixture.expectedOutcome,fixture.scenario);assert.equal(output.outboxCount,1);assert.equal(output.synthetic,true);assert.equal(output.delivered,false);
 Object.assign(result,{outcome:output.outcome,outboxCount:output.outboxCount,stages:output.stages});
 report.push(result);console.log(JSON.stringify(result));
}
} finally {
 const current=await api('/workflows/campusWF06phase1');
 await api('/workflows/campusWF06phase1','PATCH',{name:current.name,nodes:baseline.nodes,connections:baseline.connections,settings:baseline.settings,versionId:current.versionId});
}
mkdirSync('docs/verification',{recursive:true});writeFileSync(process.env.RUNTIME_REPORT || 'docs/verification/runtime-results.json',JSON.stringify({base,recordedAt:new Date().toISOString(),results:report},null,2)+'\n');
