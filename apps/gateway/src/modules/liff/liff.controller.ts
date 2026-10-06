import type { ServerResponse } from 'node:http';
import { json } from '../../utils/http.js';
const css=`:root{font-family:system-ui,sans-serif;color:#142b40;background:#f2f5f8}body{margin:0;padding:24px}main{max-width:480px;margin:8vh auto;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 36px #142b4012}h1{font-size:24px;line-height:1.4}p{line-height:1.7}button{width:100%;padding:14px;border:0;border-radius:10px;background:#087b4a;color:white;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.55}label{display:block;margin:16px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:6px;font:inherit}small{display:block;line-height:1.6;color:#526477;margin-top:24px}`;
const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>中科大校園助理</title><style>${css}</style></head><body><main><h1>中科大校園助理</h1><p>登入 LINE 進行校務身分綁定。</p><p id="status" role="status" aria-live="polite">載入中…</p><button id="login" type="button" disabled>使用 LINE 登入</button><section id="search-result" hidden></section><form id="binding" hidden><label>學號<input name="account" required maxlength="32" autocomplete="username" pattern="[A-Za-z0-9]+"></label><label>校務密碼<input name="password" type="password" required maxlength="256" autocomplete="current-password"></label><button id="bind" type="submit">綁定校務帳號</button></form><small>公開問答內容可能傳送至 Gemini 並保留最多七天的對話記憶。校務帳密及私人查詢結果由本地服務處理，不提供給模型。請勿在 LINE 對話輸入密碼。</small></main><script src="https://static.line-scdn.net/liff/edge/versions/2.31.1/sdk.js" charset="utf-8" defer></script><script src="/liff/app.js" defer></script></body></html>`;
const script=`'use strict';
const button=document.getElementById('login'),status=document.getElementById('status');
let csrfToken;
const resultId=new URLSearchParams(location.search).get('result')||new URLSearchParams(new URLSearchParams(location.search).get('liff.state')?.replace(/^[?]/, '')||'').get('result');
const form=document.getElementById('binding');
form.addEventListener('submit',async event=>{
 event.preventDefault();const submit=document.getElementById('bind');submit.disabled=true;
 const account=form.elements.account.value,password=form.elements.password.value;form.elements.password.value='';
 status.textContent='正在登入校務系統…';
 try{
  const response=await fetch('/liff/bind',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({account,password})});
  const result=await response.json();
  const messages={SCHOOL_CAPTCHA_FAILED:'校方驗證碼辨識失敗，這不代表帳密錯誤。請稍後再試。',SCHOOL_ACCOUNT_LOCKED:'校務帳號已鎖定或停用，請向學校確認。',SCHOOL_CREDENTIALS_REJECTED:'學號或密碼錯誤，請確認後再試。',SCHOOL_AUTHENTICATION_REJECTED:'校方拒絕此次登入，這不一定代表密碼錯誤。請確認帳號狀態或稍後再試。',SCHOOL_LOGIN_RATE_LIMIT:'校方已兩次拒絕登入。為避免重複嘗試，請確認帳號狀態，並於最後一次失敗 15 分鐘後再試。',SCHOOL_LOGIN_BUSY:'已有登入正在進行，請稍後再試。',SCHOOL_ACCOUNT_ALREADY_BOUND:'此學號已綁定其他 LINE 帳號。',LIFF_SESSION_REQUIRED:'登入階段已失效，請重新開啟頁面。'};
  status.textContent=response.ok?'校務綁定成功，可以關閉此頁面。':(messages[result.error]||'目前無法完成綁定，請稍後再試。');
  if(response.ok)form.hidden=true;
 }catch{status.textContent='連線中斷，請稍後再試。';}finally{submit.disabled=false;}
});
async function verify(){
 button.disabled=true;status.textContent='正在驗證 LINE 身分…';
 try{
  const idToken=liff.getIDToken();if(!idToken)throw Error('TOKEN');
  const res=await fetch('/liff/identity',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({idToken})});
  if(!res.ok){
   const failure=await res.json();
   if(failure.error==='BINDING_REVOKED'){
    status.textContent='你已解除綁定。如要重新使用，請先在助理聊天室傳送「重新啟用」，再重新開啟本頁。';
   }else if(res.status===403){
    status.textContent='目前無法驗證此 LINE 帳號。';
   }else{
    status.textContent='LINE 登入已失效，請點擊下方重新登入。';
    try{if(liff.isLoggedIn())liff.logout();}catch(e){void e;}
    button.disabled=false;button.hidden=false;
   }
   return;
  }
  const verified=await res.json();if(!verified.csrfToken)throw Error('SESSION');csrfToken=verified.csrfToken;
  if(resultId){
   const response=await fetch('/liff/result',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({taskId:resultId})});
   if(!response.ok){status.textContent='這份搜尋回答已過期或不屬於目前帳號。';return;}
   const result=await response.json();const section=document.getElementById('search-result');
   section.attachShadow({mode:'closed'}).innerHTML=result.html;section.hidden=false;button.hidden=true;status.textContent='Google 搜尋回答';return;
  }
  button.hidden=true;form.hidden=false;status.textContent='LINE 身分已驗證。請輸入本人的校務帳號；密碼不會保存。';
 }catch{
  status.textContent='無法完成 LINE 驗證，請點擊下方重新登入。';
  try{if(liff.isLoggedIn())liff.logout();}catch(e){void e;}
  button.disabled=false;button.hidden=false;
 }
}
(async()=>{
 try{
  const res=await fetch('/liff/config',{credentials:'same-origin'});if(!res.ok)throw Error('CONFIG');
  const config=await res.json();await liff.init({liffId:config.liffId});
  if(liff.isLoggedIn()){await verify();return;}
  status.textContent='請使用 LINE 帳號登入。';button.disabled=false;
  button.addEventListener('click',()=>{
   button.disabled=true;
   try{if(liff.isLoggedIn())liff.logout();}catch(e){void e;}
   liff.login({redirectUri:config.endpoint+(resultId?'?result='+encodeURIComponent(resultId):'')});
  });
 }catch{status.textContent='服務尚未完成設定，請稍後再試。';}
})();`;
export class LiffController {
  constructor(private readonly origin:string,private readonly liffId?:string){}
  handle(path:string,res:ServerResponse){
    if(path==='/liff/config')return this.liffId?json(res,200,{liffId:this.liffId,endpoint:`${this.origin}/liff/`}):json(res,503,{error:'LIFF_NOT_CONFIGURED'});
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://*.line.me https://*.line-scdn.net; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    res.writeHead(200,{'Content-Type':path==='/liff/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});
    res.end(path==='/liff/app.js'?script:html);
  }
}
