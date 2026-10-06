import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';
import {parseAgentAnswer} from '../dist/apps/gateway/src/modules/tasks/task.schema.js';
import {knowledgeEvidence} from '../dist/apps/gateway/src/modules/knowledge/knowledge.evidence.js';

assert.equal(base,'http://localhost:15679');
const readJson=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('QA input/report JSON unavailable or malformed; refusing paid execution.');}};
const manifest=readJson('docs/qa/phase-2-5.json');
const args=process.argv.slice(2),retry=args[0]==='--retry-reviewed';
const ids=retry?args.slice(1):args;assert(ids.length>0&&ids.length<=8&&(!retry||ids.length===1),'Select 1–8 explicit cases, or retry one reviewed failure');
assert.equal(new Set(ids).size,ids.length);
const selected=ids.map(id=>{const entry=manifest.cases.find(c=>c.id===id);assert(entry&&['knowledge','refusal'].includes(entry.category)&&!['QA-10','QA-11','QA-37'].includes(id),'Only standalone public questions are supported by this harness');return entry;});
const path='docs/verification/public-qa.json';
const report=existsSync(path)?readJson(path):{scope:'Native Gemini Agent and real PGVector corpus; not LINE, Memory, live search or private tools',cases:[]};
for(const id of ids){
  const prior=report.cases.filter(c=>c.id===id).at(-1);
  const reviewedRetry=prior?.status==='needs-fix'||(prior?.status==='execution-failed'&&prior.review?.retryApproved===true);
  assert(retry?reviewedRetry:!prior,'Inspect and review prior case evidence before any paid retry');
}
const save=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const api=await session(),template=readJson('workflows/agent/campusNativeAgentLive.json');
const templateSha256=createHash('sha256').update(JSON.stringify(template)).digest('hex');
for(const entry of selected){
  const clone=id=>structuredClone(template.nodes.find(n=>n.id===id));
  const agent=clone('agent'),chat=clone('gemini'),vector=clone('vector'),embedding=clone('embedding');
  agent.parameters.text=entry.question;delete agent.onError;
  const start={id:'manual',name:'公開問答驗收',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
  const connections={};const link=(a,b,type='main')=>{connections[a]??={};connections[a][type]=[[{node:b,type,index:0}]];};
  link(start.name,agent.name);link(chat.name,agent.name,'ai_languageModel');link(vector.name,agent.name,'ai_tool');link(embedding.name,vector.name,'ai_embedding');
  const record={id:entry.id,attempt:report.cases.filter(c=>c.id===entry.id).length+1,templateSha256,question:entry.question,expected:entry.expected,status:'creating',startedAt:new Date().toISOString()};
  report.cases.push(record);save();
  const workflow=await api('/workflows','POST',{name:`TEMP public QA ${entry.id}`,nodes:[start,agent,chat,vector,embedding],connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all',executionTimeout:90},pinData:{}});
  record.workflowId=workflow.id;record.status='created';save();
  const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});
  record.executionId=started.executionId;record.status='running';save();
  let execution;
  for(let i=0;i<100;i++){
    execution=await api(`/executions/${started.executionId}`);
    if(['success','error','crashed','canceled'].includes(execution.status))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  record.executionStatus=execution.status;save();
  if(!['success','error','crashed','canceled'].includes(execution.status))throw new Error(`Inspect live execution ${started.executionId}; do not restart`);
  try{
    const data=typeof execution.data==='string'?parse(execution.data):execution.data;
    if(execution.status!=='success'){
      record.status='execution-failed';record.failedNode=data?.resultData?.lastNodeExecuted;
      // Keep only known fixed error codes, never reflected provider inputs or credentials.
      const diagnostic=JSON.stringify(data?.resultData?.error??{});
      record.failureCodes=['DAILY_PROVIDER_BUDGET','TOTAL_PROVIDER_BUDGET','RESOURCE_EXHAUSTED','PROVIDER_RESPONSE_INVALID'].filter(code=>diagnostic.includes(code));
      save();throw new Error(`Case ${entry.id} failed; stop paid batch`);
    }
    const result=data.resultData.runData[agent.name].at(-1).data.main[0][0].json;
    record.output=result.output;
    record.steps=(result.intermediateSteps??[]).map(s=>({tool:s.action.tool,observation:s.observation}));
    record.status='captured';save();
    try{
      record.answer=parseAgentAnswer(result.output);
      const evidence=knowledgeEvidence(record.steps.filter(s=>s.tool==='campus_knowledge').map(s=>s.observation));
      record.citationsFromCurrentRetrieval=record.answer.sourceIds.every(id=>evidence.some(e=>e.sourceId===id));
      record.retrievedChunkCount=evidence.length;
      record.status=record.citationsFromCurrentRetrieval?'needs-semantic-review':'citation-failed';
    }catch{record.status='contract-failed';}
    record.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({id:entry.id,executionId:record.executionId,status:record.status,answer:record.answer??record.output}));
  }finally{
    if(execution.status==='success'){
      await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');
      record.temporaryWorkflowRemoved=true;
    }else record.temporaryWorkflowRetainedForDiagnosis=true;
    save();
  }
}
