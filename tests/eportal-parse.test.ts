import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eportalTokens,eportalOutcome,eportalNext,eportalAppAction} from '../apps/school-adapter/src/modules/school/eportal.parse.js';
const json=(data:unknown)=>Buffer.from(JSON.stringify(data));
test('ePortal rejects malformed/unknown login outcomes and requires actual JSON success',()=>{
 for(const [body,type] of [[Buffer.from('invalid'),'application/json'],[json({error:0,url:'/login_check.php'}),'text/html'],[json({error:'0',url:'/login_check.php'}),'application/json']] as const)assert.throws(()=>eportalOutcome(body,type),/LOGIN_UNCONFIRMED/);
 assert.deepEqual(eportalOutcome(json({error:0,url:'/login_check.php'}),'application/json;charset=utf-8'),{kind:'success',url:'https://eportal.nutc.edu.tw/login_check.php'});
 for(const url of ['https://attacker.example/','http://eportal.nutc.edu.tw/','https://u:p@ais.nutc.edu.tw/'])assert.throws(()=>eportalOutcome(json({error:0,url}),'application/json'),/URL_DENIED/);
});
test('ePortal distinguishes explicit credentials, captcha and lock rejection from unknown warnings',()=>{
 assert.deepEqual(eportalOutcome(json({error:3,err_msg:'密碼錯誤'}),'application/json'),{kind:'credentials'});
 assert.deepEqual(eportalOutcome(json({error:2,err_msg:'帳號不存在'}),'application/json'),{kind:'credentials'});
 assert.deepEqual(eportalOutcome(json({error:4,err_msg:'驗證碼錯誤'}),'application/json'),{kind:'captcha'});
 assert.deepEqual(eportalOutcome(json({error:9,err_msg:'帳號已被鎖定'}),'application/json'),{kind:'locked'});
 assert.deepEqual(eportalOutcome(json({error:99,err_msg:'凡使用者密碼連續輸入錯誤3次，將暫停使用權限'}),'application/json'),{kind:'rejected'});
 assert.deepEqual(eportalOutcome(json({error:3,err_msg:'Unexpected locale'}),'application/json'),{kind:'credentials'});
 assert.deepEqual(eportalOutcome(json({error:777,err_msg:'Unknown explicit rejection'}),'application/json'),{kind:'rejected'});
 assert.deepEqual(eportalOutcome(json({error:9007199254740992,err_msg:'Large explicit rejection'}),'application/json'),{kind:'rejected'});
 for(const error of [null,'777',1.5,-1])assert.throws(()=>eportalOutcome(json({error}),'application/json'),/LOGIN_UNCONFIRMED/);
 assert.throws(()=>eportalOutcome(json({error:999999,err_msg:'Reload required'}),'application/json'),/LOGIN_UNCONFIRMED/);
});
test('ePortal parses only fixed JS auth transitions without executing code or allowing ambiguity',()=>{
 assert.equal(eportalNext('<script>window.location="\\/redirect2app.php";</script>','https://eportal.nutc.edu.tw/login_main.php'),'https://eportal.nutc.edu.tw/redirect2app.php');
 for(const html of ['<script>window.location="https://attacker.example/";</script>','<script>window.location="/logout.php";</script>','<script>window.location="/token_auth.php";window.location="/redirect2app.php";</script>','<script>window.location=dynamicFunction();</script>'])assert.throws(()=>eportalNext(html,'https://eportal.nutc.edu.tw/login_check.php'),/URL_DENIED|LOGIN_UNCONFIRMED/);
 assert.equal(eportalNext('<script>window.location="/logout.php";</script>','https://ais.nutc.edu.tw/student/home.aspx'),undefined);
});
test('ePortal requires the observed student application and login fields',()=>{
 for(const html of ['<input name="login_name">','<meta name="csrf-token" content="csrf"><form id="loginForm"><input name="app_id" value="OTHER"><input name="login_name"><input name="password"><input name="verify_code"></form>'])assert.throws(()=>eportalTokens(html),/LOGIN_PAGE_CHANGED/);
 const script='<script>$.ajax({url:"/redirect2app.php",data:{action:"get_redirect_url",app_id:"NUTC_6401"}})</script>';
 assert.equal(eportalAppAction(script),'get_redirect_url');
 assert.throws(()=>eportalAppAction(script.replace('NUTC_6401','OTHER')),/LOGIN_UNCONFIRMED/);
 assert.throws(()=>eportalAppAction(script.replace('get_redirect_url','delete_user')),/LOGIN_UNCONFIRMED/);
});
