import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {SchoolClient,type SchoolTransport,type SchoolResponse} from '../apps/school-adapter/src/modules/school/school.client.js';
import {SchoolLoginService} from '../apps/school-adapter/src/modules/school/login.service.js';
import {StudentService} from '../apps/school-adapter/src/modules/school/student.service.js';
import {loginOutcome,portalLoginPage} from '../apps/school-adapter/src/modules/school/login.parse.js';
import {LocalOcr} from '../apps/school-adapter/src/modules/school/ocr.provider.js';
import {SCHOOL} from '../apps/school-adapter/src/constants/school.js';
const form='<input name="__VIEWSTATE" value="state"><input name="__EVENTVALIDATION" value="ev"><input name="ctl00$ContentPlaceHolder1$Account">';
const home='<table class="grid_view"><tr><th>學生公告</th></tr></table>';
const html=(body:string,extra:Partial<SchoolResponse>={}):SchoolResponse=>({status:200,body:Buffer.from(body),contentType:'text/html; charset=utf-8',cookies:[],...extra});
const image=():SchoolResponse=>({status:200,body:Buffer.from([137,80,78,71,13,10,26,10]),contentType:'image/png',cookies:[]});
test('school redirects preserve cookie scope but never replay passwords or follow outside hosts',async()=>{
 const visited:string[]=[];
 const client=new SchoolClient(new CookieJar(),async(url,options)=>{
  visited.push(url.href);
  if(visited.length===1)return html('',{status:302,location:'https://ais.nutc.edu.tw/student/home.aspx',cookies:['sso=secret; Path=/; Secure; HttpOnly']});
  assert.equal(options.body,undefined);assert.equal(options.cookie,'');return html(home);
 });
 await client.fetch(SCHOOL.login,AbortSignal.timeout(1000),new URLSearchParams({password:' never replay '}));
 assert.equal(visited.length,2);
 for(const location of ['https://attacker.example/','http://sso.nutc.edu.tw/','https://sso.nutc.edu.tw@attacker.example/']){
  let calls=0;const denied=new SchoolClient(new CookieJar(),async()=>{calls++;return html('',{status:302,location});});
  await assert.rejects(denied.fetch(SCHOOL.login,AbortSignal.timeout(1000)),/URL_DENIED/);assert.equal(calls,1);
 }
 const repeat=new SchoolClient(new CookieJar(),async()=>html('',{status:307,location:SCHOOL.login}));
 await assert.rejects(repeat.fetch(SCHOOL.login,AbortSignal.timeout(1000),new URLSearchParams({password:'test'})),/REDIRECT_DENIED/);
});
test('school login preserves password whitespace, follows validated AIS, and returns only cookies',async()=>{
 let submissions=0;const jar=new CookieJar();
 const transport:SchoolTransport=async(url,options)=>{
  if(url.href===SCHOOL.captcha)return image();
  if(url.href===SCHOOL.home)return html(home);
  if(url.pathname==='/ticket')return html('signed in',{cookies:['ais=fixture; Secure; Path=/']});
  if(options.body!==undefined){submissions++;assert.equal(new URLSearchParams(options.body).get('ctl00$ContentPlaceHolder1$Password'),' secret with spaces ');return html('<a href="https://ais.nutc.edu.tw/ticket">學生管理系統</a>');}
  return html(form);
 };
 const service=new SchoolLoginService(async()=> 'Ab123',()=>new SchoolClient(jar,transport));
 const result=await service.login('test-account',' secret with spaces ');
 assert(result instanceof SchoolClient);assert.equal(submissions,1);assert((await jar.getCookieString(SCHOOL.home)).includes('ais=fixture'));
 assert(!JSON.stringify(await jar.serialize()).includes('secret with spaces'));
});
test('credential errors, lockouts and unknown replies stop immediately and clear cookies',async()=>{
 for(const [message,code]of [['帳號或密碼錯誤','CREDENTIALS_REJECTED'],['帳號已被鎖定','ACCOUNT_LOCKED'],['驗證碼輸入欄位','LOGIN_UNCONFIRMED']]){
  let posts=0;const jar=new CookieJar();await jar.setCookie('test=secret; Secure',SCHOOL.login);
  const client=new SchoolClient(jar,async(url,options)=>url.href===SCHOOL.captcha?image():options.body!==undefined?(posts++,html(form+message)):html(form));
  await assert.rejects(new SchoolLoginService(async()=> 'Ab123',()=>client).login('test','password'),new RegExp(code!));
  assert.equal(posts,1);assert.equal((await jar.serialize()).cookies.length,0);
 }
 // The actual school's permanent warning is not evidence of a locked account.
 assert.equal(loginOutcome(form+'凡使用者密碼連續輸入錯誤3次，將暫停ePortal使用權限。若忘記密碼或解除鎖定請先使用忘記密碼功能').kind,'unknown');
 assert(portalLoginPage(form));
});
test('only explicit captcha rejection retries, with fresh state and a strict three-round limit',async()=>{
 let posts=0,ocr=0;
 const client=new SchoolClient(new CookieJar(),async(url,options)=>{
  if(url.href===SCHOOL.captcha)return image();
  if(options.body!==undefined){assert.equal(new URLSearchParams(options.body).get('__VIEWSTATE'),posts===0?'state':`next-${posts}`);posts++;return html(form.replace('value="state"',`value="next-${posts}"`)+'驗證碼錯誤');}
  return html(form);
 });
 await assert.rejects(new SchoolLoginService(async()=>{ocr++;return 'Ab123';},()=>client).login('test','password'),/CAPTCHA_FAILED/);
 assert.equal(posts,3);assert.equal(ocr,3);
 let invalidPosts=0;const invalid=new SchoolClient(new CookieJar(),async(url,options)=>{if(options.body)invalidPosts++;return url.href===SCHOOL.captcha?image():html(form);});
 await assert.rejects(new SchoolLoginService(async()=> 'bad',()=>invalid).login('test','password'),/CAPTCHA_FAILED/);assert.equal(invalidPosts,0);
});
test('network ambiguity is not retried; abort ends login without a credential POST',async()=>{
 let posts=0;const client=new SchoolClient(new CookieJar(),async(url,options)=>{if(options.body!==undefined){posts++;throw Error('socket contains private details');}return url.href===SCHOOL.captcha?image():html(form);});
 await assert.rejects(new SchoolLoginService(async()=> 'Ab123',()=>client).login('test','password'),/SCHOOL_UNAVAILABLE/);assert.equal(posts,1);
 const abort=new AbortController();const service=new SchoolLoginService(async()=>{abort.abort();return 'Ab123';},()=>client);
 await assert.rejects(service.login('test','password',abort.signal),/SCHOOL_TIMEOUT/);assert.equal(posts,1);
 await assert.rejects(new LocalOcr().recognize(Buffer.from('test'),abort.signal),/SCHOOL_TIMEOUT/);
});
test('student reads use fixed endpoints and reject expired sessions without silent relogin',async()=>{
 let calls=0;const client=new SchoolClient(new CookieJar(),async()=>{calls++;return html(form+'請先登入');});
 for(const action of ['schedule','absence','announcements'] as const)await assert.rejects(new StudentService().query(client,action),/SESSION_EXPIRED/);
 assert.equal(calls,3);
});
test('school MIME quirk is accepted only with image magic bytes; changed tables are not empty data',async()=>{
 const {assertCaptchaImage}=await import('../apps/school-adapter/src/modules/school/captcha.parse.js');
 assert.doesNotThrow(()=>assertCaptchaImage(Buffer.from([255,216,255,0]),'images/jpg'));
 assert.throws(()=>assertCaptchaImage(Buffer.from('<html>login</html>'),'images/jpg'),/CAPTCHA_INVALID/);
 const service=new StudentService();
 const unknown=new SchoolClient(new CookieJar(),async()=>html(home));
 await assert.rejects(service.query(unknown,'schedule'),/PAGE_CHANGED/);
 const empty=new SchoolClient(new CookieJar(),async()=>html('<table class="grid_view"><tr><td>查無資料</td></tr></table>'));
 assert.deepEqual(await service.query(empty,'schedule'),{kind:'schedule',items:[]});
 const schedule='<table class="grid_view"><tr><th>課程</th></tr><tr><td>1</td><td>資訊一甲</td><td>程式設計</td><td></td><td>星期一 第１～２節 (S101)</td><td></td><td></td><td>測試教師</td></tr></table>';
 const result=await service.query(new SchoolClient(new CookieJar(),async()=>html(schedule)),'schedule');
 assert.equal(result.items.length,1);assert.deepEqual(result.items[0],{weekday:1,periods:[1,2],startTime:'08:10',endTime:'10:00',title:'程式設計',teacher:'測試教師',className:'資訊一甲',classroom:'S101'});
});
test('OCR subprocess abort releases concurrency slots and never waits for a hung child',async()=>{
 const ocr=new LocalOcr(new URL('./fixtures/ocr-hang.mjs',import.meta.url));
 const first=new AbortController(),second=new AbortController();
 const one=ocr.recognize(Buffer.from('test'),first.signal),two=ocr.recognize(Buffer.from('test'),second.signal);
 await assert.rejects(ocr.recognize(Buffer.from('test'),AbortSignal.timeout(500)),/OCR_BUSY/);
 first.abort();second.abort();await Promise.all([assert.rejects(one,/SCHOOL_TIMEOUT/),assert.rejects(two,/SCHOOL_TIMEOUT/)]);
 await assert.rejects(ocr.recognize(Buffer.from('test'),AbortSignal.timeout(20)),/SCHOOL_TIMEOUT/);
});

test('denied school URLs record hostname diagnostics without tickets or credentials',async()=>{
 const {schoolUrl}=await import('../apps/school-adapter/src/utils/school-url.js');
 for(const [url,host] of [['http://ais.nutc.edu.tw/login?ticket=PRIVATE','ais.nutc.edu.tw'],['https://unexpected.example/?ticket=PRIVATE','unexpected.example']]){
  try{schoolUrl(url!);assert.fail('must reject');}catch(error){const fault=error as {code:string;urlDiagnostic:{host:string}};assert.equal(fault.code,'SCHOOL_URL_DENIED');assert.equal(fault.urlDiagnostic.host,host);assert(!JSON.stringify(fault).includes('PRIVATE'));}
 }
});

test('school-managed academic1 login transit reaches verified AIS without replaying credentials',async()=>{
 const visited:string[]=[];let posts=0;
 const client=new SchoolClient(new CookieJar(),async(url,options)=>{
  visited.push(url.origin);
  if(url.href===SCHOOL.captcha)return image();
  if(options.body!==undefined){posts++;assert.equal(url.origin,'https://sso.nutc.edu.tw');return html('<a href="https://academic1.nutc.edu.tw/entry?ticket=synthetic">學生管理系統</a>');}
  if(url.origin==='https://academic1.nutc.edu.tw'){assert.equal(options.body,undefined);assert.equal(options.cookie,'');return html('',{status:302,location:'https://eportal.nutc.edu.tw/entry?ticket=synthetic'});}
  if(url.origin==='https://eportal.nutc.edu.tw'){assert.equal(options.body,undefined);return html('',{status:302,location:'https://ais.nutc.edu.tw/entry?ticket=synthetic'});}
  if(url.pathname==='/entry')return html('',{status:302,location:SCHOOL.home,cookies:['ais=fixture; Secure; HttpOnly; Path=/']});
  if(url.href===SCHOOL.home){assert.equal(options.cookie,'ais=fixture');return html(home);}
  return html(form);
 });
 await new SchoolLoginService(async()=> 'Ab123',()=>client,SCHOOL.login).login('test','password');
 assert.equal(posts,1);assert(visited.includes('https://academic1.nutc.edu.tw'));assert(visited.includes('https://eportal.nutc.edu.tw'));
 const {schoolUrl}=await import('../apps/school-adapter/src/utils/school-url.js');
 for(const url of ['http://academic1.nutc.edu.tw/','https://academic1.nutc.edu.tw.evil.example/','https://academic1.nutc.edu.tw:8443/'])assert.throws(()=>schoolUrl(url),/URL_DENIED/);
});

test('portal chooses current AIS entry before similarly named legacy student links',()=>{
 const result=loginOutcome('<a href="https://academic1.nutc.edu.tw/old">舊學生管理系統</a><a href="https://ais.nutc.edu.tw/entry?ticket=fixture">學生管理系統</a>');
 assert.deepEqual(result,{kind:'success',aisUrl:'https://ais.nutc.edu.tw/entry?ticket=fixture'});
 assert.throws(()=>loginOutcome('<a href="https://attacker.example/">學生管理系統</a>'),/AIS_LINK_DENIED/);
 assert.throws(()=>loginOutcome('<a href="https://user:password@ais.nutc.edu.tw/">學生管理系統</a>'),/AIS_LINK_DENIED/);
});

test('student grades query parses multiple semesters, averages, conduct, rank, and respects semester filter',async()=>{
 const gradesHtml='<table class="grid_view">'
  +'<tr class="tr_data" data-yysem="1121"><td>1</td><td>資訊一甲</td><td>計算機概論</td><td></td><td>必</td><td>3</td><td>88.0</td></tr>'
  +'<tr class="tr_data" data-yysem="1121"><td>2</td><td>資訊一甲</td><td>微積分</td><td></td><td>必</td><td>3</td><td>92.0</td></tr>'
  +'<tr class="tr_total" data-yysem="1121"><td></td><td></td><td></td><td></td><td>85.0</td><td>3</td></tr>'
  +'<tr class="tr_data" data-yysem="1122"><td>1</td><td>資訊一甲</td><td>資料結構</td><td></td><td>必</td><td>3</td><td>90.0</td></tr>'
  +'<tr class="tr_total" data-yysem="1122"><td></td><td></td><td></td><td></td><td>88.0</td><td>1</td></tr>'
  +'</table>';
 const client=new SchoolClient(new CookieJar(),async()=>html(gradesHtml));
 const service=new StudentService();

 const sem1=await service.query(client,'grades',{semester:'1121'});
 assert.equal(sem1.kind,'grades');
 assert.equal(sem1.semester,'1121');
 assert.equal(sem1.items.length,2);
 assert.equal(sem1.items[0]?.name,'計算機概論');
 assert.equal(sem1.totalScore,90);
 assert.equal(sem1.conductScore,'85.0');
 assert.equal(sem1.classRank,3);
 assert.deepEqual(sem1.availableSemesters,['1121','1122']);

 const normalized=await service.query(client,'grades',{semester:'112-1'});
 assert.equal(normalized.semester,'1121');
 assert.equal(normalized.items.length,2);

 const sem2=await service.query(client,'grades',{semester:'1122'});
 assert.equal(sem2.semester,'1122');
 assert.equal(sem2.items.length,1);
 assert.equal(sem2.classRank,1);
});

test('student leave query parses leave notes and submit sends compliant form payload',async()=>{
 const notesHtml='<table class="grid_view">'
  +'<tr data-key="101"><td>1</td><td>2026/04/20</td><td>[事假] <i>04/20 第1-2節</i><br>家裡有事</td><td>核准</td><td>審核中</td><td>准假</td></tr>'
  +'</table>';
 const notesClient=new SchoolClient(new CookieJar(),async()=>html(notesHtml));
 const service=new StudentService();
 const notesResult=await service.query(notesClient,'leave_notes');
 assert.equal(notesResult.kind,'leave_notes');
 assert.equal(notesResult.items.length,1);
 assert.deepEqual(notesResult.items[0],{
  id:101,appliedAt:'2026/04/20',type:'事假',courseInfo:'04/20 第1-2節',reason:'家裡有事',teacherStatus:'核准',finalStatus:'審核中',remark:'准假'
 });

 let submittedBody:string|undefined;
 const submitClient=new SchoolClient(new CookieJar(),async(url,options)=>{
  if(url.href===SCHOOL.absenceNoteCreate){submittedBody=options.body;return html('<html>請假單儲存成功</html>');}
  return html(home);
 });
 const submitResult=await service.query(submitClient,'leave_apply',{
  date:'2026/04/29',begin_sec:1,end_sec:2,leave_type:'病假',reason:'流感就診'
 });
 assert.equal(submitResult.kind,'leave_apply');
 assert.equal(submitResult.success,true);
 assert(submittedBody);
 const params=new URLSearchParams(submittedBody);
 assert.equal(params.get('anid'),'0');
 assert.equal(params.get('date'),'2026/04/29');
 assert.equal(params.get('begin_sec'),'1');
 assert.equal(params.get('end_sec'),'2');
 assert.equal(params.get('an_type'),'2');
 assert.equal(params.get('reason'),'流感就診');
 assert.equal(params.get('update'),'儲存');
 assert.equal(params.get('detail'),'[[1,1],[1,2]]');

 const incomplete=await service.query(submitClient,'leave_apply',{reason:''});
 assert.equal(incomplete.success,false);
});

test('student mail send retrieves compose defaults and submits form to webmail',async()=>{
 const submenuHtml='<a href="/cgi-bin/genMail?rand=42">寫信</a>';
 const genMailHtml='<input name="cpid" value="cp_test_99"><input name="crumb" value="crumb_test_88"><input name="FromText" value="s112233@nutc.edu.tw">';
 let sendPayload:string|undefined;

 const client=new SchoolClient(new CookieJar(),async(url,options)=>{
  if(url.href.includes('/submenu'))return html(submenuHtml);
  if(url.href.includes('/genMail'))return html(genMailHtml);
  if(url.href===SCHOOL.webmailSend){sendPayload=options.body;return html('mail sent OK');}
  return html('');
 });

 const service=new StudentService();
 const result=await service.query(client,'send_mail',{
  to:'teacher@nutc.edu.tw',subject:'詢問期末專題',content:'老師您好，想請教專題報告問題。'
 });
 assert.equal(result.kind,'send_mail');
 assert.equal(result.success,true);
 assert(sendPayload);
 const form=new URLSearchParams(sendPayload);
 assert.equal(form.get('cpid'),'cp_test_99');
 assert.equal(form.get('crumb'),'crumb_test_88');
 assert.equal(form.get('FromText'),'s112233@nutc.edu.tw');
 assert.equal(form.get('to'),'teacher@nutc.edu.tw');
 assert.equal(form.get('mailSubject'),'詢問期末專題');
 assert.equal(form.get('mailText'),'老師您好，想請教專題報告問題。');

 const missing=await service.query(client,'send_mail',{to:''});
 assert.equal(missing.success,false);
});
