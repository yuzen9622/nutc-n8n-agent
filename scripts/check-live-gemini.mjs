import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import './env.mjs';
import {runtimeEnv} from '../apps/shared/runtime-config.mjs';
const env=runtimeEnv(process.env);
if(!env.N8N_WEBHOOK_TOKEN)throw new Error('APP_MASTER_KEY_REQUIRED');
// Gemini keys/models are managed by n8n; this single paid public-query check goes through the n8n search workflow.
const response=await fetch('http://127.0.0.1:15679/webhook/campus-google-search',{method:'POST',redirect:'error',headers:{'content-type':'application/json','X-Campus-Webhook':env.N8N_WEBHOOK_TOKEN},body:JSON.stringify({query:'國立臺中科技大學 官方網站'}),signal:AbortSignal.timeout(35000)});
if(!response.ok)throw new Error(`search workflow failed: HTTP ${response.status}`);
const result=await response.json();
const candidate=result.candidates?.[0];
assert(candidate?.content?.parts?.some(part=>typeof part.text==='string'&&part.text.trim()));
assert(candidate.groundingMetadata?.groundingChunks?.length>0);
const report={checkedAt:new Date().toISOString(),via:'n8n campusGoogleSearch webhook',searchStatus:'pass',sources:candidate.groundingMetadata.groundingChunks.length,usage:result.usageMetadata??null,privateDataSubmitted:false,paidAttempts:1};
mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/live-gemini.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
