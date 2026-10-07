import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeminiProvider} from '../apps/gateway/src/modules/gemini/gemini.provider.js';
const config={token:'proxy-token',chatKey:'private-google-chat-key',embeddingKey:'private-google-embedding-key',chatModel:'models/test-chat',embeddingModel:'models/test-embedding'};
const raw=(value:unknown)=>Buffer.from(JSON.stringify(value));
const chat='/providers/gemini/v1beta/models/test-chat:generateContent';
const input={contents:[{role:'user',parts:[{text:'public test question'}]}],generationConfig:{maxOutputTokens:8000}};
test('Gemini relay needs no budget, clamps output and swaps proxy credentials',async()=>{
 let calls=0;
 const proxy=new GeminiProvider(config,async(url,options)=>{
  calls++;assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/test-chat:generateContent');
  assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],config.chatKey);
  assert.equal(JSON.parse(String(options?.body)).generationConfig.maxOutputTokens,2048);
  assert.equal(options?.redirect,'error');
  return Response.json({candidates:[]});
 });
 const response=await proxy.relay(chat,config.token,raw(input));assert.equal(response.status,200);assert.equal(calls,1);
});
test('each explicit relay attempt makes one provider request without a budget dependency',async()=>{
 let calls=0;
 const proxy=new GeminiProvider(config,async()=>{calls++;return Response.json({});});
 for(let i=0;i<2;i++)assert.equal((await proxy.relay(chat,config.token,raw(input))).status,200);
 assert.equal(calls,2);
});
test('proxy rejects wrong credentials, models, files, built-in tools and multiple candidates before network',async()=>{
 let calls=0;
 const proxy=new GeminiProvider(config,async()=>{calls++;return Response.json({});});
 await assert.rejects(proxy.relay(chat,'wrong',raw(input)));
 await assert.rejects(proxy.relay(chat.replace('test-chat','other'),config.token,raw(input)));
 for(const body of [{...input,contents:[{parts:[{fileData:{fileUri:'https://private'}}]}]}, {...input,tools:[{googleSearch:{}}]}, {...input,tools:[{otherTool:{}}]}, {...input,generationConfig:{candidateCount:2}}, {...input,generationConfig:{responseModalities:['IMAGE']}}, {...input,cachedContent:'private-cache'}])await assert.rejects(proxy.relay(chat,config.token,raw(body)));
 assert.equal(calls,0);
});
test('embedding uses its own key and cannot select another model inside the batch',async()=>{
 let calls=0;
 const proxy=new GeminiProvider(config,async(_url,options)=>{
  calls++;assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],config.embeddingKey);
  return Response.json({embeddings:[{values:[1,0]}]});
 });
 const path='/providers/gemini/v1beta/models/test-embedding:batchEmbedContents';
 assert.equal((await proxy.relay(path,config.token,raw({requests:[{model:config.embeddingModel,content:{parts:[{text:'official text'}]}}]}))).status,200);
 await assert.rejects(proxy.relay(path,config.token,raw({requests:[{model:'models/other'}]})));assert.equal(calls,1);
});
test('provider failure text is not reflected and SSE bytes remain compatible',async()=>{
 const failure=await new GeminiProvider(config,async()=>new Response('private prompt and secret',{status:400})).relay(chat,config.token,raw(input));
 assert(!failure.body.toString().includes('secret'));
 const sse='data: {"candidates":[]}\n\n';
 const response=await new GeminiProvider(config,async()=>new Response(sse,{headers:{'content-type':'text/event-stream'}})).relay(chat.replace('generateContent','streamGenerateContent')+'?alt=sse',config.token,raw(input));
 assert.equal(response.body.toString(),sse);
});
test('usage metadata is passed through without tariff or settlement requirements',async()=>{
 for(const payload of [{usageMetadata:{totalTokenCount:100}},{candidates:[]}]){
  const response=await new GeminiProvider(config,async()=>Response.json(payload)).relay(chat,config.token,raw(input));
  assert.deepEqual(JSON.parse(response.body.toString()),payload);
 }
});
test('upstream error statuses retain the sanitized client mapping',async()=>{
 for(const status of [200,400,403,429,500,503]){
  const proxy=new GeminiProvider(config,async()=>status===200?Response.json({candidates:[]}):new Response('private failure',{status}));
  const response=await proxy.relay(chat,config.token,raw(input));
  assert.equal(response.status,status===200?200:status===429?429:status>=500?503:400);
  assert(!response.body.toString().includes('private failure'));
 }
});
test('transport failures do not retry and response type/size limits remain enforced',async()=>{
 let calls=0;
 await assert.rejects(new GeminiProvider(config,async()=>{calls++;throw new Error('transport timeout');}).relay(chat,config.token,raw(input)),/transport timeout/);
 assert.equal(calls,1);
 await assert.rejects(new GeminiProvider(config,async()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}})).relay(chat,config.token,raw(input)),/PROVIDER_RESPONSE_INVALID/);
 await assert.rejects(new GeminiProvider(config,async()=>new Response('x'.repeat(4*1024*1024+1),{headers:{'content-type':'application/json'}})).relay(chat,config.token,raw(input)),/PROVIDER_RESPONSE_TOO_LARGE/);
});
