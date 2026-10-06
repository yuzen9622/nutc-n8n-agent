import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {registerMockModule} from '../apps/mock-gateway/src/modules/mock/index.js';
import {MockService} from '../apps/mock-gateway/src/modules/mock/mock.service.js';
import {MockRepository} from '../apps/mock-gateway/src/modules/mock/mock.repository.js';
import {loadConfig,type Config,type Scope} from '../apps/mock-gateway/src/config/env.js';
const config:Config={mode:'synthetic',port:3000,tokens:Object.fromEntries(['task','demo','maintenance','knowledge','observability'].map(k=>[k,k.padEnd(40,'x')])) as Config['tokens']};
const server=createServer(registerMockModule(config));let base='';
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}/internal/v1`;});
after(()=>server.close());
async function api(path:string,body:unknown={},scope:Scope='task',context:Record<string,string>={},method='POST') {
 const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.tokens[scope]}`,'X-Task-Capability':context.taskCapability??'','X-Task-Lease':context.leaseToken??''},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 return {status:res.status,...await res.json() as {success:boolean;data:any;error?:{code:string}}};
}
async function task(scenario='public_success') {const d=await api('/demo/tasks',{scenario},'demo');const c=d.data;const claim=await api(`/tasks/${c.taskId}/claim`,{},'task',c);Object.assign(c,claim.data);const plan=await api(`/tasks/${c.taskId}/plan`,{},'task',c);return {...c,...plan.data};}
const stage=(c:any,kind:string,s:string,b:Record<string,unknown>={})=>api(`/tasks/${c.taskId}/${kind}/${s}`,{operationId:c.operations.find((o:any)=>o.kind===kind).operationId,...b},'task',c);
test('public HTTP path produces only references and one synthetic outbox',async()=>{
 const c=await task();const p=await stage(c,'public','prepare');const search=await stage(c,'public','search',{queryRef:p.data.queryRef});await stage(c,'public','read',{searchRef:search.data.searchRef});const evidence=await stage(c,'public','collect');const d=await stage(c,'public','generate',{evidenceRef:evidence.data.evidenceRef});const r=await stage(c,'public','render',{draftRef:d.data.draftRef});
 for(let i=0;i<2;i++)assert.equal((await api(`/tasks/${c.taskId}/complete`,{resultRefs:[r.data.resultRef]},'task',c)).status,200);
 const delivery=await api(`/demo/tasks/${c.taskId}/delivery`,{},'demo',{},'GET');assert.equal(delivery.data.outboxCount,1);assert.equal(delivery.data.delivered,false);assert.equal(delivery.data.outcome,'answered');
 assert.equal((await api(`/tasks/${c.taskId}/claim`,{},'task',c)).data.acquired,false);
});
test('service scope, strict shape, task capability and lease are enforced',async()=>{
 assert.equal((await api('/demo/tasks',{scenario:'public_success'},'task')).status,401);
 assert.equal((await api('/demo/tasks',{scenario:'public_success',password:'never-accepted'},'demo')).status,400);
 const a=await task(),b=await task();assert.equal((await api(`/tasks/${a.taskId}/plan`,{},'task',b)).status,403);
 assert.equal((await api(`/tasks/${a.taskId}/plan`,{},'task',{...a,leaseToken:b.leaseToken})).status,403);
 assert.equal((await api(`/tasks/${a.taskId}/public/prepare`,{operationId:b.operations[0].operationId},'task',a)).status,403);
});
test('cross-task refs cannot be used as evidence or delivery results',async()=>{
 const a=await task(),b=await task();const p=await stage(a,'public','prepare');assert.equal((await stage(b,'public','search',{queryRef:p.data.queryRef})).status,403);
 const d=await stage(a,'public','fallback',{reasonCode:'insufficient'});const r=await stage(a,'public','render',{draftRef:d.data.draftRef});assert.equal((await api(`/tasks/${b.taskId}/complete`,{resultRefs:[r.data.resultRef]},'task',b)).status,403);
});
test('personal data scope and expiry remain local references',async()=>{
 const c=await task('schedule_success');assert.equal((await stage(c,'personal','absence')).status,403);const d=await stage(c,'personal','schedule');assert.deepEqual(Object.keys(d.data).sort(),['dataRef','session']);
 const expired=await task('session_expired');assert.equal((await stage(expired,'personal','check-session')).data.session,'active');assert.equal((await stage(expired,'personal','schedule')).data.session,'reauth_required');
});
test('one retrieval rewrite and one repair; stage retries reuse refs',async()=>{
 const c=await task('retrieval_retry');const a=await stage(c,'public','prepare'),again=await stage(c,'public','prepare');assert.equal(a.data.queryRef,again.data.queryRef);
 const s=await stage(c,'public','search',{queryRef:a.data.queryRef});await stage(c,'public','read',{searchRef:s.data.searchRef});const e=await stage(c,'public','collect');const assessment=await stage(c,'public','assess',{evidenceRef:e.data.evidenceRef});
 const rewrite=await stage(c,'public','rewrite-query',{assessmentRef:assessment.data.assessmentRef});assert.equal(rewrite.data.iteration,1);assert.equal((await stage(c,'public','rewrite-query',{assessmentRef:assessment.data.assessmentRef})).data.allowed,false);
});
test('provider technical error remains a failure and can be finalized once',async()=>{
 const c=await task('provider_timeout');const p=await stage(c,'public','prepare');const failed=await stage(c,'public','search',{queryRef:p.data.queryRef});assert.equal(failed.status,502);
 await api(`/tasks/${c.taskId}/fail`,{errorCode:'UPSTREAM_FAILED'},'task',c);await api(`/tasks/${c.taskId}/fail`,{errorCode:'UPSTREAM_FAILED'},'task',c);
 const d=await api(`/demo/tasks/${c.taskId}/delivery`,{},'demo',{},'GET');assert.equal(d.data.outcome,'UPSTREAM_FAILED');assert.equal(d.data.outboxCount,1);
});
test('sync has bounded source progression and no publication on parse failure',async()=>{
 const start=await api('/knowledge/sync/start',{scenario:'all'},'knowledge');const syncRef=start.data.syncRef;
 assert.equal((await api('/knowledge/sync/start',{},'knowledge')).data.acquired,false);
 for(let i=0;i<4;i++) {
  const n=await api('/knowledge/sync/next',{syncRef},'knowledge');const b={syncRef,sourceRef:n.data.sourceRef};const f=await api('/knowledge/sync/fetch',b,'knowledge');
  if(f.data.status==='changed') {const p=await api('/knowledge/sync/parse',b,'knowledge');if(p.data.ok){const v={...b,versionRef:p.data.versionRef};assert.equal((await api('/knowledge/sync/publish',v,'knowledge')).status,409);await api('/knowledge/sync/embed',v,'knowledge');await api('/knowledge/sync/publish',v,'knowledge');}}
  await api('/knowledge/sync/record',b,'knowledge');
 }
 const f=await api('/knowledge/sync/finish',{syncRef},'knowledge');assert.equal(f.data.published,1);assert.deepEqual(f.data.counts,{updated:1,unchanged:1,withdrawn:1,failed:1});
});
test('deadline enforcement and watchdog settle expired synthetic tasks',()=>{
 let now=0;const s=new MockService(new MockRepository(),()=>now);const c=s.create('public_success');const lease=s.claim(c.taskId,{capability:c.taskCapability,lease:''});now=90_001;
 assert.throws(()=>s.plan(c.taskId,{capability:c.taskCapability,lease:lease.leaseToken!}),/DEADLINE_EXCEEDED/);s.cleanup();assert.equal(s.delivery(c.taskId).outboxCount,1);
});
test('production or weak/reused tokens fail closed at startup',()=>{
 assert.throws(()=>loadConfig({APP_MODE:'production'}));assert.throws(()=>loadConfig({APP_MODE:'synthetic'}));
});
test('local binding and clarification prompts produce single allowed result',async()=>{
 for(const [scenario,outcome]of [['binding_prompt','binding_required'],['clarify_prompt','clarify'],['unsupported_prompt','unsupported']]){
  const c=await task(scenario);assert.equal(c.intent,'local');const result=await api(`/tasks/${c.taskId}/complete`,{resultRefs:[c.resultRef]},'task',c);assert.equal(result.data.outcome,outcome);
 }
});
test('unknown personal action produces unsupported prompt, not reauthentication',async()=>{
 const c=await task('unknown_personal');const result=await stage(c,'personal','unsupported-prompt');const done=await api(`/tasks/${c.taskId}/complete`,{resultRefs:[result.data.resultRef]},'task',c);assert.equal(done.data.outcome,'unsupported');
});
