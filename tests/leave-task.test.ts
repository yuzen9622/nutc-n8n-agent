import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskService} from '../apps/gateway/src/modules/tasks/task.service.js';
import {renderLeaveOutcome} from '../apps/gateway/src/modules/personal/personal.render.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {TaskController} from '../apps/gateway/src/modules/tasks/task.controller.js';
import {Fault} from '../apps/gateway/src/utils/fault.js';
import {schoolQuerySchema} from '../apps/school-adapter/src/modules/school/school.schema.js';
import {SchoolProvider} from '../apps/gateway/src/modules/liff/school.provider.js';
const auth={taskId:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',capability:'a'.repeat(43)};
test('unknown actions, extras and confirm payload never reach school',async()=>{
 let calls=0,guard=0;const service=new TaskService({guardLeave:async()=>{guard++;},authorizeTool:async()=>({userId:'owner'})} as never,{} as never,undefined,{query:async()=>{calls++;},leave:async()=>{calls++;}} as never);
 for(const [query,params] of [['leave',{action:'typo'}],['leave_apply',{}],['leave:apply',{}],['{"action":"leave_apply"}',{}],['leave_confirm',{date:'2026/10/14'}],['leave_preview',{date:'2026/99/99',leave_type:'心理假',reason:'r',selection:{mode:'morning_count',count:3}}]] as const)await assert.rejects(service.tool(auth,'personal',query,params));
 assert.equal(calls,0);assert(guard>=5);
});
test('controlled completion ignores malformed model output and knowledge poison',async()=>{
 let final='',knowledgeCalls=0;const service=new TaskService({leaveControlled:async()=>true,forCompletion:async()=>({leaveControlled:true}),complete:async(_t:unknown,r:string)=>{final=r;},recordKnowledgeEvidence:async()=>{knowledgeCalls++;}} as never,{} as never);
 await service.complete(auth,'{unparseable success}', ['not json']);assert.equal(knowledgeCalls,0);assert.doesNotMatch(final,/成功|稍後再試/);
});
test('fixed preview is complete and ambiguous outcome never invites retry',()=>{
 const reply=renderLeaveOutcome({state:'pending',code:'LEAVE_PREVIEW_READY',date:'2026/10/14',leaveType:'心理調適假',reason:'心理不舒服',courses:[2,3,4].map(period=>({period,name:'知識管理'}))});
 for(const value of ['2026/10/14','第2節','第3節','第4節','心理調適假','心理不舒服','尚未送出','下一則訊息','確認送出'])assert(reply.includes(value));
 assert.match(renderLeaveOutcome({state:'ambiguous',code:'LEAVE_OUTCOME_AMBIGUOUS'}),/不會自動再次送出/);
});
test('private leave RPC sends only server auth and rejects additional adapter fields',async()=>{
 const provider=new SchoolProvider('http://school-adapter:3200','secret',async(url,init)=>{assert(String(url).endsWith('/school/leave'));assert.deepEqual(JSON.parse(String(init?.body)),{auth,operation:'confirm'});return Response.json({data:{sessionId:'33333333-3333-4333-8333-333333333333',receipt:{state:'ambiguous',code:'LEAVE_OUTCOME_AMBIGUOUS'},ccid:19145}});});
 await assert.rejects(provider.leave(auth,'confirm'));
});
test('HTTP strict leave contract rejects dual params, model-private extras and externally chosen capture mode; no private errors',async()=>{
 let schoolCalls=0,guards=0;
 const service=new TaskService({guardLeave:async()=>{guards++;},beginLeavePreview:async()=>{},authorizeTool:async()=>({userId:'trusted-owner'})} as never,{} as never,undefined,{leave:async()=>{schoolCalls++;}} as never);
 const controller=new TaskController(service,'test-service-secret');
 const server=createServer((req,res)=>void controller.handle('tool',req,res).catch(error=>{res.writeHead(error instanceof Fault?error.status:400,{'content-type':'application/json'});res.end(JSON.stringify({error:error instanceof Fault?error.code:'INVALID_REQUEST'}));}));server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address==='object');
 const params={date:'2026/10/14',leave_type:'心理假',reason:'PRIVATE_SENTINEL',selection:{mode:'morning_count',count:3}};
 try{for(const body of [{...auth,kind:'personal',query:'leave_preview',params,date:'2026/10/15'},{...auth,kind:'personal',query:'leave_preview',params:{...params,ccid:19145}},{...auth,kind:'personal',query:'leave_confirm',params:{pendingId:'private'}},{...auth,kind:'personal',query:'leave_confirm',delivery_mode:'capture'}]){const response:Response=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',headers:{'x-campus-service':'test-service-secret','content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,400);assert(!(await response.text()).includes('PRIVATE_SENTINEL'));}assert.equal(schoolCalls,0);assert(guards>=4);
 assert.equal(schoolQuerySchema.safeParse({userId:'U'+'a'.repeat(32),action:'leave_apply',params}).success,false);
 }finally{server.close();await once(server,'close');}
});
test('migration 017 session trigger never updates campus_tasks; cleanup clears inactive-session results',async()=>{
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync('apps/gateway/migrations/017-leave-preview-confirmation.sql','utf8');
 const body=/CREATE FUNCTION campus_leave_cancel_session\(\)[\s\S]*?\$\$;/.exec(sql)![0];
 assert.doesNotMatch(body.replace(/--[^\n]*/g,''),/campus_tasks/);assert.match(body,/campus_leave_previews SET state='cancelled'/);assert.match(body,/NEW\.expires_at<=now\(\)/);
 const identity=/CREATE FUNCTION campus_leave_cancel_identity\(\)[\s\S]*?\$\$;/.exec(sql)![0];assert.match(identity,/UPDATE campus_tasks SET leave_result_ciphertext=NULL WHERE user_id=NEW\.user_id/);
 const repo=readFileSync('apps/gateway/src/modules/tasks/task.repository.ts','utf8');
 assert.match(repo,/UPDATE campus_tasks t SET leave_result_ciphertext=NULL WHERE t\.leave_result_ciphertext IS NOT NULL AND NOT EXISTS\(SELECT 1 FROM campus_school_sessions s WHERE s\.id=t\.leave_result_session_id[^"]*expires_at>now\(\)[^"]*last_used_at>now\(\)-interval '30 minutes'/);
 assert.match(repo,/leave_result_session_id\]\);\s*\n?\s*const trusted=Boolean\(row\.leave_result_ciphertext&&session\.rowCount\)|const trusted=Boolean\(row\.leave_result_ciphertext&&session\.rowCount\)/);
});
test('LeaveRepository.finish fails closed when terminal UPDATE misses',async()=>{
 const {LeaveRepository}=await import('../apps/school-adapter/src/modules/school/leave.repository.js');
 const {LeaveCrypto}=await import('../apps/school-adapter/src/modules/school/leave.crypto.js');
 const p={id:'i',user_id:'u',generation:'1',school_session_id:'s',origin_task_id:'o'} as never;
 const make=(rowCount:number)=>new LeaveRepository({query:async()=>({rowCount,rows:[]})} as never,new LeaveCrypto('a'.repeat(64)));
 await assert.rejects(make(0).finish(p,'a',{state:'succeeded',code:'LEAVE_SUBMISSION_VERIFIED'},'e'),/LEAVE_FINISH_DENIED/);
 await make(1).finish(p,'a',{state:'succeeded',code:'LEAVE_SUBMISSION_VERIFIED'},'e');
});
