import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {startGateway,stopGateway,type GatewayRuntime} from '../apps/gateway/src/server-lifecycle.js';
import {publicRouter} from '../apps/gateway/src/modules/ingress/public.router.js';

const freePort=async()=>{const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as AddressInfo).port;await new Promise<void>(r=>s.close(()=>r()));return p;};
const get=(port:number,path='/',host='127.0.0.1')=>new Promise<number>((resolve,reject)=>{const r=request({host:'127.0.0.1',port,path,headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});r.on('error',reject);r.end();});
function build(internal:Server,pub:Server|undefined,ports:{i:number;p:number},log:string[]):GatewayRuntime{
  return {internal:{server:internal,port:ports.i,host:'127.0.0.1'},public:pub?{server:pub,port:ports.p,host:'127.0.0.1'}:undefined,
    startWorker:()=>log.push('worker:start'),stopWorker:async()=>{log.push('worker:stop');},endPool:async()=>{log.push('pool:end');}};
}

test('both listeners ready before worker starts, public never exposes internal routes, shutdown closes everything',async()=>{
  const ports={i:await freePort(),p:await freePort()};const log:string[]=[];
  const internal=createServer((req,res)=>{res.end(req.url==='/internal/v1/agent/prepare'?'private':'ok');});
  const pub=createServer(publicRouter('https://nutc-agent.example',undefined,fetch,'http://127.0.0.1:3100'));
  const rt=build(internal,pub,ports,log);
  await startGateway(rt);
  assert.deepEqual(log,['worker:start']);
  assert.equal(await get(ports.i,'/internal/v1/agent/prepare'),200);
  assert.equal(await get(ports.p,'/internal/v1/agent/prepare','nutc-agent.example'),404);
  assert.equal(await get(ports.p,'/liff/','attacker.example'),421);
  await stopGateway(rt);
  assert.deepEqual(log,['worker:start','worker:stop','pool:end']);
  assert.equal(internal.listening,false);assert.equal(pub.listening,false);
  await assert.rejects(get(ports.i));await assert.rejects(get(ports.p));
});

test('occupied second port closes first listener, does not start worker and releases pool',async()=>{
  const ports={i:await freePort(),p:await freePort()};const log:string[]=[];
  const blocker=createServer();await new Promise<void>(r=>blocker.listen(ports.p,'127.0.0.1',r));
  const internal=createServer((_q,res)=>res.end('ok')),pub=createServer((_q,res)=>res.end('p'));
  try{
    await assert.rejects(startGateway(build(internal,pub,ports,log)),(e:NodeJS.ErrnoException)=>e.code==='EADDRINUSE');
    assert.deepEqual(log,['pool:end']);
    assert.equal(internal.listening,false);assert.equal(pub.listening,false);
    await assert.rejects(get(ports.i));
  }finally{await new Promise<void>(r=>blocker.close(()=>r()));}
});

test('public drains pending request before worker stop; stuck public is force-closed after drain limit',async()=>{
  const ports={i:await freePort(),p:await freePort()};const log:string[]=[];
  const pub=createServer(()=>{});
  const internal=createServer((_q,res)=>res.end('ok'));
  const rt=build(internal,pub,ports,log);rt.publicDrainMs=100;
  await startGateway(rt);
  const pending=get(ports.p).catch(()=>0);
  await new Promise(r=>setTimeout(r,50));
  await stopGateway(rt);
  assert.equal(await pending,0);
  assert.ok(log.indexOf('worker:stop')>log.indexOf('worker:start'));
  assert.equal(pub.listening,false);assert.equal(internal.listening,false);
});

test('internal-only runtime works without a public listener',async()=>{
  const ports={i:await freePort(),p:0};const log:string[]=[];
  const internal=createServer((_q,res)=>res.end('ok'));const rt=build(internal,undefined,ports,log);
  await startGateway(rt);assert.equal(await get(ports.i),200);await stopGateway(rt);
  assert.deepEqual(log,['worker:start','worker:stop','pool:end']);
});
