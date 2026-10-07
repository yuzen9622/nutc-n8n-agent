import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {session} from './n8n-client.mjs';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
import {parseAgentAnswer} from '../dist/apps/gateway/src/modules/tasks/task.schema.js';
const api=await session();
let template;
try{template=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));}
catch{throw new Error('Generated live workflow is missing or invalid; refusing to test.');}
const clone=id=>structuredClone(template.nodes.find(n=>n.id===id));
const agent=clone('agent'),chat=clone('gemini'),vector=clone('vector'),embedding=clone('embedding');
agent.parameters.text='請先使用 campus_knowledge 查詢：缺曠資料如果被誤記，應如何更正？請依查到的官方內容回答並列 sourceId。';
agent.parameters.options={...agent.parameters.options,returnIntermediateSteps:true,maxIterations:3};delete agent.onError;
vector.parameters.tableName='campus_knowledge_current';vector.parameters.includeDocumentMetadata=true;
for(const n of [chat,embedding])n.credentials={googlePalmApi:{id:'campus-live-gemini-proxy',name:'Campus Gemini proxy'}};
const start={id:'manual',name:'公開 Agent 真實驗證',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
const connections={};const link=(a,b,type='main')=>{connections[a]??={};connections[a][type]=[[{node:b,type,index:0}]];};
link(start.name,agent.name);link(chat.name,agent.name,'ai_languageModel');link(vector.name,agent.name,'ai_tool');link(embedding.name,vector.name,'ai_embedding');
const w=await api('/workflows','POST',{name:'TEMP public knowledge Agent evidence verification',nodes:[start,agent,chat,vector,embedding],connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all',executionTimeout:90},pinData:{}});
try{
 const started=await api(`/workflows/${w.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});let e;
 for(let i=0;i<100;i++){e=await api(`/executions/${started.executionId}`);if(['success','error','crashed','canceled'].includes(e.status))break;await new Promise(r=>setTimeout(r,1000));}
 const data=typeof e.data==='string'?parse(e.data):e.data;
 assert.equal(e.status,'success',String(data?.resultData?.error?.message??e.status));
 const result=data.resultData.runData[agent.name].at(-1).data.main[0][0].json;
 const report={checkedAt:new Date().toISOString(),status:'pass',executionId:started.executionId,privateDataSubmitted:false,result:{output:result.output,intermediateSteps:result.intermediateSteps.map(s=>({action:{tool:s.action.tool},observation:s.observation}))}};
 mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/knowledge-agent.json',JSON.stringify({...report,status:'captured'},null,2)+'\n');
 assert(result.intermediateSteps.some(s=>s.action.tool==='campus_knowledge'));
 const answer=parseAgentAnswer(result.output);assert(answer.sourceIds.length>0);assert(answer.answer.includes('老師')||answer.answer.includes('教師'));
 mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/knowledge-agent.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,result:{answer,steps:result.intermediateSteps.map(s=>({tool:s.action.tool,observation:s.observation.slice(0,600)}))}},null,2));
}finally{await api(`/workflows/${w.id}/archive`,'POST');await api(`/workflows/${w.id}`,'DELETE');}
