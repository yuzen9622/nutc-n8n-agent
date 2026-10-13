import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import type {AddressInfo} from 'node:net';
import {readFileSync} from 'node:fs';
import {publicRouter} from '../apps/gateway/src/modules/ingress/public.router.js';

const env={PUBLIC_ORIGIN:'https://campus.example'};

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

const compose=readFileSync('docker-compose.yml','utf8');
const dockerfile=readFileSync('Dockerfile','utf8');
const services=compose.split('\nservices:\n')[1]!.split('\nnetworks:\n')[0]!;
const section=(name:string)=>services.split(`  ${name}:\n`)[1]!.split(/\n  [a-z][a-z0-9-]*:\n/)[0]!;

test('Compose has exactly the five requested services and two networks',()=>{
 assert.deepEqual([...services.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map(m=>m[1]).sort(),['cloudflared','gateway','n8n','postgres','school-adapter']);
 assert.equal([...compose.split('\nnetworks:\n')[1]!.split('\nvolumes:\n')[0]!.matchAll(/^  \w+:$/gm)].length,2);
 const n8n=section('n8n');
 assert(n8n.includes('postgres: {condition: service_healthy}'));
 for(const old of ['n8n-init','migrate:','public-ingress','bootstrap-n8n'])assert(!n8n.includes(old));
 assert(n8n.includes('N8N_CONCURRENCY_PRODUCTION_LIMIT: 10'));
});

test('n8n keeps the pinned official image and bootstraps the owner inside the same container',()=>{
 const n8n=section('n8n').replace(/\\\n\s*/g,'');
 assert(n8n.includes('image: "docker.n8n.io/n8nio/n8n:2.41.7@sha256:bcef56dd44014e09774219536a3f8cb07f1b553fcba94044bd9fc0f21f8676a3"'));
 assert(!n8n.includes('build:'));assert(!n8n.includes('command:'));
 assert(n8n.includes('entrypoint: [tini, --, node, /opt/campus/start-n8n.mjs]'));
 assert(n8n.includes('stop_grace_period: 45s'));
 assert(n8n.includes('N8N_OWNER_EMAIL: ${N8N_OWNER_EMAIL:?Required}'));
 assert(n8n.includes('N8N_OWNER_PASSWORD: ${N8N_OWNER_PASSWORD:?Required}'));
 for(const mount of ['setup-n8n','n8n-owner-bootstrap','start-n8n'])assert(n8n.includes(`- ./scripts/${mount}.mjs:/opt/campus/${mount}.mjs:ro`));
 assert(n8n.includes('- ./workflows:/import:ro'));
 assert.match(n8n,/healthcheck:\s+test:\s+- CMD\s+- node\s+- \/opt\/campus\/n8n-owner-bootstrap\.mjs\s+- --healthcheck/);
 const wiring=n8n.split('environment:')[0]!+n8n.split('ports:')[1]!;
 assert(!wiring.includes('N8N_OWNER')&&!wiring.includes('PASSWORD'));
 for(const name of ['postgres','school-adapter','gateway','cloudflared'])assert(!section(name).includes('N8N_OWNER'));
 assert(compose.match(/N8N_OWNER_PASSWORD/g)!.length===2);
 assert(!compose.includes('n8n-init'));
});

test('both backend startup chains migrate before exec and the DB healthcheck uses postgres',()=>{
 assert.match(dockerfile,/CMD \["sh", "-c", "node scripts\/migrate-live-database\.mjs --container && exec node dist\/apps\/gateway\/src\/server\.js"\]/);
 assert.match(section('school-adapter'),/node scripts\/migrate-live-database\.mjs --container &&\s+exec node dist\/apps\/school-adapter\/src\/server\.js/);
 assert(section('school-adapter').includes('postgres: {condition: service_healthy}'));
 assert(section('postgres').includes('-U postgres -d postgres'));
 assert(!dockerfile.includes(' AS n8n-init'));assert(!dockerfile.includes(' AS tunnel'));
});

test('official cloudflared receives only its token, uses gateway public port and has no custom build',()=>{
 const tunnel=section('cloudflared').replace(/\\\n\s*/g,'');
 assert.match(tunnel,/image: "cloudflare\/cloudflared:2026\.6\.1@sha256:[a-f0-9]{64}"/);
 assert.match(tunnel,/tunnel --no-autoupdate --url http:\/\/gateway:3101\s+--metrics 0\.0\.0\.0:20311 run/);
 assert(tunnel.includes('TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?Required}'));
 assert(tunnel.includes('gateway: {condition: service_healthy}'));assert(tunnel.includes('networks: [public]'));
 for(const forbidden of ['build:','ports:','APP_MASTER_KEY','POSTGRES_PASSWORD','node','--token '])assert(!tunnel.includes(forbidden));
 assert(!dockerfile.includes('cloudflared'));assert(!dockerfile.includes('COPY .env'));
});

test('gateway health covers both listeners and credentials retain a single source',()=>{
 const gateway=section('gateway');
 assert(gateway.includes('127.0.0.1:3100/health/live'));assert(gateway.includes('127.0.0.1:3101/liff/'));
 assert(gateway.includes('networks: [backend, public]'));
 assert(gateway.includes('N8N_WEBHOOK_URL: http://n8n:5678/webhook/campus-agent-live'));
 for(const obsolete of ['TUNNEL_CRED_CONTENTS','GEMINI_','${AGENT_DB_PASSWORD','${DB_POSTGRESDB_PASSWORD','${SERVICE_TOKEN','${SCHOOL_SESSION_KEY'])assert(!compose.includes(obsolete));
 assert(compose.includes('APP_MASTER_KEY: ${APP_MASTER_KEY:?Required}'));
});
