import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleGroundingProvider} from '../apps/gateway/src/modules/search/google-grounding.provider.js';
import {renderGroundedAnswer} from '../apps/gateway/src/modules/search/google-grounding.render.js';
import type {BudgetRepository} from '../apps/gateway/src/modules/budget/budget.repository.js';
const config={key:'test-secret',model:'models/gemini-3.8-flash',maxCostMicroUsd:50000};
const result=()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'internal thought',thought:true},{text:'查證後的統整答案'}]},groundingMetadata:{webSearchQueries:['中科大請假'],groundingChunks:[{web:{uri:'https://student.nutc.edu.tw/',title:'官方來源'}}],searchEntryPoint:{renderedContent:'<div><a href="https://www.google.com/search?q=nutc">搜尋建議</a></div>'}}}]});
test('official Google tool searches and synthesizes with existing Gemini key after budget reservation',async()=>{
 const steps:string[]=[];
 const budget={reserve:async(task:string,provider:string,amount:number)=>{assert.equal(task,'task');assert.equal(provider,'gemini');assert.equal(amount,50000);steps.push('budget');return 'reservation';}} as unknown as BudgetRepository;
 const provider=new GoogleGroundingProvider(config,budget,async(url,options)=>{
  steps.push('network');assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal((options!.headers as Record<string,string>)['x-goog-api-key'],'test-secret');assert.equal(options!.redirect,'error');
  const body=JSON.parse(String(options!.body));assert.deepEqual(body.tools,[{google_search:{}}]);assert.equal(body.contents[0].parts[0].text,'公開問題');assert.equal(body.generationConfig.candidateCount,1);
  return Response.json(result());
 });
 const answer=await provider.search('公開問題','task');assert.deepEqual(steps,['budget','network']);assert.equal(answer.answer,'查證後的統整答案');assert.equal(answer.sources.length,1);
 assert(renderGroundedAnswer(answer).includes(answer.suggestionsHtml));
});
test('budget denial prevents Google request and query validation runs before reservation',async()=>{
 let requests=0,reservations=0;
 const provider=new GoogleGroundingProvider(config,{reserve:async()=>{reservations++;throw Error('TOTAL_PROVIDER_BUDGET');}} as unknown as BudgetRepository,async()=>{requests++;return Response.json(result());});
 await assert.rejects(provider.search('','task'));assert.equal(reservations,0);
 await assert.rejects(provider.search('question','task'),/TOTAL_PROVIDER_BUDGET/);assert.equal(requests,0);
});
test('provider rejects ungrounded, truncated, unsafe URLs and oversized responses; errors never reflect provider body',async()=>{
 const budget={reserve:async()=> 'id'} as unknown as BudgetRepository;
 for(const change of [(v:any)=>{delete v.candidates[0].groundingMetadata;},(v:any)=>{v.candidates[0].finishReason='MAX_TOKENS';},(v:any)=>{v.candidates[0].groundingMetadata.groundingChunks[0].web.uri='javascript:alert(1)';}]){
  const value=result();change(value);await assert.rejects(new GoogleGroundingProvider(config,budget,async()=>Response.json(value)).search('question','task'),/GOOGLE_SEARCH_RESPONSE_INVALID/);
 }
 await assert.rejects(new GoogleGroundingProvider(config,budget,async()=>new Response('x'.repeat(256*1024+1))).search('question','task'),/GOOGLE_SEARCH_RESPONSE_TOO_LARGE/);
 await assert.rejects(new GoogleGroundingProvider(config,budget,async()=>new Response('secret reflected',{status:400})).search('question','task'),error=>String(error).includes('GOOGLE_SEARCH_UNAVAILABLE')&&!String(error).includes('secret reflected'));
});
test('render keeps answer literal, preserves safe Google suggestions, rejects active HTML and CSS',()=>{
 const value={answer:'<script>alert(1)</script>',sources:[{uri:'https://student.nutc.edu.tw/',title:'<img>'}],suggestionsHtml:'<style>.chip{color:blue}</style><a href="https://google.com/"><svg><path d="M0 0"/></svg>Google</a>'};
 const html=renderGroundedAnswer(value);assert(html.includes('&lt;script&gt;'));assert(html.includes(value.suggestionsHtml));
 for(const suggestionsHtml of ['<script>alert(1)</script>','<div onclick="alert(1)">bad</div>','<a href="javascript:alert(1)">bad</a>','<style>@import "https://evil.test";</style>','<div style="background:url(https://evil.test)">bad</div>','<svg><foreignObject>bad</foreignObject></svg>'])assert.throws(()=>renderGroundedAnswer({...value,suggestionsHtml}),/UNSAFE_SEARCH_SUGGESTIONS/);
});
