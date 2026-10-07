import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleGroundingProvider} from '../apps/gateway/src/modules/search/google-grounding.provider.js';
import {renderGroundedAnswer} from '../apps/gateway/src/modules/search/google-grounding.render.js';
const config={key:'test-secret',model:'models/gemini-3.8-flash'};
const result=()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'internal thought',thought:true},{text:'查證後的統整答案'}]},groundingMetadata:{webSearchQueries:['中科大請假'],groundingChunks:[{web:{uri:'https://student.nutc.edu.tw/',title:'官方來源'}}],searchEntryPoint:{renderedContent:'<div><a href="https://www.google.com/search?q=nutc">搜尋建議</a></div>'}}}]});
test('official Google tool searches and synthesizes without budget configuration',async()=>{
 let requests=0;
 const provider=new GoogleGroundingProvider(config,async(url,options)=>{
  requests++;assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal((options!.headers as Record<string,string>)['x-goog-api-key'],'test-secret');assert.equal(options!.redirect,'error');
  const body=JSON.parse(String(options!.body));assert.deepEqual(body.tools,[{google_search:{}}]);assert.equal(body.contents[0].parts[0].text,'公開問題');assert.equal(body.generationConfig.candidateCount,1);
  return Response.json(result());
 });
 const answer=await provider.search('公開問題');assert.equal(requests,1);assert.equal(answer.answer,'查證後的統整答案');assert.equal(answer.sources.length,1);
 assert(renderGroundedAnswer(answer).includes(answer.suggestionsHtml));
});
test('query validation prevents invalid requests and transport failure never retries',async()=>{
 let requests=0;
 const provider=new GoogleGroundingProvider(config,async()=>{requests++;throw new Error('transport timeout');});
 await assert.rejects(provider.search(''),/INVALID_SEARCH_QUERY/);
 await assert.rejects(provider.search('x'.repeat(501)),/INVALID_SEARCH_QUERY/);assert.equal(requests,0);
 await assert.rejects(provider.search('question'),/GOOGLE_SEARCH_UNAVAILABLE/);assert.equal(requests,1);
});
test('provider rejects ungrounded, truncated, unsafe URLs and oversized responses; errors never reflect provider body',async()=>{
 for(const change of [(v:any)=>{delete v.candidates[0].groundingMetadata;},(v:any)=>{v.candidates[0].finishReason='MAX_TOKENS';},(v:any)=>{v.candidates[0].groundingMetadata.groundingChunks[0].web.uri='javascript:alert(1)';}]){
  const value=result();change(value);await assert.rejects(new GoogleGroundingProvider(config,async()=>Response.json(value)).search('question'),/GOOGLE_SEARCH_RESPONSE_INVALID/);
 }
 await assert.rejects(new GoogleGroundingProvider(config,async()=>new Response('x'.repeat(256*1024+1))).search('question'),/GOOGLE_SEARCH_RESPONSE_TOO_LARGE/);
 await assert.rejects(new GoogleGroundingProvider(config,async()=>new Response('secret reflected',{status:400})).search('question'),error=>String(error).includes('GOOGLE_SEARCH_UNAVAILABLE')&&!String(error).includes('secret reflected'));
});
test('render keeps answer literal, preserves safe Google suggestions, rejects active HTML and CSS',()=>{
 const value={answer:'<script>alert(1)</script>',sources:[{uri:'https://student.nutc.edu.tw/',title:'<img>'}],suggestionsHtml:'<style>.chip{color:blue}</style><a href="https://google.com/"><svg><path d="M0 0"/></svg>Google</a>'};
 const html=renderGroundedAnswer(value);assert(html.includes('&lt;script&gt;'));assert(html.includes(value.suggestionsHtml));
 for(const suggestionsHtml of ['<script>alert(1)</script>','<div onclick="alert(1)">bad</div>','<a href="javascript:alert(1)">bad</a>','<style>@import "https://evil.test";</style>','<div style="background:url(https://evil.test)">bad</div>','<svg><foreignObject>bad</foreignObject></svg>'])assert.throws(()=>renderGroundedAnswer({...value,suggestionsHtml}),/UNSAFE_SEARCH_SUGGESTIONS/);
});
