import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LineProvider, verifySignature } from '../apps/gateway/src/modules/line/line.provider.js';
import { LineService } from '../apps/gateway/src/modules/line/line.service.js';
import { identitySchema, webhookSchema } from '../apps/gateway/src/modules/line/line.schema.js';
import { LineRepository } from '../apps/gateway/src/modules/line/line.repository.js';
import type { Pool } from 'pg';
const user = `U${'a'.repeat(32)}`;

test('raw signature binds exact bytes and rejects malformed/missing signatures',() => {
  const body=Buffer.from('{"text":"測試"}'), secret='channel-secret';
  const signature=createHmac('sha256',secret).update(body).digest('base64');
  assert(verifySignature(body,signature,secret));
  assert(!verifySignature(Buffer.from(body.toString()+' '),signature,secret));
  for (const bad of [undefined,'',signature+'=',signature.replace(/.$/,'A')]) assert(!verifySignature(body,bad,secret));
});
test('LINE identity verification uses provider response, validates audience and expiry',async () => {
  const now=Math.floor(Date.now()/1000);
  for (const [claims,valid] of [
    [{iss:'https://access.line.me',sub:user,aud:'123',exp:now+60,iat:now},true],
    [{iss:'https://access.line.me',sub:user,aud:'456',exp:now+60,iat:now},false],
    [{iss:'https://access.line.me',sub:user,aud:'123',exp:now-1,iat:now},false],
  ] as const) {
    const request: typeof fetch=async (url,options) => {
      assert.equal(url,'https://api.line.me/oauth2/v2.1/verify');
      assert.equal(new URLSearchParams(String(options?.body)).get('client_id'),'123');
      assert.equal(options?.redirect,'error'); return Response.json(claims);
    };
    const result=new LineProvider('123','access',request).verifyIdentity('id-token');
    if(valid) assert.equal(await result,user); else await assert.rejects(result);
  }
  assert(!identitySchema.safeParse({idToken:'token',userId:user}).success);
});
test('group/room and non-text events are discarded; only minimized fields reach repository',async () => {
  const accepted: unknown[][]=[];
  const service=new LineService({accept:async (...args) => {accepted.push(args);},identity:async () => ({sessionKey:'unused'})},{verifyIdentity:async () => user});
  const parsed=webhookSchema.parse({destination:user,events:[
    {type:'message',webhookEventId:'group',timestamp:Date.now(),source:{type:'group',userId:user,groupId:'secret'},message:{type:'text',text:'私人群組'}},
    {type:'message',webhookEventId:'image',timestamp:Date.now(),source:{type:'user',userId:user},message:{type:'image'}},
    {type:'message',webhookEventId:'clear',timestamp:Date.now(),source:{type:'user',userId:user},message:{type:'text',text:'清除對話'},replyToken:'not-retained'},
    {type:'unfollow',webhookEventId:'revoke',timestamp:Date.now(),source:{type:'user',userId:user}},
  ]});
  await service.receive(parsed.events);
  assert.deepEqual(accepted,[['clear',user,'清除對話','clear'],['revoke',user,'','revoke']]);
});
test('session keys isolate users and rotate after clear/revoke',() => {
  const repository=new LineRepository({} as Pool,'x'.repeat(32));
  assert.notEqual(repository.sessionKey(user,0),repository.sessionKey(`U${'b'.repeat(32)}`,0));
  assert.notEqual(repository.sessionKey(user,0),repository.sessionKey(user,1));
  assert(!repository.sessionKey(user,0).includes(user));
});
test('only exact one-to-one resume command is treated as renewed consent',async()=>{
  const commands:string[]=[];
  const service=new LineService({accept:async(_event,_user,_text,command)=>{commands.push(command);},identity:async()=>({sessionKey:'unused'})},{verifyIdentity:async()=>user});
  await service.receive(['重新啟用','請幫我重新啟用','解除綁定'].map((text,index)=>({type:'message',webhookEventId:String(index),timestamp:Date.now(),source:{type:'user',userId:user},message:{type:'text',text}})));
  assert.deepEqual(commands,['resume','message','revoke']);
  await service.receive([{type:'message',webhookEventId:'group-resume',timestamp:Date.now(),source:{type:'group',userId:user},message:{type:'text',text:'重新啟用'}}]);
  assert.equal(commands.length,3);
});
test('delivery retries retain the exact key and only accept confirmed duplicates',async () => {
  const retry='e7f2928d-1d28-40ab-9684-79cb74f781ae'; let calls=0;
  const provider=new LineProvider('123','access',async (_url,options) => {
    assert.equal((options?.headers as Record<string,string>)['X-Line-Retry-Key'],retry); calls++;
    return new Response(null,{status:409,headers:calls===1?{'x-line-accepted-request-id':'accepted'}:{}});
  });
  await provider.push(user,'測試',retry); await assert.rejects(provider.push(user,'測試',retry));
});

test('signed stale/future events cannot recreate tasks after inbox retention',async () => {
  let calls=0;
  const service=new LineService({accept:async () => {calls++;},identity:async () => ({sessionKey:'unused'})},{verifyIdentity:async () => user});
  await service.receive([Date.now()-25*60*60*1000,Date.now()+10*60*1000].map(timestamp => ({
    type:'message',webhookEventId:String(timestamp),timestamp,source:{type:'user',userId:user},message:{type:'text',text:'課表'},
  })));
  assert.equal(calls,0);
});

test('HTTP ingress verifies raw signature before JSON and waits for durable acceptance',async t => {
  const {createServer}=await import('node:http');
  const {LineController}=await import('../apps/gateway/src/modules/line/line.controller.js');
  const {lineRouter}=await import('../apps/gateway/src/modules/line/line.router.js');
  let accepted=0,fail=false;
  const service=new LineService({accept:async () => {if(fail) throw Error('private database detail'); accepted++;},identity:async () => ({sessionKey:'unused'})},{verifyIdentity:async () => user});
  const server=createServer(lineRouter(new LineController(service,'secret',user)));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert(address && typeof address==='object');
  const url=`http://127.0.0.1:${address.port}/line/webhook`;
  assert.equal((await fetch(url,{method:'POST',body:'not json'})).status,401);
  const body=JSON.stringify({destination:user,events:[{type:'message',webhookEventId:'event',timestamp:Date.now(),source:{type:'user',userId:user},message:{type:'text',text:'課表'}}]});
  const headers={'x-line-signature':createHmac('sha256','secret').update(body).digest('base64')};
  assert.equal((await fetch(url,{method:'POST',headers,body})).status,200);
  assert.equal(accepted,1);
  fail=true;
  const failure=await fetch(url,{method:'POST',headers,body});
  assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'SERVICE_UNAVAILABLE'});
  const wrong=JSON.stringify({destination:`U${'b'.repeat(32)}`,events:[]});
  const denied=await fetch(url,{method:'POST',body:wrong,headers:{'x-line-signature':createHmac('sha256','secret').update(wrong).digest('base64')}});
  assert.equal(denied.status,403);
});

test('signed fresh one-to-one follow registers without restoring revocation; stale/group follow denied; unfollow revokes',async()=>{
  const accepted:unknown[][]=[];
  const service=new LineService({accept:async(...args)=>{accepted.push(args);},identity:async()=>({sessionKey:'unused'})},{verifyIdentity:async()=>user});
  const follow=(webhookEventId:string,timestamp:number,type:'user'|'group'='user')=>({type:'follow',webhookEventId,timestamp,source:{type,userId:user}});
  await service.receive([
    follow('fresh',Date.now()),follow('stale',Date.now()-25*60*60*1000),follow('group',Date.now(),'group'),
    {type:'unfollow',webhookEventId:'gone',timestamp:Date.now(),source:{type:'user',userId:user}},
  ]);
  assert.deepEqual(accepted,[['fresh',user,'','follow'],['gone',user,'','revoke']]);
});
test('many unknown LINE users are admitted without any invitation list',async()=>{
  const accepted:string[]=[];
  const service=new LineService({accept:async(_event,userId)=>{accepted.push(userId);},identity:async()=>({sessionKey:'unused'})},{verifyIdentity:async()=>user});
  const ids=['1','2','3'].map(character=>`U${character.repeat(32)}`.replace(/[^U0-9a-f]/g,'0'));
  await service.receive(ids.map((userId,index)=>({type:'message',webhookEventId:`unknown-${index}`,timestamp:Date.now(),source:{type:'user',userId},message:{type:'text',text:'課表'}})));
  assert.deepEqual(accepted,ids);
});
test('repository has no invitation sync surface',()=>{
  assert.equal('syncInvitations' in LineRepository.prototype,false);
});
