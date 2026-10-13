import {test} from 'node:test';
import assert from 'node:assert/strict';
import {N8nGroundingProvider} from '../apps/gateway/src/modules/search/n8n-grounding.provider.js';
import {renderGroundedAnswer} from '../apps/gateway/src/modules/search/google-grounding.render.js';
const config={url:'http://n8n:5678/webhook/campus-google-search',token:'test-webhook-token'};
const result=()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'internal thought',thought:true},{text:'查證後的統整答案'}]},groundingMetadata:{webSearchQueries:['中科大請假'],groundingChunks:[{web:{uri:'https://student.nutc.edu.tw/',title:'官方來源'}}],searchEntryPoint:{renderedContent:'<div><a href="https://www.google.com/search?q=nutc">搜尋建議</a></div>'}}}]});
test('n8n transport posts only the public query and parses the raw Google response',async()=>{
 let requests=0;
 const provider=new N8nGroundingProvider(config,async(url,options)=>{
  requests++;assert.equal(String(url),config.url);
  const headers=options!.headers as Record<string,string>;assert.equal(headers['X-Campus-Webhook'],config.token);assert.equal(options!.redirect,'error');
  assert.deepEqual(JSON.parse(String(options!.body)),{query:'公開問題'});assert(!JSON.stringify(headers).includes('goog'));
  return Response.json(result());
 });
 const answer=await provider.search('公開問題');assert.equal(requests,1);assert.equal(answer.answer,'查證後的統整答案');assert.equal(answer.sources.length,1);
 assert(renderGroundedAnswer(answer).includes(answer.suggestionsHtml));
});
test('query validation prevents invalid requests and transport failure never retries',async()=>{
 let requests=0;
 const provider=new N8nGroundingProvider(config,async()=>{requests++;throw new Error('transport timeout');});
 await assert.rejects(provider.search(''),/INVALID_SEARCH_QUERY/);
 await assert.rejects(provider.search('x'.repeat(501)),/INVALID_SEARCH_QUERY/);assert.equal(requests,0);
 await assert.rejects(provider.search('question'),/GOOGLE_SEARCH_UNAVAILABLE/);assert.equal(requests,1);
});
test('provider rejects ungrounded, truncated, unsafe URLs and oversized responses; errors never reflect provider body',async()=>{
 for(const change of [(v:any)=>{delete v.candidates[0].groundingMetadata;},(v:any)=>{v.candidates[0].finishReason='MAX_TOKENS';},(v:any)=>{v.candidates[0].groundingMetadata.groundingChunks[0].web.uri='javascript:alert(1)';}]){
  const value=result();change(value);await assert.rejects(new N8nGroundingProvider(config,async()=>Response.json(value)).search('question'),/GOOGLE_SEARCH_RESPONSE_INVALID/);
 }
 await assert.rejects(new N8nGroundingProvider(config,async()=>new Response('x'.repeat(256*1024+1))).search('question'),/GOOGLE_SEARCH_RESPONSE_TOO_LARGE/);
 await assert.rejects(new N8nGroundingProvider(config,async()=>new Response('secret reflected',{status:400})).search('question'),error=>String(error).includes('GOOGLE_SEARCH_UNAVAILABLE')&&!String(error).includes('secret reflected'));
});
test('render keeps answer literal, preserves safe Google suggestions, rejects active HTML and CSS',()=>{
 const value={answer:'<script>alert(1)</script>',sources:[{uri:'https://student.nutc.edu.tw/',title:'<img>'}],suggestionsHtml:'<style>.chip{color:blue}</style><a href="https://google.com/"><svg><path d="M0 0"/></svg>Google</a>'};
 const html=renderGroundedAnswer(value);assert(html.includes('&lt;script&gt;'));assert(html.includes(value.suggestionsHtml));
 for(const suggestionsHtml of ['<script>alert(1)</script>','<div onclick="alert(1)">bad</div>','<a href="javascript:alert(1)">bad</a>','<style>@import "https://evil.test";</style>','<div style="background:url(https://evil.test)">bad</div>','<svg><foreignObject>bad</foreignObject></svg>'])assert.throws(()=>renderGroundedAnswer({...value,suggestionsHtml}),/UNSAFE_SEARCH_SUGGESTIONS/);
});
test('transport config is limited to fixed n8n search webhook URLs and a token',()=>{
 for(const url of ['http://n8n:5678/webhook/campus-google-search','http://127.0.0.1:15679/webhook/campus-google-search'])new N8nGroundingProvider({url,token:'t'});
 for(const url of ['https://generativelanguage.googleapis.com/v1beta/models/x:generateContent','http://n8n:5678/webhook/other','http://n8n:5678/webhook/campus-google-search?x=1','http://evil.test:5678/webhook/campus-google-search','https://n8n:5678/webhook/campus-google-search'])assert.throws(()=>new N8nGroundingProvider({url,token:'t'}),/INVALID_GROUNDING_CONFIG/);
 assert.throws(()=>new N8nGroundingProvider({url:config.url,token:''}),/INVALID_GROUNDING_CONFIG/);
});
test('n8n error responses, redirects and non-JSON replies fail closed without reflection',async()=>{
 for(const status of [400,503])await assert.rejects(new N8nGroundingProvider(config,async()=>new Response('{"secret":"x"}',{status})).search('question'),error=>String(error).includes('GOOGLE_SEARCH_UNAVAILABLE')&&!String(error).includes('secret'));
 await assert.rejects(new N8nGroundingProvider(config,async()=>new Response('<html>',{status:200})).search('question'),/GOOGLE_SEARCH_RESPONSE_INVALID/);
});
test('gateway no longer exposes a Gemini model proxy endpoint',async()=>{
 const {createServer}=await import('node:http');const {lineRouter}=await import('../apps/gateway/src/modules/line/line.router.js');
 const server=createServer(lineRouter({} as never));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const {port}=server.address() as {port:number};
  const response=await fetch(`http://127.0.0.1:${port}/providers/gemini/v1beta/models/x:generateContent`,{method:'POST',headers:{'x-goog-api-key':'any'},body:'{}'});
  assert.equal(response.status,404);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
