import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {SessionCrypto} from '../apps/school-adapter/src/modules/school/session.crypto.js';
import {schoolLoginSchema,schoolQuerySchema} from '../apps/school-adapter/src/modules/school/school.schema.js';
import {SchoolController} from '../apps/school-adapter/src/modules/school/school.controller.js';
import {schoolRouter} from '../apps/school-adapter/src/modules/school/school.router.js';
import {SchoolService} from '../apps/school-adapter/src/modules/school/school.service.js';
import type {SchoolSessionRepository} from '../apps/school-adapter/src/modules/school/session.repository.js';
import type {SchoolLoginService} from '../apps/school-adapter/src/modules/school/login.service.js';
import {SchoolError} from '../apps/school-adapter/src/utils/school-error.js';
const user=`U${'a'.repeat(32)}`;
test('school cookie encryption binds owner and session ID, rejects tampering and distinct keys',()=>{
 const crypto=new SessionCrypto('a'.repeat(64),'b'.repeat(64)),value='{"cookies":["private-cookie"]}';
 const encrypted=crypto.seal(value,user,'session-a');assert(!encrypted.includes('private-cookie'));assert.notEqual(encrypted,crypto.seal(value,user,'session-a'));
 assert.equal(new SessionCrypto('a'.repeat(64),'b'.repeat(64)).open(encrypted,user,'session-a'),value);
 assert.throws(()=>crypto.open(encrypted,'other-user','session-a'),/SESSION_INVALID/);
 assert.throws(()=>crypto.open(encrypted,user,'session-b'),/SESSION_INVALID/);
 const parts=encrypted.split('.');parts[3]=(parts[3]!.startsWith('A')?'B':'A')+parts[3]!.slice(1);assert.throws(()=>crypto.open(parts.join('.'),user,'session-a'),/SESSION_INVALID/);
 assert.throws(()=>new SessionCrypto('a'.repeat(64),'a'.repeat(64)),/CONFIG_INVALID/);
 assert.equal(crypto.accountHash('ABC123'),crypto.accountHash('abc123'));assert(!crypto.accountHash('ABC123').includes('ABC123'));
});
test('school input contract preserves password and rejects client cookies, unknown operations and extra fields',()=>{
 assert.equal(schoolLoginSchema.parse({userId:user,account:'1234567890',password:' pass '}).password,' pass ');
 assert(!schoolLoginSchema.safeParse({userId:user,account:'123',password:'pass',cookies:'forged'}).success);
 assert(!schoolQuerySchema.safeParse({userId:user,action:'write-absence'}).success);
});
test('school HTTP authenticates before parsing and returns only safe errors for real service failures',async()=>{
 let admitted=0,cancelled=0;
 const sessions={beginLogin:async()=>{admitted++;return {id:'lease',userId:user,accountHash:'hash',generation:'0'};},cancelLogin:async()=>{cancelled++;}} as unknown as SchoolSessionRepository;
 const authentication={login:async()=>{throw new SchoolError('SCHOOL_CREDENTIALS_REJECTED');}} as unknown as SchoolLoginService;
 const server=createServer(schoolRouter(new SchoolController(new SchoolService(sessions,authentication)),'token'.repeat(10)));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const send=(body:string,authorized=true)=>fetch(`${base}/internal/v1/school/login`,{method:'POST',headers:{'content-type':'application/json',...(authorized?{'x-campus-school':'token'.repeat(10)}:{})},body});
 try{
  assert.equal((await send('{bad',false)).status,401);assert.equal(admitted,0);
  assert.equal((await send(JSON.stringify({userId:user,account:'123',password:' pass ',unexpected:true}))).status,400);assert.equal(admitted,0);
  const result=await send(JSON.stringify({userId:user,account:'123',password:' pass '}));assert.equal(result.status,401);assert.deepEqual(await result.json(),{error:'SCHOOL_CREDENTIALS_REJECTED'});assert.equal(admitted,1);assert.equal(cancelled,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('school login distinguishes technical faults from actual credential rejection',async()=>{
 for(const [code,expected] of [['OCR_FAILED','technical_failure'],['SCHOOL_TIMEOUT','technical_failure'],['SCHOOL_LOGIN_UNCONFIRMED','technical_failure'],['SCHOOL_CREDENTIALS_REJECTED','credentials_rejected'],['SCHOOL_AUTHENTICATION_REJECTED','authentication_rejected'],['SCHOOL_ACCOUNT_LOCKED','account_locked']]){
  let outcome:unknown;
  const sessions={beginLogin:async()=>({id:'lease',userId:user,accountHash:'hash',generation:'0'}),cancelLogin:async(_lease:unknown,value:unknown)=>{outcome=value;}} as unknown as SchoolSessionRepository;
  const authentication={login:async()=>{throw new SchoolError(code!);}} as unknown as SchoolLoginService;
  await assert.rejects(new SchoolService(sessions,authentication).login(user,'student','not-persisted'));
  assert.equal(outcome,expected);
 }
});
