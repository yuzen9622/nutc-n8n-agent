import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {requiredEnv} from './env.mjs';
const call=async(model,operation,body)=>{
 const response=await fetch(`http://127.0.0.1:3100/providers/gemini/v1beta/${model}:${operation}`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':requiredEnv('GEMINI_PROXY_TOKEN')},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
 if(!response.ok)throw new Error(`${operation} failed: HTTP ${response.status}`);
 return response.json();
};
const chat=await call(requiredEnv('GEMINI_CHAT_MODEL'),'generateContent',{contents:[{role:'user',parts:[{text:'請只回覆「連線成功」。這是公開的 API 連線測試。'}]}],generationConfig:{maxOutputTokens:512,thinkingConfig:{thinkingLevel:'low'}}});
assert(chat.candidates?.some(candidate=>candidate.content?.parts?.some(part=>typeof part.text==='string'&&part.text.trim())));
const embedding=await call(requiredEnv('GEMINI_EMBEDDING_MODEL'),'embedContent',{model:requiredEnv('GEMINI_EMBEDDING_MODEL'),content:{parts:[{text:'國立臺中科技大學公開校園資訊'}]},taskType:'RETRIEVAL_QUERY'});
assert(embedding.embedding?.values?.length>0 && embedding.embedding.values.every(Number.isFinite));
const report={checkedAt:new Date().toISOString(),proxy:'actual deployed gateway model proxy',chatModel:requiredEnv('GEMINI_CHAT_MODEL'),chatStatus:'pass',usage:chat.usageMetadata??null,embeddingModel:requiredEnv('GEMINI_EMBEDDING_MODEL'),embeddingDimensions:embedding.embedding.values.length,embeddingStatus:'pass',privateDataSubmitted:false,paidAttempts:2};
mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/live-gemini.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
