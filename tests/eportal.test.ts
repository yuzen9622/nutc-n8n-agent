import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {SchoolClient,type SchoolResponse} from '../apps/school-adapter/src/modules/school/school.client.js';
import {SchoolLoginService} from '../apps/school-adapter/src/modules/school/login.service.js';
const origin='https://eportal.nutc.edu.tw';
const page='<meta name="csrf-token" content="fixture-csrf"><form id="loginForm"><input name="loginCheck" value="0"><input name="app_id" value="NUTC_6401"><input name="login_name"><input name="password"><input name="verify_code"></form>';
const response=(body:string,contentType='text/html',extra:Partial<SchoolResponse>={}):SchoolResponse=>({status:200,body:Buffer.from(body),contentType,cookies:[],...extra});
const image=()=>({...response('','image/png'),body:Buffer.from([137,80,78,71,13,10,26,10])});
test('new ePortal verifies four-character captcha, sends CSRF once, follows JS auth then AIS ticket',async()=>{
 const jar=new CookieJar();let passwordPosts=0,verified=false;const visited:string[]=[];
 const client=new SchoolClient(jar,async(url,options)=>{
  visited.push(url.pathname);
  if(url.pathname==='/login_page.php'){
   if(!options.body)return image();
   const form=new URLSearchParams(options.body);assert.equal(form.get('action'),'verifyCode');assert.equal(form.get('code'),'1234');assert(!form.has('password'));verified=true;return response('valid','text/plain');
  }
  if(url.pathname==='/login_action.php'){
   assert(verified);passwordPosts++;const form=new URLSearchParams(options.body);
   assert.equal(options.csrfToken,'fixture-csrf');assert.equal(form.get('password'),' secret ');assert.equal(form.get('app_id'),'NUTC_6401');
   return response(JSON.stringify({error:0,url:'/login_check.php'}),'application/json');
  }
  assert.equal(options.csrfToken,undefined);
  if(url.pathname==='/login_check.php')return response('<script>window.location.href="/token_auth.php?fromcheck=1";</script>');
  if(url.pathname==='/token_auth.php')return response('', 'text/html',{status:302,location:'/login_main.php',cookies:['sso=fixture; Domain=nutc.edu.tw; Path=/; Secure','sso=ignore; Domain=20.110.71; Path=/; Secure']});
  if(url.pathname==='/login_main.php')return response('<script>window.location="\\/redirect2app.php";</script>');
  if(url.pathname==='/redirect2app.php'){
   if(options.body){assert.equal(new URLSearchParams(options.body).get('app_id'),'NUTC_6401');return response(JSON.stringify({error:0,url:'https://ais.nutc.edu.tw/student/sso.aspx?ticket=fixture'}),'application/json');}
   return response('<script>$.ajax({url:"/redirect2app.php",data:{action:"get_redirect_url",app_id:"NUTC_6401"}})</script>');
  }
  if(url.pathname==='/student/sso.aspx'){assert.equal(options.body,undefined);assert.equal(options.csrfToken,undefined);return response('', 'text/html',{status:302,location:'/student/home.aspx',cookies:['ais=fixture; Secure; HttpOnly; Path=/']});}
  if(url.pathname==='/student/home.aspx'){assert((options.cookie||'').includes('ais=fixture'));return response('<table class="grid_view"></table>');}
  return response(page);
 });
 const result=await new SchoolLoginService(async()=> '1234',()=>client).login('fixture',' secret ');
 assert.equal(result,client);assert.equal(passwordPosts,1);assert(visited.includes('/redirect2app.php'));
 assert(!(await jar.getCookieString(origin)).includes('ignore'));assert(!JSON.stringify(await jar.serialize()).includes(' secret '));
});
test('CSRF is confined to fixed ePortal POST and removed on redirects',async()=>{
 let calls=0;const client=new SchoolClient(undefined,async(url,options)=>{calls++;if(calls===1){assert.equal(options.csrfToken,'csrf');return response('', 'text/html',{status:302,location:'https://ais.nutc.edu.tw/student/home.aspx'});}assert.equal(options.csrfToken,undefined);assert.equal(options.body,undefined);return response('done');});
 await client.fetch(origin+'/login_action.php',AbortSignal.timeout(1000),new URLSearchParams({password:'fixture'}),{csrfToken:'csrf'});assert.equal(calls,2);
 for(const url of [origin+'/other','https://ais.nutc.edu.tw/student/home.aspx'])await assert.rejects(client.fetch(url,AbortSignal.timeout(1000),new URLSearchParams(),{csrfToken:'csrf'}),/URL_DENIED/);
});
test('new ePortal never submits credentials for rejected captcha and caps OCR at three',async()=>{
 let ocr=0,posts=0;const client=new SchoolClient(undefined,async(url,options)=>{
  if(url.pathname==='/login_page.php')return options.body?response('error','text/plain'):image();
  if(options.body)posts++;return response(page);
 });
 await assert.rejects(new SchoolLoginService(async()=>{ocr++;return '1234';},()=>client).login('fixture','secret'),/CAPTCHA_FAILED/);
 assert.equal(ocr,3);assert.equal(posts,0);
});
