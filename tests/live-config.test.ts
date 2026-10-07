import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/gateway/src/config/env.js';
const base={APP_MODE:'live',LINE_DESTINATION:`U${'a'.repeat(32)}`,LINE_LOGIN_CHANNEL_ID:'2011885607',
 LINE_CHANNEL_SECRET:'test-line-secret',LINE_ACCESS_TOKEN:'test-access',SESSION_SECRET:'s'.repeat(40),SERVICE_TOKEN:'t'.repeat(40),DATABASE_URL:'postgresql://test',
 N8N_WEBHOOK_URL:'http://n8n:5678/webhook/campus-agent-live',N8N_WEBHOOK_TOKEN:'w'.repeat(40)};
const gemini={GEMINI_PROXY_TOKEN:'g'.repeat(40),GEMINI_CHAT_KEY:'test-chat-key',GEMINI_EMBEDDING_KEY:'test-embedding-key',GEMINI_CHAT_MODEL:'models/test-chat',GEMINI_EMBEDDING_MODEL:'models/test-embedding'};
test('live config supports direct secrets and has no worker or budget gate',()=>{
 const result=loadConfig(base);
 assert.equal(result.channelId,'2011885607');assert.equal(result.channelSecret,base.LINE_CHANNEL_SECRET);
 assert.equal(result.webhookUrl,base.N8N_WEBHOOK_URL);assert.equal(result.webhookToken,base.N8N_WEBHOOK_TOKEN);
 for(const field of ['enabled','dailyBudgetMicroUsd','totalBudgetMicroUsd','searchCostMicroUsd'])assert(!Object.hasOwn(result,field));
 assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET:undefined}),/LINE_CHANNEL_SECRET_REQUIRED/);
 assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET_FILE:'/must-not-read'}),/Use LINE_CHANNEL_SECRET in .env/);
 assert.throws(()=>loadConfig({...base,SERVICE_TOKEN:base.SESSION_SECRET}),/INVALID_SERVICE_TOKEN/);
});
test('legacy zero budgets and disabled worker values are ignored rather than restoring gates',()=>{
 const setup={...base,...gemini};
 assert.deepEqual(loadConfig({...setup,LIVE_AGENT_ENABLED:'false',PROVIDER_DAILY_BUDGET_MICRO_USD:'0',PROVIDER_TOTAL_BUDGET_MICRO_USD:'0',GEMINI_CHAT_MAX_COST_MICRO_USD:'0',GEMINI_EMBEDDING_MAX_COST_MICRO_USD:'0',GOOGLE_SEARCH_MAX_COST_MICRO_USD:'0',BRAVE_REQUEST_MAX_MICRO_USD:'0'}),loadConfig(setup));
});
test('dispatch URL/token are required and token separation is retained',()=>{
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_URL:undefined}));
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_TOKEN:undefined}));
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_URL:'not-a-url'}));
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_TOKEN:'short'}),/INVALID_WEBHOOK_TOKEN/);
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_TOKEN:base.SERVICE_TOKEN}),/INVALID_WEBHOOK_TOKEN/);
 assert.throws(()=>loadConfig({...base,N8N_WEBHOOK_TOKEN:base.SESSION_SECRET}),/INVALID_WEBHOOK_TOKEN/);
});
test('Gemini config needs credentials/models but no cost fields',()=>{
 const result=loadConfig({...base,...gemini});
 assert.deepEqual(result.gemini,{token:gemini.GEMINI_PROXY_TOKEN,chatKey:gemini.GEMINI_CHAT_KEY,embeddingKey:gemini.GEMINI_EMBEDDING_KEY,chatModel:gemini.GEMINI_CHAT_MODEL,embeddingModel:gemini.GEMINI_EMBEDDING_MODEL});
 assert.throws(()=>loadConfig({...base,...gemini,GEMINI_CHAT_KEY:undefined}),/GEMINI_PROXY_CONFIGURATION_INCOMPLETE/);
 assert.throws(()=>loadConfig({...base,...gemini,GEMINI_PROXY_TOKEN:base.SESSION_SECRET}),/INVALID_GEMINI_PROXY_TOKEN/);
});
test('Google Search stays disabled independently, and enabling requires model and public origin',()=>{
 const setup={...base,...gemini,PUBLIC_ORIGIN:'https://campus.example',LIFF_ID:'2011885607-test'};
 assert.equal(loadConfig(setup).grounding,undefined);
 assert.deepEqual(loadConfig({...setup,GOOGLE_SEARCH_ENABLED:'true'}).grounding,{key:gemini.GEMINI_CHAT_KEY,model:gemini.GEMINI_CHAT_MODEL});
 assert.throws(()=>loadConfig({...base,GOOGLE_SEARCH_ENABLED:'true'}),/GOOGLE_SEARCH_CONFIGURATION_INCOMPLETE/);
 assert.throws(()=>loadConfig({...base,...gemini,GOOGLE_SEARCH_ENABLED:'true'}),/GOOGLE_SEARCH_CONFIGURATION_INCOMPLETE/);
});
test('LIFF config requires the correct login channel and a bare HTTPS origin',()=>{
 const setup={...base,PUBLIC_ORIGIN:'https://campus.example',LIFF_ID:'2011885607-test'};
 assert.equal(loadConfig(setup).publicOrigin,setup.PUBLIC_ORIGIN);
 assert.throws(()=>loadConfig({...setup,LIFF_ID:'2011885580-test'}),/CHANNEL_MISMATCH/);
 for(const PUBLIC_ORIGIN of ['http://campus.example','https://campus.example/','https://campus.example/liff/','https://user:password@campus.example'])assert.throws(()=>loadConfig({...setup,PUBLIC_ORIGIN}),/INVALID_PUBLIC_ORIGIN/);
});
