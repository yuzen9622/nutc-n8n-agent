import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';

assert.equal(base,'http://localhost:15679','Only the known local n8n instance is permitted');
const api=await session();
let source;
try{source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));}
catch{throw new Error('Generated live workflow is missing or invalid; refusing to test or update.');}
const candidate=source.nodes.find(n=>n.id==='agent').parameters.options.systemMessage;
assert(candidate.startsWith('={{ ')&&candidate.endsWith(' }}'));
const report={checkedAt:new Date().toISOString(),status:'partial',n8n:'2.41.7',workflowId:source.id,
  modelCalls:'not-run',lineClientAnimation:'requires human mobile chat verification',fullProjectBuild:'blocked by pre-existing mock source deletions'};
let probe;
try {
  probe=await api('/workflows','POST',{
    name:'TEMP LINE UX clock expression verification',
    nodes:[{id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},
      {id:'clock',name:'時間上下文',type:'n8n-nodes-base.set',typeVersion:3.4,position:[240,0],parameters:{mode:'raw',options:{},
        jsonOutput:'={{ JSON.stringify({ systemMessage: '+candidate.slice(4,-3)+", midnight: $now.setZone('UTC').set({year:2026,month:10,day:6,hour:16,minute:1,second:0,millisecond:0}).setZone('Asia/Taipei').setLocale('zh-TW').toFormat('yyyy-MM-dd cccc HH:mm:ss') }) }}"}}],
    connections:{'測試入口':{main:[[{node:'時間上下文',type:'main',index:0}]]}},
    settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{},
  });
  const before=Date.now();
  const started=await api(`/workflows/${probe.id}/run`,'POST',{triggerToStartFrom:{name:'測試入口'}});
  let execution;
  for(let attempt=0;attempt<60;attempt++){
    execution=await api(`/executions/${started.executionId}`);
    if(['success','error','crashed','canceled'].includes(execution.status))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(execution?.status,'success','Clock workflow execution failed');
  const data=typeof execution.data==='string'?parse(execution.data):execution.data;
  const result=data.resultData.runData['時間上下文'].at(-1).data.main[0][0].json;
  assert(!result.systemMessage.includes('$now'));
  const clock=result.systemMessage.match(/：(\d{4}-\d{2}-\d{2}) (星期.) (\d{2}:\d{2}:\d{2})$/);
  assert(clock,'Expected Taiwan date, weekday and seconds');
  const time=new Date(`${clock[1]}T${clock[3]}+08:00`).getTime();
  assert(time>=before-1000&&time<=Date.now()+1000,'Clock must reflect this actual execution');
  assert.equal(result.midnight,'2026-10-07 星期三 00:01:00');
  report.clock={actualExecution:true,executionId:started.executionId,renderedTime:clock[0].slice(1),midnightRollover:true,expressionMatchesAgent:true};
  if(process.argv.includes('--update-live')){
    const live=await api(`/workflows/${source.id}`);
    assert.equal(live.id,'campusNativeAgentLive');
    assert(!live.active||live.activeVersionId===live.versionId,'Refusing to publish unrelated unsaved changes');
    mkdirSync('.local',{recursive:true});
    writeFileSync('.local/line-experience-workflow-before.json',JSON.stringify(live),{mode:0o600});
    const nodes=structuredClone(live.nodes),agent=nodes.find(n=>n.id==='agent');
    assert(agent);agent.parameters.options.systemMessage=candidate;
    let updated=live;
    if(live.nodes.find(n=>n.id==='agent').parameters.options.systemMessage!==candidate){
      updated=await api(`/workflows/${source.id}`,'PATCH',{nodes,versionId:live.versionId});
      if(live.active)await api(`/workflows/${source.id}/activate`,'POST',{versionId:updated.versionId});
    }
    const actual=await api(`/workflows/${source.id}`);
    assert.equal(actual.active,live.active);
    assert.deepEqual(actual.nodes,nodes);assert.deepEqual(actual.connections,live.connections);
    if(live.active)assert.equal(actual.activeVersionId,actual.versionId);
    report.deployment={promptUpdated:true,versionId:actual.versionId,published:actual.active,otherNodesAndConnectionsPreserved:true};
  }
  report.status='pass-in-tested-scope';
} finally {
  if(probe){await api(`/workflows/${probe.id}/archive`,'POST');await api(`/workflows/${probe.id}`,'DELETE');report.probeCleanup=true;}
  writeFileSync('docs/verification/line-experience-runtime.json',JSON.stringify(report,null,2)+'\n');
}
console.log('Clock expression ran in local n8n with Taiwan midnight rollover; no model or LINE calls.');
