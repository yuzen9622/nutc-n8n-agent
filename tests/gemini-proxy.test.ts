import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeminiProvider} from '../apps/gateway/src/modules/gemini/gemini.provider.js';
import type {BudgetRepository} from '../apps/gateway/src/modules/budget/budget.repository.js';
const config={token:'proxy-token',chatKey:'private-google-chat-key',embeddingKey:'private-google-embedding-key',chatModel:'models/test-chat',embeddingModel:'models/test-embedding',chatMaxCostMicroUsd:50,embeddingMaxCostMicroUsd:10};
const raw=(value:unknown)=>Buffer.from(JSON.stringify(value));
const chat='/providers/gemini/v1beta/models/test-chat:generateContent';
const input={contents:[{role:'user',parts:[{text:'public test question'}]}],generationConfig:{maxOutputTokens:8000}};
test('Gemini relay reserves before network, clamps output, and swaps proxy credentials',async()=>{
  const steps:string[]=[];
  const budget={reserve:async(task,provider,amount)=>{assert.equal(task,null);assert.equal(provider,'gemini');assert.equal(amount,50);steps.push('reserve');return 'id';}} satisfies Pick<BudgetRepository,'reserve'>;
  const proxy=new GeminiProvider(config,budget as BudgetRepository,async(url,options)=>{
    steps.push('network');assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/test-chat:generateContent');
    assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],config.chatKey);
    assert.equal(JSON.parse(String(options?.body)).generationConfig.maxOutputTokens,2048);
    return Response.json({candidates:[]});
  });
  const response=await proxy.relay(chat,config.token,raw(input));assert.equal(response.status,200);assert.deepEqual(steps,['reserve','network']);
});
test('every SDK retry needs a new reservation; denied reservations prevent all network calls',async()=>{
  let reserves=0,calls=0;
  const proxy=new GeminiProvider(config,{reserve:async()=>{reserves++;throw Error('budget');}} as unknown as BudgetRepository,async()=>{calls++;return Response.json({});});
  for(let i=0;i<2;i++) await assert.rejects(proxy.relay(chat,config.token,raw(input)),/budget/);
  assert.equal(reserves,2);assert.equal(calls,0);
});
test('proxy rejects wrong credentials, models, files, paid built-in tools and multiple candidates',async()=>{
  let calls=0;
  const proxy=new GeminiProvider(config,{reserve:async()=>{calls++;return 'id';}} as unknown as BudgetRepository);
  await assert.rejects(proxy.relay(chat,'wrong',raw(input)));
  await assert.rejects(proxy.relay(chat.replace('test-chat','other'),config.token,raw(input)));
  for(const body of [{...input,contents:[{parts:[{fileData:{fileUri:'https://private'}}]}]}, {...input,tools:[{googleSearch:{}}]}, {...input,tools:[{otherPaidTool:{}}]}, {...input,generationConfig:{candidateCount:2}}, {...input,generationConfig:{responseModalities:['IMAGE']}}, {...input,cachedContent:'private-cache'}]) await assert.rejects(proxy.relay(chat,config.token,raw(body)));
  assert.equal(calls,0);
});
test('embedding calls share the budget and cannot choose another model inside the batch',async()=>{
  const proxy=new GeminiProvider(config,{reserve:async(_task,provider,amount)=>{assert.equal(provider,'embedding');assert.equal(amount,10);return 'id';}} as BudgetRepository,async(_url,options)=>{
    assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],config.embeddingKey);return Response.json({embeddings:[{values:[1,0]}]});
  });
  const path='/providers/gemini/v1beta/models/test-embedding:batchEmbedContents';
  assert.equal((await proxy.relay(path,config.token,raw({requests:[{model:config.embeddingModel,content:{parts:[{text:'official text'}]}}]}))).status,200);
  await assert.rejects(proxy.relay(path,config.token,raw({requests:[{model:'models/other'}]})));
});
test('provider failure text is not reflected and SSE bytes remain compatible',async()=>{
  const budget={reserve:async()=> 'id'} as unknown as BudgetRepository;
  const failure=await new GeminiProvider(config,budget,async()=>new Response('private prompt and secret',{status:400})).relay(chat,config.token,raw(input));
  assert(!failure.body.toString().includes('secret'));
  const sse='data: {"candidates":[]}\n\n';
  const response=await new GeminiProvider(config,budget,async()=>new Response(sse,{headers:{'content-type':'text/event-stream'}})).relay(chat.replace('generateContent','streamGenerateContent')+'?alt=sse',config.token,raw(input));
  assert.equal(response.body.toString(),sse);
});
test('verified successful chat usage reduces reservation conservatively; missing usage never does',async()=>{
 let settled:number|undefined;
 const priced={...config,chatModel:'models/gemini-3.8-flash',chatMaxCostMicroUsd:250000};
 const budget={reserve:async()=> 'reservation',settle:async(_id:string,amount:number)=>{settled=amount;}} as unknown as BudgetRepository;
 const path='/providers/gemini/v1beta/models/gemini-3.8-flash:generateContent';
 await new GeminiProvider(priced,budget,async()=>Response.json({usageMetadata:{totalTokenCount:100}})).relay(path,config.token,raw(input));
 if(Date.now()<Date.parse('2027-01-01T00:00:00Z'))assert.equal(settled,375);
 settled=undefined;await new GeminiProvider(priced,budget,async()=>Response.json({candidates:[]})).relay(path,config.token,raw(input));assert.equal(settled,undefined);
});
test('token-only relay records exact upstream status before sanitizing client errors',async()=>{
 for(const status of [200,400,403,429,500,503]){
  const outcomes:number[]=[];
  const budget={reserve:async()=> 'reservation',recordTokenOnlyResponse:async(id:string,value:number)=>{assert.equal(id,'reservation');outcomes.push(value);}} as unknown as BudgetRepository;
  const proxy=new GeminiProvider(config,budget,async()=>status===200?Response.json({candidates:[]}):new Response('private failure',{status}));
  const response=await proxy.relay(chat,config.token,raw(input));assert.deepEqual(outcomes,[status]);
  assert.equal(response.status,status===200?200:status===429?429:status>=500?503:400);
 }
});
test('ambiguous transport failures retain reservation and an audit write failure does not retry the model',async()=>{
 let calls=0,outcomes=0;
 const budget={reserve:async()=> 'reservation',recordTokenOnlyResponse:async()=>{outcomes++;throw Error('database down');}} as unknown as BudgetRepository;
 await assert.rejects(new GeminiProvider(config,budget,async()=>{calls++;throw Error('transport timeout');}).relay(chat,config.token,raw(input)));
 assert.equal(outcomes,0);assert.equal(calls,1);
 const response=await new GeminiProvider(config,budget,async()=>{calls++;return Response.json({candidates:[]});}).relay(chat,config.token,raw(input));
 assert.equal(response.status,200);assert.equal(calls,2);assert.equal(outcomes,1);
});
