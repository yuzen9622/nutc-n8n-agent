import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {SchoolClient,type SchoolResponse} from '../apps/school-adapter/src/modules/school/school.client.js';
import {SchoolLoginService} from '../apps/school-adapter/src/modules/school/login.service.js';
const page='<meta name="csrf-token" content="csrf"><form id="loginForm"><input name="app_id" value="NUTC_6401"><input name="login_name"><input name="password"><input name="verify_code"></form>';
const response=(text:string,type='text/html'):SchoolResponse=>({status:200,body:Buffer.from(text),contentType:type,cookies:[]});
test('explicit new ePortal rejection stops after one credential POST and erases all cookies',async()=>{
 for(const [error,message,code] of [[3,'Other locale','SCHOOL_CREDENTIALS_REJECTED'],[777,'Unknown refusal','SCHOOL_AUTHENTICATION_REJECTED'],[9,'account is locked','SCHOOL_ACCOUNT_LOCKED'],[999999,'Reload','SCHOOL_LOGIN_UNCONFIRMED']] as const){
  let posts=0;const jar=new CookieJar();await jar.setCookie('fixture=secret; Secure; Path=/','https://eportal.nutc.edu.tw/');
  const client=new SchoolClient(jar,async(url,options)=>{
   if(url.pathname==='/login_page.php')return options.body?response('valid','text/plain'):{...response('','image/png'),body:Buffer.from([137,80,78,71,13,10,26,10])};
   if(url.pathname==='/login_action.php'){posts++;return response(JSON.stringify({error,err_msg:message}),'application/json');}
   return response(page);
  });
  await assert.rejects(new SchoolLoginService(async()=> '1234',()=>client).login('fixture','password'),new RegExp(code));
  assert.equal(posts,1);assert.equal((await jar.serialize()).cookies.length,0);
 }
});
test('new ePortal cancellation after OCR never submits a password or reuses cookies',async()=>{
 const abort=new AbortController();let posts=0;const client=new SchoolClient(undefined,async(url,options)=>{
  if(options.body)posts++;
  return url.pathname==='/login_page.php'?{...response('','image/png'),body:Buffer.from([137,80,78,71,13,10,26,10])}:response(page);
 });
 await assert.rejects(new SchoolLoginService(async()=>{abort.abort();return '1234';},()=>client).login('fixture','password',abort.signal),/SCHOOL_TIMEOUT/);
 assert.equal(posts,0);assert.equal((await client.jar.serialize()).cookies.length,0);
});
