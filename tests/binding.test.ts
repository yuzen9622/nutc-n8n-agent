import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {BindingController} from '../apps/gateway/src/modules/liff/binding.controller.js';
import {BindingService} from '../apps/gateway/src/modules/liff/binding.service.js';
import {lineRouter} from '../apps/gateway/src/modules/line/line.router.js';
import type {LineController} from '../apps/gateway/src/modules/line/line.controller.js';
import {Fault} from '../apps/gateway/src/utils/fault.js';
test('binding uses verified owner, requires origin and CSRF, and never returns school secrets',async()=>{
 const owner=`U${'a'.repeat(32)}`,token='t'.repeat(43),csrf='c'.repeat(43);let calls=0,live=true;
 const service=new BindingService({issue:async user=>{assert.equal(user,owner);return {token,csrf};},authorize:async(t,c)=>{if(!live||t!==token||c!==csrf)throw new Fault(401,'LIFF_SESSION_REQUIRED');return owner;}},{verifyIdentity:async()=>owner},{bind:async(user,account,password)=>{calls++;assert.equal(user,owner);assert.equal(account,'student');assert.equal(password,' pass ');}});
 const server=createServer(lineRouter({}as LineController,undefined,undefined,undefined,new BindingController(service,'https://campus.example')));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const send=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(`${base}/liff/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://campus.example',...headers},body:JSON.stringify(body)});
 try{
  const identity=await send('identity',{idToken:'verified'});assert.equal(identity.status,200);assert.match(identity.headers.get('set-cookie')!,/Secure; HttpOnly; SameSite=Strict/);assert.deepEqual(await identity.json(),{verified:true,csrfToken:csrf});
  const headers={Cookie:`__Host-campus_liff=${token}`,'X-CSRF-Token':csrf},body={account:'student',password:' pass '};
  assert.equal((await send('bind',body)).status,401);
  assert.equal((await send('bind',body,{...headers,Origin:'https://evil.example'})).status,403);
  assert.equal((await send('bind',body,{...headers,'X-CSRF-Token':'wrong'})).status,401);
  assert.equal((await send('bind',{...body,userId:'forged'},headers)).status,400);assert.equal(calls,0);
  const success=await send('bind',body,headers);assert.equal(success.status,200);assert.deepEqual(await success.json(),{bound:true});assert.equal(calls,1);
  live=false;assert.equal((await send('bind',body,headers)).status,401);assert.equal(calls,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('binding refuses late success when browser session is revoked during school login',async()=>{
 let live=true;
 const service=new BindingService({issue:async()=>({token:'',csrf:''}),authorize:async()=>{if(!live)throw new Fault(401,'LIFF_SESSION_REQUIRED');return 'verified-owner';}},{verifyIdentity:async()=>''},{bind:async()=>{live=false;}});
 await assert.rejects(service.bind('token','csrf','student','password'),/LIFF_SESSION_REQUIRED/);
});
test('grounded result endpoint requires browser session and only uses its verified owner',async()=>{
 const token='t'.repeat(43),csrf='c'.repeat(43),taskId='12345678-1234-4234-8234-123456789012';let reads=0;
 const sessions={authorize:async(t:string,c:string)=>{if(t!==token||c!==csrf)throw new Fault(401,'LIFF_SESSION_REQUIRED');return 'verified-owner';}};
 const tasks={groundedResult:async(user:string,id:string)=>{reads++;assert.equal(user,'verified-owner');assert.equal(id,taskId);return '<article>verified</article>';}};
 const controller=new BindingController({}as BindingService,'https://campus.example',sessions as import('../apps/gateway/src/modules/liff/binding.repository.js').BindingRepository,tasks as unknown as import('../apps/gateway/src/modules/tasks/task.repository.js').TaskRepository);
 const server=createServer(lineRouter({}as LineController,undefined,undefined,undefined,controller));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const headers={'Content-Type':'application/json',Origin:'https://campus.example',Cookie:`__Host-campus_liff=${token}`,'X-CSRF-Token':csrf};
 const send=(body:unknown,h=headers)=>fetch(base+'/liff/result',{method:'POST',headers:h,body:JSON.stringify(body)});
 try{
  assert.equal((await send({taskId},{...headers,'X-CSRF-Token':'wrong'})).status,401);
  assert.equal((await send({taskId,userId:'attacker'})).status,400);
  assert.equal((await send({taskId},{...headers,Origin:'https://evil.test'})).status,403);assert.equal(reads,0);
  const response=await send({taskId});assert.equal(response.status,200);assert.deepEqual(await response.json(),{html:'<article>verified</article>'});assert.equal(reads,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
