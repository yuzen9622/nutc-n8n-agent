import {session} from './n8n-client.mjs';
import {importCredentials} from './n8n-credentials.mjs';
import {requiredEnv} from './env.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
const credential={id:'campus-live-gemini-proxy',name:'Campus Gemini budget proxy',type:'googlePalmApi',data:{host:'http://gateway:3100/providers/gemini',apiKey:requiredEnv('GEMINI_PROXY_TOKEN')}};
importCredentials([credential]);
const api=await session(),template=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
const clone=id=>structuredClone(template.nodes.find(node=>node.id===id));
const chat=clone('gemini'),embedding=clone('embedding'),vector=clone('vector');
for(const node of [chat,embedding])node.credentials={googlePalmApi:{id:credential.id,name:credential.name}};
chat.parameters={modelName:requiredEnv('GEMINI_CHAT_MODEL'),options:{maxOutputTokens:2048,temperature:0.2}};
embedding.parameters={modelName:requiredEnv('GEMINI_EMBEDDING_MODEL')};
vector.parameters={...vector.parameters,mode:'load',prompt:'國立臺中科技大學公開資訊',topK:1};
const start={id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
const chain={id:'chain',name:'原生 Gemini 測試',type:'@n8n/n8n-nodes-langchain.chainLlm',typeVersion:1.9,position:[300,0],parameters:{promptType:'define',text:'請只回覆「連線成功」。這是公開 API 測試。',batching:{}}};
const connections={};const link=(a,b,type='main')=>{connections[a]??={};connections[a][type]=[[{node:b,type,index:0}]];};
link(start.name,chain.name);link(chat.name,chain.name,'ai_languageModel');link(chain.name,vector.name);link(embedding.name,vector.name,'ai_embedding');
const workflow=await api('/workflows','POST',{name:'TEMP budgeted native Gemini and Embeddings verification',nodes:[start,chain,chat,vector,embedding],connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
try{
 const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});let execution;
 for(let i=0;i<90;i++){execution=await api(`/executions/${started.executionId}`);if(['success','error','crashed','canceled'].includes(execution.status))break;await new Promise(r=>setTimeout(r,500));}
 const data=typeof execution.data==='string'?parse(execution.data):execution.data;
 if(execution.status!=='success'){
  const message=String(data?.resultData?.error?.message??execution.status).replaceAll(requiredEnv('GEMINI_PROXY_TOKEN'),'[redacted]');throw Error(`Native Gemini probe failed: ${message.slice(0,500)}`);
 }
 assert(data.resultData.runData[chain.name]?.length);assert(data.resultData.runData[vector.name]?.length);
 const report={checkedAt:new Date().toISOString(),executionId:started.executionId,status:'pass',chat:'native Gemini model connected to Basic LLM Chain',embedding:'native Gemini Embeddings connected to PGVector load',corpus:'empty table; this does not prove document retrieval',credentials:'proxy credential only; real keys remain in gateway .env',budget:'all calls through durable shared reservation',privateDataSubmitted:false};
 writeFileSync('docs/verification/native-live-gemini.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');}
