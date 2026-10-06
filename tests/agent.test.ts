import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentService } from '../apps/mock-gateway/src/modules/mock/agent.service.js';
test('agent tools bind capabilities, enforce budget, and keep private content local',()=>{
 const s=new AgentService();const t=s.prepare('event-1','mixed');assert.equal(t.accepted,true);
 const id=t.taskId!,cap=t.capability!;
 assert.equal(s.prepare('event-1','mixed').accepted,false);
 assert.throws(()=>s.tool(id,'forged','knowledge','規則'));
 assert.throws(()=>s.tool(id,cap,'personal','arbitrary-action'));
 const p=s.tool(id,cap,'personal','schedule');assert(!JSON.stringify(p).includes('privateRef'));assert.equal(p.status,'prepared_locally');
 const k=s.tool(id,cap,'knowledge','借書');assert.equal(k.sources![0]!.sourceId,'synthetic-library-rules');
 assert.throws(()=>s.complete(id,cap,JSON.stringify({answer:'test',sourceIds:['invented']})));
 const result=s.complete(id,cap,JSON.stringify({answer:'合成規則為五本。',sourceIds:['synthetic-library-rules']})) as {delivered:boolean;privateResult:string};
 assert.equal(result.delivered,false);assert(result.privateResult.includes('本地模板'));
 assert.deepEqual(s.complete(id,cap,'ignored'),result);
 assert.throws(()=>s.tool(id,cap,'web','hours'));
 const u=s.prepare('event-2','web');for(let i=0;i<4;i++)s.tool(u.taskId!,u.capability!,'web','hours');
 assert.throws(()=>s.tool(u.taskId!,u.capability!,'web','hours'));
});
test('agent result refuses missing evidence, malformed JSON, and extra fields',()=>{
 const s=new AgentService();const t=s.prepare('event-3','knowledge');
 for(const output of ['text',JSON.stringify({answer:'unsupported',sourceIds:[]}),JSON.stringify({answer:'x',sourceIds:[],recipient:'other'})])assert.throws(()=>s.complete(t.taskId!,t.capability!,output));
});
