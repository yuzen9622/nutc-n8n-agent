import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SchoolClient} from '../apps/school-adapter/src/modules/school/school.client.js';
import {CookieJar} from 'tough-cookie';
import {parseLeaveClasses,parseLeaveRecordSummary,parseLeaveRecordDetail,parseLeaveForm,parseLeaveCreateResponse} from '../apps/school-adapter/src/modules/school/leave.parse.js';
const event=(rows:unknown[])=>JSON.stringify({d:JSON.stringify([{type:'cust_handler',script:null,func:null,args:[JSON.stringify(rows)]}])});
test('ASMX JSON envelope and fixed endpoint; no mutation retry or redirects',async()=>{
 let calls=0;const client=new SchoolClient(new CookieJar(),async(url,options)=>{calls++;assert.equal(url.href,'https://ais.nutc.edu.tw/student/WebService.asmx/stuClassByDate');assert.equal(options.json,true);assert.deepEqual(JSON.parse(options.body!),{strParam:JSON.stringify({date:'2026/10/14',dropped_class:'0'})});return {status:200,body:Buffer.from(event([])),contentType:'application/json',cookies:[]};});
 await client.postJson('2026/10/14',AbortSignal.timeout(1000));assert.equal(calls,1);
 const redirect=new SchoolClient(new CookieJar(),async()=>({status:307,location:'https://ais.nutc.edu.tw/student/home.aspx',body:Buffer.alloc(0),contentType:'text/html',cookies:[]}));await assert.rejects(redirect.postJson('2026/10/14',AbortSignal.timeout(1000)));
});
test('rows reject malformed IDs, fractional periods, duplicate and conflicting handlers',()=>{
 for(const rows of [[{ccid:'0',sec:'2',cls_name:'課程'}],[{ccid:'12',sec:'2.5',cls_name:'課程'}],[{ccid:'12',sec:'15',cls_name:'課程'}],[{ccid:'12',sec:'2',cls_name:'課程',detail:'private'}],[{ccid:'12',sec:'2',cls_name:'課程'},{ccid:'12',sec:'2',cls_name:'課程'}]])assert.throws(()=>parseLeaveClasses(event(rows)));
 assert.throws(()=>parseLeaveClasses(JSON.stringify({d:JSON.stringify([{type:'cust_handler',script:null,func:null,args:['[]']},{type:'cust_handler',script:null,func:null,args:['[]']}])})));
});
test('record stable ID, completeness and full-date detail fail closed',()=>{
 const html='<table class="grid_view"><tr data-key="101"><td>1</td><td>2026/10/13</td><td>[心理調適假]<i>10/14 第2-4節</i><br>原因</td><td></td><td></td><td></td></tr></table>';
 assert.equal(parseLeaveRecordSummary(html)[0]?.id,101);assert.throws(()=>parseLeaveRecordSummary(html+'<a href="?_p=2">下一頁</a>'));assert.throws(()=>parseLeaveRecordSummary('<html>changed</html>'));
 assert.throws(()=>parseLeaveRecordDetail(html));assert.throws(()=>parseLeaveForm('<form method="post"><input name="anid" value="0"></form>'));
});
// Shapes captured from the live school on 2026-10-14 (record 17351), private values replaced.
const liveDetail=(details:string,assignments=`$(':input[name="an_type"]').val('17');\n$(':input[name="reason"]').val('心裡不舒服');`)=>`<script type='text/javascript'>
$(document).ready(function () {
    var details = ${details};
    var i=1 ;
});</script><input type="hidden" name='date' value='' /><input type="hidden" name='detail' value='' /><input name='date1' value="" />
<select name='an_type' class='selgray'><option value='2'>事假</option><option value='17'>心理調適假</option></select><textarea name='reason'></textarea>
<script type='text/javascript'>
$(document).ready(function(){
${assignments}
$(':input[name="anid"]').val('17351');
})</script>`;
test('saved record detail is read from the school script literals, not the empty inputs',()=>{
 const days='{"2026/10/14":[{"ccid":"19145","sec":"2","cls_name":"知識管理","checked":"1"},{"ccid":"19145","sec":"3","cls_name":"知識管理"}]}';
 assert.deepEqual(parseLeaveRecordDetail(liveDetail(days)),{date:'2026/10/14',tuples:[[19145,2]],type:'心理調適假',reason:'心裡不舒服'});
 assert.throws(()=>parseLeaveRecordDetail(liveDetail('{"2026/10/14":[{"ccid":"19145","sec":"2","cls_name":"知識管理"}]}')));
 assert.throws(()=>parseLeaveRecordDetail(liveDetail('{"2026/10/14":[],"2026/10/15":[]}')));
 assert.throws(()=>parseLeaveRecordDetail(liveDetail(days,`$(':input[name="an_type"]').val('99');\n$(':input[name="reason"]').val('x');`)));
 assert.throws(()=>parseLeaveRecordDetail(liveDetail(days,`$(':input[name="an_type"]').val('17');`)));
 assert.throws(()=>parseLeaveRecordDetail(liveDetail(days,`$(':input[name="an_type"]').val('17');\n$(':input[name="reason"]').val('a\\'b');`)));
});
test('live create response calls the parent window callback',()=>{
 assert.equal(parseLeaveCreateResponse("<script type='text/javascript'>parent.opDone('新增成功。');</script>").state,'accepted');
 assert.equal(parseLeaveCreateResponse("<script>window.opDone('新增成功。');</script>").state,'unknown');
});
