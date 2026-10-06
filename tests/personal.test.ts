import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderPersonal} from '../apps/gateway/src/modules/personal/personal.render.js';
import {SchoolProvider} from '../apps/gateway/src/modules/liff/school.provider.js';
import {TaskService} from '../apps/gateway/src/modules/tasks/task.service.js';
import {Fault} from '../apps/gateway/src/utils/fault.js';
test('personal tools persist login guidance only after verified school session failure',async()=>{
 const auth={taskId:'task',lease:'lease',capability:'capability'};let notices=0;
 const repository={authorizeTool:async()=>({userId:'trusted-owner'}),recordLoginRequired:async(value:unknown)=>{assert.deepEqual(value,auth);notices++;return {status:'login_required'};}};
 let failure=new Fault(401,'SCHOOL_LOGIN_REQUIRED');
 const school={query:async(user:string)=>{assert.equal(user,'trusted-owner');throw failure;}};
 const service=new TaskService(repository as never,{} as never,undefined,undefined,0,school as never);
 assert.deepEqual(await service.tool(auth,'personal','schedule'),{status:'login_required'});assert.equal(notices,1);
 failure=new Fault(503,'SCHOOL_UNAVAILABLE');await assert.rejects(service.tool(auth,'personal','schedule'),/SCHOOL_UNAVAILABLE/);assert.equal(notices,1);
});
test('school query validates action and typed payload before local rendering',async()=>{
 const sessionId='12345678-1234-4234-8234-123456789012';
 const result={kind:'schedule',items:[{weekday:1,periods:[1],startTime:'08:10',endTime:'09:00',title:'私人課程',teacher:'老師',className:'班級',classroom:'101'}]};
 const provider=new SchoolProvider('http://school-adapter:3200','secret',async(url,init)=>{assert(String(url).endsWith('/internal/v1/school/query'));assert.deepEqual(JSON.parse(String(init?.body)),{userId:'verified-owner',action:'schedule'});return Response.json({data:{sessionId,result}});});
 const data=await provider.query('verified-owner','schedule');assert.equal(data.sessionId,sessionId);assert.match(renderPersonal(data.result),/週一 08:10–09:00 私人課程｜101/);
 const wrong=new SchoolProvider('http://school-adapter:3200','secret',async()=>Response.json({data:{sessionId,result:{kind:'absence',items:[]}}}));await assert.rejects(wrong.query('owner','schedule'),/SCHOOL_RESPONSE_INVALID/);
 const expired=new SchoolProvider('http://school-adapter:3200','secret',async()=>Response.json({error:'SCHOOL_SESSION_EXPIRED'},{status:401}));await assert.rejects(expired.query('owner','schedule'),/SCHOOL_LOGIN_REQUIRED/);
 const denied=new SchoolProvider('http://school-adapter:3200','secret',async()=>Response.json({error:'SERVICE_AUTH_REQUIRED'},{status:401}));await assert.rejects(denied.query('owner','schedule'),/SCHOOL_UNAVAILABLE/);
 const malformed=new SchoolProvider('http://school-adapter:3200','secret',async()=>new Response('secret upstream cookie',{status:401}));await assert.rejects(malformed.query('owner','schedule'),/SCHOOL_UNAVAILABLE/);
});
test('local templates bound long private results without inventing omitted data',()=>{
 const output=renderPersonal({kind:'announcements',items:Array.from({length:20},()=>({title:'公告'.repeat(100),publisher:'單位',category:''}))});assert(output.length<1400);assert(output.includes('完整紀錄請至校務系統查看'));
 assert.equal(renderPersonal({kind:'absence',items:[]}),'我的缺曠紀錄\n校務系統目前沒有此項紀錄。');
});
