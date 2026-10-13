import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/gateway/src/config/env.js';
import { runtimeEnv } from '../apps/shared/runtime-config.mjs';
const base={APP_MODE:'live',LINE_DESTINATION:`U${'a'.repeat(32)}`,LINE_LOGIN_CHANNEL_ID:'2011885607',
 LINE_CHANNEL_SECRET:'test-line-secret',LINE_ACCESS_TOKEN:'test-access',APP_MASTER_KEY:'a1'.repeat(32),POSTGRES_PASSWORD:'test-password',
 N8N_WEBHOOK_URL:'http://n8n:5678/webhook/campus-agent-live'};
const derived=runtimeEnv(base);
const gemini={GEMINI_PROXY_TOKEN:'g'.repeat(40),GEMINI_CHAT_KEY:'test-chat-key',GEMINI_EMBEDDING_KEY:'test-embedding-key',GEMINI_CHAT_MODEL:'models/test-chat',GEMINI_EMBEDDING_MODEL:'models/test-embedding'};
test('live config derives internal secrets and has no worker or budget gate',()=>{
 const result=loadConfig(base);
 assert.equal(result.channelId,'2011885607');assert.equal(result.channelSecret,base.LINE_CHANNEL_SECRET);
 assert.equal(result.webhookUrl,base.N8N_WEBHOOK_URL);assert.equal(result.webhookToken,derived.N8N_WEBHOOK_TOKEN);
 for(const field of ['enabled','dailyBudgetMicroUsd','totalBudgetMicroUsd','searchCostMicroUsd'])assert(!Object.hasOwn(result,field));
 assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET:undefined}),/LINE_CHANNEL_SECRET_REQUIRED/);
 assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET_FILE:'/must-not-read'}),/Use LINE_CHANNEL_SECRET in .env/);
 assert.throws(()=>loadConfig({...base,SERVICE_TOKEN:derived.SESSION_SECRET}),/LEGACY_APP_SECRETS_PRESENT/);
});
test('legacy zero budgets and disabled worker values are ignored rather than restoring gates',()=>{
 const setup={...base,...gemini};
 assert.deepEqual(loadConfig({...setup,LIVE_AGENT_ENABLED:'false',PROVIDER_DAILY_BUDGET_MICRO_USD:'0',PROVIDER_TOTAL_BUDGET_MICRO_USD:'0',GEMINI_CHAT_MAX_COST_MICRO_USD:'0',GEMINI_EMBEDDING_MAX_COST_MICRO_USD:'0',GOOGLE_SEARCH_MAX_COST_MICRO_USD:'0',BRAVE_REQUEST_MAX_MICRO_USD:'0'}),loadConfig(setup));
});
test('dispatch has an internal default and rejects ambiguous or missing key configuration',()=>{
 assert.equal(loadConfig({...base,N8N_WEBHOOK_URL:undefined}).webhookUrl,base.N8N_WEBHOOK_URL);
 assert.throws(()=>loadConfig({...base,APP_MASTER_KEY:undefined}),/APP_MASTER_KEY_REQUIRED/);
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_URL:'not-a-url'}));
 for(const N8N_WEBHOOK_TOKEN of ['short',derived.SERVICE_TOKEN,derived.SESSION_SECRET])assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_TOKEN}),/LEGACY_APP_SECRETS_PRESENT/);
 const result=loadConfig(base);assert.notEqual(result.webhookToken,result.serviceToken);assert.notEqual(result.webhookToken,result.sessionSecret);
});
test('gateway never loads Google credentials or models, even when old env fields remain',()=>{
 const result=loadConfig({...base,...gemini});
 assert.deepEqual(result,loadConfig(base));
 assert.equal(Object.hasOwn(result,'gemini'),false);
 assert(!JSON.stringify(result).includes(gemini.GEMINI_CHAT_KEY));
 assert.deepEqual(loadConfig({...base,GEMINI_CHAT_KEY:'partial-old-config'}),loadConfig(base));
});
test('Google Search stays disabled independently and calls only the n8n search workflow',()=>{
 const setup={...base,PUBLIC_ORIGIN:'https://campus.example',LIFF_ID:'2011885607-test'};
 assert.equal(loadConfig(setup).grounding,undefined);
 assert.deepEqual(loadConfig({...setup,GOOGLE_SEARCH_ENABLED:'true'}).grounding,{url:'http://n8n:5678/webhook/campus-google-search',token:derived.N8N_WEBHOOK_TOKEN});
 assert.throws(()=>loadConfig({...base,GOOGLE_SEARCH_ENABLED:'true'}),/GOOGLE_SEARCH_CONFIGURATION_INCOMPLETE/);
});
test('LIFF config requires the correct login channel and a bare HTTPS origin',()=>{
 const setup={...base,PUBLIC_ORIGIN:'https://campus.example',LIFF_ID:'2011885607-test'};
 assert.equal(loadConfig(setup).publicOrigin,setup.PUBLIC_ORIGIN);
 assert.throws(()=>loadConfig({...setup,LIFF_ID:'2011885580-test'}),/CHANNEL_MISMATCH/);
 for(const PUBLIC_ORIGIN of ['http://campus.example','https://campus.example/','https://campus.example/liff/','https://user:password@campus.example'])assert.throws(()=>loadConfig({...setup,PUBLIC_ORIGIN}),/INVALID_PUBLIC_ORIGIN/);
});
