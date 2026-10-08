import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import type {AddressInfo} from 'node:net';
import {readFileSync} from 'node:fs';
import {publicRouter} from '../apps/gateway/src/modules/ingress/public.router.js';
import {tunnelConfig} from '../scripts/start-tunnel.mjs';

const credentials={TunnelID:'11111111-2222-3333-4444-555555555555',TunnelSecret:'private-secret',AccountTag:'account'};
const env={PUBLIC_ORIGIN:'https://campus.example',TUNNEL_CRED_CONTENTS:JSON.stringify(credentials),TUNNEL_INGRESS_ORIGIN:'http://public-ingress:3101'};

test('Docker ingress uses a fixed gateway, preserves LIFF cookies and denies private routes',async()=>{
 let called=0;
 const router=publicRouter(env.PUBLIC_ORIGIN,undefined,async(url,init)=>{
  called++;assert.equal(String(url),'http://gateway:3100/liff/identity');
  assert.equal(Buffer.from(init!.body as Uint8Array).toString(),'{ "test": 1 }');
  const headers=new Headers(init?.headers);
  assert.equal(headers.get('origin'),env.PUBLIC_ORIGIN);assert.equal(headers.get('cookie'),'session=test');
  assert.equal(headers.get('x-csrf-token'),'csrf');assert.equal(headers.get('x-campus-service'),null);
  return new Response('{"ok":true}',{headers:{'Set-Cookie':'session=new; HttpOnly; Secure'}});
 },'http://gateway:3100');
 const server=createServer(router);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const port=(server.address() as AddressInfo).port;
  const call=(path:string,host='campus.example')=>new Promise<{status:number;cookies:string[]|undefined;body:string}>((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path,method:'POST',headers:{Host:host,Origin:env.PUBLIC_ORIGIN,Cookie:'session=test','X-CSRF-Token':'csrf','X-Campus-Service':'do-not-forward'}},res=>{
    let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,cookies:res.headers['set-cookie'],body}));
   });req.on('error',reject);req.end('{ "test": 1 }');
  });
  for(const path of ['/internal/v1/agent/prepare','/providers/gemini/x','/health/live','/liff/identity?extra=1'])assert.equal((await call(path)).status,404);
  assert.equal((await call('/liff/identity','attacker.example')).status,421);assert.equal(called,0);
  const res=await call('/liff/identity');assert.equal(res.status,200);
  assert.deepEqual(res.cookies,['session=new; HttpOnly; Secure']);
  assert.equal(res.body,'{"ok":true}');assert.equal(called,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('ingress deployment cannot select arbitrary upstreams or expose raw URL errors',()=>{
 for(const origin of ['http://attacker.example','http://gateway:3100/extra','http://127.0.0.1:3100@attacker.example']){
  assert.throws(()=>publicRouter(env.PUBLIC_ORIGIN,undefined,fetch,origin),{message:'INVALID_PUBLIC_GATEWAY_ORIGIN'});
 }
 assert.throws(()=>publicRouter('secret-not-a-url'),{message:'INVALID_PUBLIC_ORIGIN'});
});

test('Tunnel uses configured hostname and ID, fixed ingress paths and no secrets in YAML',()=>{
 const config=tunnelConfig(env);
 assert.equal(config.id,credentials.TunnelID);
 assert(config.yaml.includes('hostname: "campus.example"'));assert(config.yaml.includes('service: http://public-ingress:3101'));
 assert(config.yaml.includes('path: ^/(liff(/.*)?|line/webhook)$'));assert(config.yaml.endsWith('  - service: http_status:404\n'));
 assert(!config.yaml.includes(credentials.TunnelSecret));assert(!config.yaml.includes(credentials.AccountTag));
 assert(tunnelConfig({...env,TUNNEL_INGRESS_ORIGIN:undefined}).yaml.includes('service: http://127.0.0.1:3101'));
});

test('invalid Tunnel config fails safely before any credential or upstream is used',()=>{
 for(const value of ['', 'private-secret', 'null', '[]', '{}', JSON.stringify({...credentials,TunnelID:'id\nservice: http://gateway:3100'}), JSON.stringify({...credentials,TunnelSecret:42}),JSON.stringify({...credentials,AccountTag:''})]){
  assert.throws(()=>tunnelConfig({...env,TUNNEL_CRED_CONTENTS:value}),{message:'INVALID_TUNNEL_CONFIG'});
 }
 for(const origin of ['', 'private-secret','http://campus.example','https://campus.example/','https://user:private-secret@campus.example','https://campus.example/path','https://campus.example?x=1']){
  assert.throws(()=>tunnelConfig({...env,PUBLIC_ORIGIN:origin}),{message:'INVALID_TUNNEL_CONFIG'});
 }
 for(const upstream of ['http://gateway:3100','http://n8n:5678','https://attacker.example','http://public-ingress:3101\nsecret']){
  assert.throws(()=>tunnelConfig({...env,TUNNEL_INGRESS_ORIGIN:upstream}),{message:'INVALID_TUNNEL_INGRESS_ORIGIN'});
 }
});

test('Compose packages ingress and tunnel without host installs, ports or secrets in build',()=>{
 const compose=readFileSync('docker-compose.yml','utf8'),dockerfile=readFileSync('Dockerfile','utf8');
 const ingress=compose.split('  public-ingress:\n')[1]!.split('  tunnel:\n')[0]!;
 const tunnel=compose.split('  tunnel:\n')[1]!.split('\nnetworks:\n')[0]!;
 assert(ingress.includes('PUBLIC_GATEWAY_ORIGIN: http://gateway:3100'));assert(ingress.includes('PUBLIC_HOST: 0.0.0.0'));
 assert(ingress.includes('gateway: {condition: service_healthy}'));assert(!ingress.includes('ports:'));
 assert(ingress.includes('networks: [public, ingress-gateway]'));assert(!ingress.includes('management'));
 assert(tunnel.includes('public-ingress: {condition: service_healthy}'));assert(tunnel.includes('networks: [public, egress]'));
 assert(tunnel.includes('TUNNEL_CRED_CONTENTS: ${TUNNEL_CRED_CONTENTS:?'));assert(!tunnel.includes('ports:'));assert(!tunnel.includes('management'));
 assert(tunnel.includes("fetch('http://127.0.0.1:20311/ready')"));assert(dockerfile.includes('FROM live AS tunnel'));
 assert.match(dockerfile,/FROM cloudflare\/cloudflared:2026\.6\.1@sha256:[a-f0-9]{64} AS cloudflared/);
 assert(!dockerfile.includes('COPY .env'));
});
