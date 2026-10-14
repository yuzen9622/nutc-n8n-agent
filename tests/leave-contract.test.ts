import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leavePreviewIntentSchema} from '../apps/shared/leave-contract.js';
import {parseLeaveClasses,parseLeaveForm,selectLeaveRows,parseLeaveCreateResponse,buildLeaveSubmissionPayload} from '../apps/school-adapter/src/modules/school/leave.parse.js';
const intent={date:'2026-10-14',leave_type:'心理假',reason:'心理不舒服',selection:{mode:'morning_count',count:3}};
// Live form: consecutive=0 is 「指定日期/課程」 (detail=[[ccid,sec]]); 1 expects a date-range object and the school answers 「參數錯誤」.
export const form='<form method="post"><input name="anid" value="0"><input name="date"><input name="detail"><input name="dropped" value="0"><input name="date1"><select name="an_type"><option value="17">心理調適假</option></select><select name="begin_sec"></select><select name="end_sec"></select><textarea name="reason"></textarea><input name="update" value="儲存"></form><script>function opDone(msg) { alert(msg); setWindowReturnValue(true); window.xclose(); }</script>';
export const rows=[2,3,4].map(sec=>({ccid:'19145',sec:String(sec),cls_name:'知識管理'}));
export const envelope=(values=rows)=>JSON.stringify({d:JSON.stringify([{type:'cust_handler',script:null,func:null,args:[JSON.stringify(values)]},{type:'function',script:null,func:'ajax_done',args:[1]}])});
test('strict intent rejects rollover, private extras and coercion',()=>{
 assert.equal(leavePreviewIntentSchema.parse(intent).date,'2026/10/14');
 for(const patch of [{date:'2026/02/29'},{date:'2026/99/99'},{leave_type:'17'},{leave_type:'不存在'},{reason:' '},{ccid:19145},{selection:{mode:'morning_count',count:0}},{selection:{mode:'range',begin_sec:4,end_sec:2}},{selection:{mode:'periods',periods:[2,2]}}])assert.equal(leavePreviewIntentSchema.safeParse({...intent,...patch}).success,false);
});
test('live ASMX args[0], dynamic psychological code and unique morning subset',()=>{
 const parsed=parseLeaveClasses(envelope());assert.deepEqual(parsed.map(r=>r.sec),[2,3,4]);
 assert.equal(parseLeaveForm(form).types['心理調適假'],17);
 assert.equal(selectLeaveRows(parsed,leavePreviewIntentSchema.parse(intent).selection).length,3);
 assert.throws(()=>selectLeaveRows(parseLeaveClasses(envelope([...rows,{ccid:'19146',sec:'1',cls_name:'另一課'}])),leavePreviewIntentSchema.parse(intent).selection));
 for(const body of ['<html>login</html>',JSON.stringify({d:'[]'}),JSON.stringify({d:JSON.stringify([{type:'error',args:['private']}])})])assert.throws(()=>parseLeaveClasses(body));
});
test('builder never fabricates IDs or clamps periods',()=>{
 assert.throws(()=>buildLeaveSubmissionPayload({date:'2026/10/14',begin_sec:2,end_sec:4,an_type:17,reason:'r'} as never));
 const payload=buildLeaveSubmissionPayload({date:'2026/10/14',an_type:17,reason:'r',detail:[[19145,2],[19145,3],[19145,4]],hidden:{}});
 assert.deepEqual(JSON.parse(payload.detail!),[[19145,2],[19145,3],[19145,4]]);assert.equal(payload.consecutive,'0');assert.equal(payload.update,'儲 存');
});
test('only concrete opDone response can be accepted; HTTP and generic success cannot',()=>{
 assert.equal(parseLeaveCreateResponse('<html>成功</html>').state,'unknown');
 assert.equal(parseLeaveCreateResponse('<script>function opDone(msg){alert(msg)}</script>').state,'unknown');
 assert.equal(parseLeaveCreateResponse('<script>opDone("申請完成");</script>').state,'accepted');
 assert.equal(parseLeaveCreateResponse('<span id="lblMsg">資料未儲存</span>').state,'rejected');
});
test('school alert-only refusal is rejected; an alert can never prove acceptance',()=>{
 assert.equal(parseLeaveCreateResponse("<script type=text/javascript>alert('參數錯誤 !');</script>").state,'rejected');
 assert.equal(parseLeaveCreateResponse("<script>alert('申請完成');</script>").state,'unknown');
 assert.equal(parseLeaveCreateResponse("<script>alert('錯誤');</script><script>alert('錯誤');</script>").state,'unknown');
});
test('opDone is accepted only for exact completion messages; refusals and unknown text never are',()=>{
 const call=(m:string,q='"')=>parseLeaveCreateResponse(`<script>opDone(${q}${m}${q});</script>`);
 for(const m of ['完成','申請完成','申請完成。','送出成功!','請假申請成功'])assert.equal(call(m).state,'accepted',m);
 assert.equal(call('完成',"'").state,'accepted');
 for(const m of ['資料未儲存','未完成','申請失敗','無法送出','重複申請','不可請假','已存在相同假單','超過期限','拒絕','系統錯誤'])assert.equal(call(m).state,'rejected',m);
 for(const m of ['成功','OK','','已收到','處理中','申請完成後請確認'])assert.equal(call(m).state,'unknown',m);
 assert.equal(call('請先登入').state,'unknown');assert.equal(call('完\\u6210').state,'accepted');assert.equal(call('完\\u6210',"'").state,'unknown');assert.equal(call('完\\x6')?.state,'unknown');
 assert.equal(parseLeaveCreateResponse('<script>opDone("完成");</script><script>opDone("完成");</script>').state,'unknown');
 assert.equal(parseLeaveCreateResponse('<script>opDone(msg + "完成");</script>').state,'unknown');
});
