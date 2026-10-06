import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LiffController } from '../apps/gateway/src/modules/liff/liff.controller.js';
import { LineController } from '../apps/gateway/src/modules/line/line.controller.js';
import { LineService } from '../apps/gateway/src/modules/line/line.service.js';
import { lineRouter } from '../apps/gateway/src/modules/line/line.router.js';
test('LIFF endpoint preserves SDK callbacks and identity rejects cross-origin before verification',async()=>{
  const origin='https://campus.example'; let verified=0;
  const service=new LineService({accept:async()=>{},identity:async()=>({sessionKey:'test'})},{verifyIdentity:async()=>{verified++;return `U${'a'.repeat(32)}`;}});
  const server=createServer(lineRouter(new LineController(service,'secret','destination',origin),undefined,undefined,new LiffController(origin,'2011885607-test')));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    const page=await fetch(`${base}/liff?liff.state=%2F&code=sensitive&state=test`);
    assert.equal((await fetch(`${base}/liff/`)).status,200);
    assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
    const html=await page.text();assert(!html.includes('sensitive'));assert(html.includes('/liff/app.js'));
    assert(html.includes('本人的校務查詢結果會提供給 Google Gemini 整理'));
    assert(html.includes('校務登入密碼與 Cookie 不提供給模型，密碼不保存'));
    assert(!html.includes('私人查詢結果由本地服務處理，不提供給模型'));
    assert.deepEqual(await (await fetch(`${base}/liff/config`)).json(),{liffId:'2011885607-test',endpoint:`${origin}/liff/`});
    for(const requestOrigin of [undefined,'https://untrusted.example']){
      const headers:Record<string,string>={'Content-Type':'application/json'};if(requestOrigin)headers.Origin=requestOrigin;
      assert.equal((await fetch(`${base}/liff/identity`,{method:'POST',headers,body:JSON.stringify({idToken:'test'})})).status,403);
    }
    assert.equal(verified,0);
    const allowed=await fetch(`${base}/liff/identity`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({idToken:'test'})});
    assert.equal(allowed.status,200);assert.equal(verified,1);
    assert.deepEqual(await allowed.json(),{verified:true});
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
test('LIFF browser script compiles and keeps grounded results in an isolated style root',async()=>{
 const server=createServer((_req,res)=>new LiffController('https://campus.example','2011885607-test').handle('/liff/app.js',res));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const js=await(await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/liff/app.js`)).text();assert.doesNotThrow(()=>new Function(js));assert(js.includes("attachShadow({mode:'closed'})"));assert(js.includes("'/liff/result'"));}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
