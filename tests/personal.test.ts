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

test('personal rendering formats grades, leave notes, leave application and mail sending results correctly',()=>{
 const gradesOutput=renderPersonal({
  kind:'grades',
  semester:'1121',
  availableSemesters:['1121','1122'],
  totalScore:88.5,
  conductScore:'86',
  classRank:2,
  items:[{name:'資料庫系統',type:'必',credits:3,score:'91'}]
 });
 assert.match(gradesOutput,/我的成績（1121學期）/);
 assert.match(gradesOutput,/學期平均：88.5分/);
 assert.match(gradesOutput,/操行成績：86/);
 assert.match(gradesOutput,/班級排名：第2名/);
 assert.match(gradesOutput,/資料庫系統：91分（3學分｜必）/);

 const leaveNotesOutput=renderPersonal({
  kind:'leave_notes',
  items:[{appliedAt:'2026/04/20',type:'事假',courseInfo:'第1-2節',reason:'家事',teacherStatus:'核准',finalStatus:'核准'}]
 });
 assert.match(leaveNotesOutput,/我的請假紀錄/);
 assert.match(leaveNotesOutput,/\[事假\] 第1-2節｜事由：家事｜審核：導師\[核准\] 生輔組\[核准\]/);

 const leaveApplySuccess=renderPersonal({
  kind:'leave_apply',
  success:true,
  message:'請假單已送出',
  details:{date:'2026/04/29',beginSec:1,endSec:2,typeName:'病假',reason:'看醫生'}
 });
 assert.match(leaveApplySuccess,/請假申請已送出/);
 assert.match(leaveApplySuccess,/日期：2026\/04\/29/);
 assert.match(leaveApplySuccess,/節次：第1節～第2節/);
 assert.match(leaveApplySuccess,/假別：病假/);

 const mailSuccess=renderPersonal({
  kind:'send_mail',
  success:true,
  message:'信件已寄出',
  details:{to:'advisor@nutc.edu.tw',subject:'論文進度報告'}
 });
 assert.match(mailSuccess,/信件發送成功/);
 assert.match(mailSuccess,/收件人：advisor@nutc.edu.tw/);
 assert.match(mailSuccess,/主旨：論文進度報告/);
 assert.match(mailSuccess,/學校 Webmail/);
});

test('TaskService routes grades, leave and send_mail actions with query or params',async()=>{
 const auth={taskId:'task',lease:'lease',capability:'capability'};
 const records:Array<{auth:unknown;action:string;reply:string}>=[];
 const repository={
  authorizeTool:async()=>({userId:'test-user'}),
  recordPersonal:async(authVal:unknown,action:string,_sessionId:string,reply:string)=>{
   records.push({auth:authVal,action,reply});
   return {status:'ready',action,reply};
  }
 };

 const school={
  query:async(userId:string,action:string,params?:Record<string,unknown>)=>{
   assert.equal(userId,'test-user');
   if(action==='grades'){
    return {sessionId:'11111111-1111-4111-8111-111111111111',result:{kind:'grades',semester:String(params?.semester??'1121'),totalScore:90,items:[]}};
   }
   if(action==='leave_apply'){
    return {sessionId:'22222222-2222-4222-8222-222222222222',result:{kind:'leave_apply',success:true,message:'OK',details:{date:'2026/04/29',beginSec:1,endSec:2,typeName:'事假',reason:'外出'}}};
   }
   if(action==='leave_notes'){
    return {sessionId:'33333333-3333-4333-8333-333333333333',result:{kind:'leave_notes',items:[]}};
   }
   if(action==='send_mail'){
    return {sessionId:'44444444-4444-4444-8444-444444444444',result:{kind:'send_mail',success:true,message:'OK',details:{to:String(params?.to),subject:String(params?.subject)}}};
   }
   throw new Error('unknown action');
  }
 };

 const service=new TaskService(repository as never,{} as never,undefined,undefined,0,school as never);

 // 1. grades query
 await service.tool(auth,'personal','grades:1121');
 assert.equal(records[0]?.action,'grades');
 assert.match(records[0]!.reply,/1121學期/);

 // 2. leave query
 await service.tool(auth,'personal','leave',{action:'records'});
 assert.equal(records[1]?.action,'leave_notes');

 // 3. leave apply
 await service.tool(auth,'personal','leave',{action:'apply',date:'2026/04/29',begin_sec:1,end_sec:2,reason:'外出'});
 assert.equal(records[2]?.action,'leave_apply');
 assert.match(records[2]!.reply,/請假申請已送出/);

 // 4. send_mail
 await service.tool(auth,'personal','send_mail',{to:'test@nutc.edu.tw',subject:'測試信件',content:'您好'});
 assert.equal(records[3]?.action,'send_mail');
 assert.match(records[3]!.reply,/信件發送成功/);
});
