import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import type {AddressInfo} from 'node:net';
import {publicRouter} from '../apps/gateway/src/modules/ingress/public.router.js';
test('public ingress cannot proxy internal paths, validates host and preserves signed LINE bytes',async()=>{
 let called=0;
 const router=publicRouter('https://nutc-agent.yuzen.dev',undefined,async(url,init)=>{
  called++;assert.equal(String(url),'http://127.0.0.1:3100/line/webhook');
  assert.equal(Buffer.from(init!.body as Uint8Array).toString(),'{ "test": 1 }');
  const headers=new Headers(init?.headers);assert.equal(headers.get('x-line-signature'),'signature');assert.equal(headers.get('authorization'),null);
  return Response.json({accepted:true});
 });
 const server=createServer(router);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const call=(path:string,method='GET',host='nutc-agent.yuzen.dev')=>new Promise<number>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:(server.address() as AddressInfo).port,path,method,headers:{Host:host,'x-line-signature':'signature',Authorization:'must-not-forward'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});
  req.on('error',reject);req.end(method==='POST'?'{ "test": 1 }':undefined);
 });
 try{
  assert.equal(await call('/liff/'),200);assert.equal(await call('/liff?code=sensitive&state=test&liff.state=%2F'),200);assert.equal(await call('/liff-other'),404);assert.equal(await call('/liff/config'),503);
  assert.equal(await call('/liff/','GET','attacker.example'),421);
  for(const path of ['/internal/v1/agent/prepare','/providers/gemini/v1beta/models/x:generateContent','/liff/../internal/v1/agent/prepare','/line/webhook?extra=1','//line/webhook'])assert.equal(await call(path,'POST'),404);
  assert.equal(called,0);assert.equal(await call('/line/webhook','POST'),200);assert.equal(called,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
