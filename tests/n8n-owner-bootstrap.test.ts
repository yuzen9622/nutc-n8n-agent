import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {bootstrapOwner,checkOwnerHealth,ERROR_CODES,OwnerBootstrapError,READY_MARKER,type OwnerFetch} from '../scripts/n8n-owner-bootstrap.mjs';
import {superviseN8n,type SupervisedChild,type SuperviseN8nOptions} from '../scripts/start-n8n.mjs';

const repo=resolve('.');
const SECRET='Sentinel-Password-9911!';
const EMAIL='owner@example.test';
const env={N8N_OWNER_EMAIL:EMAIL,N8N_OWNER_PASSWORD:SECRET};
const settings=(flag:unknown)=>new Response(JSON.stringify({data:{userManagement:{showSetupOnFirstLoad:flag}}}),{status:200});

interface Call{path:string;method:string;body?:string;redirect?:string}
function harness(handler:(call:Call,count:number)=>Response|Promise<Response>){
 const calls:Call[]=[];
 const fetchFn:OwnerFetch=async(url,init)=>{
  const call={path:new URL(url).pathname,method:init.method,body:init.body,redirect:init.redirect};
  calls.push(call);return handler(call,calls.length) as never;
 };
 let clock=0;
 const sleeps:number[]=[];
 const attempt={marker:false,claims:0,clears:0};
 const options={env,fetch:fetchFn,now:()=>clock,sleep:async(ms:number)=>{sleeps.push(ms);clock+=ms;},
  claimAttempt:()=>{attempt.claims++;if(attempt.marker)return false;attempt.marker=true;return true;},
  clearAttempt:()=>{attempt.clears++;attempt.marker=false;}};
 return {calls,options,sleeps,attempt,posts:()=>calls.filter(c=>c.method==='POST')};
}
const message=(error:unknown)=>`${String(error)}\n${(error as Error).stack??''}\n${JSON.stringify(error)}\n${String((error as Error).cause??'')}`;

test('fresh setup waits for readiness, posts the exact owner payload once and verifies readback',async()=>{
 let flag=true,ready=0;
 const h=harness(call=>{
  if(call.path==='/healthz/readiness')return new Response('',{status:++ready<3?503:200});
  if(call.path==='/rest/settings')return settings(flag);
  assert.equal(call.path,'/rest/owner/setup');flag=false;
  return new Response(`{"leak":"${SECRET}"}`,{status:200,headers:{'set-cookie':'n8n-auth=secret'}});
 });
 assert.equal(await bootstrapOwner(h.options),'created');
 assert.equal(h.posts().length,1);
 assert.deepEqual(JSON.parse(h.posts()[0]!.body!),{email:EMAIL,password:SECRET,firstName:'Campus',lastName:'Local'});
 assert.deepEqual(h.sleeps,[500,500]);
 assert(h.calls.every(c=>c.redirect==='error'));
 assert(h.calls.every(c=>!c.path.includes(SECRET)&&!c.path.includes('?')));
});

test('existing owner returns before reading env: no POST and no login even for unusable replacement values',async()=>{
 const h=harness(call=>call.path==='/rest/settings'?settings(false):new Response('',{status:200}));
 assert.equal(await bootstrapOwner({...h.options,env:{N8N_OWNER_EMAIL:'not an email',N8N_OWNER_PASSWORD:'x'}}),'existing');
 assert.equal(await bootstrapOwner({...h.options,env:{}}),'existing');
 assert.deepEqual([...new Set(h.calls.map(c=>c.method))],['GET']);
 assert(h.calls.every(c=>c.path==='/healthz/readiness'||c.path==='/rest/settings'));
});

test('setup requires non-empty env and passes the password through unchanged',async()=>{
 for(const bad of [{},{N8N_OWNER_EMAIL:EMAIL},{N8N_OWNER_PASSWORD:SECRET},{N8N_OWNER_EMAIL:'',N8N_OWNER_PASSWORD:SECRET},{N8N_OWNER_EMAIL:EMAIL,N8N_OWNER_PASSWORD:''}]){
  const h=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
  await assert.rejects(bootstrapOwner({...h.options,env:bad}),{code:'N8N_OWNER_ENV_REQUIRED'});
  assert.equal(h.posts().length,0);
 }
 const odd=' pass "word" \\ \n é&=?# ';
 let flag=true;
 const h=harness(call=>{
  if(call.path==='/rest/owner/setup')flag=false;
  return call.path==='/rest/settings'?settings(flag):new Response('',{status:200});
 });
 await bootstrapOwner({...h.options,env:{N8N_OWNER_EMAIL:EMAIL,N8N_OWNER_PASSWORD:odd}});
 assert.equal(JSON.parse(h.posts()[0]!.body!).password,odd);
 assert(!h.posts()[0]!.path.includes('pass'));
});

test('invalid settings responses fail closed without POST',async()=>{
 const bodies:(()=>Response)[]=[
  ()=>new Response('not json',{status:200}),
  ()=>new Response('{}',{status:200}),
  ()=>new Response('{"data":{"userManagement":{}}}',{status:200}),
  ()=>settings('false'),()=>settings('true'),()=>settings(null),()=>settings(0),
  ()=>new Response(`{"x":"${SECRET}"}`,{status:500}),
 ];
 for(const body of bodies){
  const h=harness(call=>call.path==='/rest/settings'?body():new Response('',{status:200}));
  await assert.rejects(bootstrapOwner(h.options),(e:Error)=>e instanceof OwnerBootstrapError&&e.code==='N8N_OWNER_SETTINGS_INVALID'&&!message(e).includes(SECRET));
  assert.equal(h.posts().length,0);
 }
 const net=harness(call=>{if(call.path==='/rest/settings')throw new Error(SECRET);return new Response('');});
 await assert.rejects(bootstrapOwner(net.options),(e:Error)=>e.message==='N8N_OWNER_SETTINGS_INVALID'&&!message(e).includes(SECRET));
});

test('setup failures stop after one POST and never leak response bodies or exceptions',async()=>{
 const failures:((call:Call)=>Response)[]=[
  ()=>new Response(`{"message":"${SECRET}"}`,{status:400}),
  ()=>new Response(SECRET,{status:500}),
  ()=>{throw new Error(`redirect ${SECRET}`);},
 ];
 for(const post of failures){
  const h=harness(call=>call.path==='/rest/settings'?settings(true):call.path==='/rest/owner/setup'?post(call):new Response('',{status:200}));
  await assert.rejects(bootstrapOwner(h.options),(e:Error)=>e instanceof OwnerBootstrapError&&e.code==='N8N_OWNER_SETUP_FAILED'&&!message(e).includes(SECRET)&&!message(e).includes(EMAIL));
  assert.equal(h.posts().length,1);
 }
});

test('readback that stays true or turns malformed fails closed within the deadline',async()=>{
 const stuck=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
 await assert.rejects(bootstrapOwner(stuck.options),{code:'N8N_OWNER_BOOTSTRAP_TIMEOUT'});
 assert.equal(stuck.posts().length,1);
 assert(stuck.sleeps.length>=500&&stuck.sleeps.length<=700);
 let reads=0;
 const bad=harness(call=>call.path==='/rest/settings'?(++reads===1?settings(true):new Response('oops',{status:200})):new Response('',{status:200}));
 await assert.rejects(bootstrapOwner(bad.options),{code:'N8N_OWNER_SETTINGS_INVALID'});
 assert.equal(bad.posts().length,1);
});

test('readiness never succeeding times out with bounded retries and no POST',async()=>{
 const h=harness(()=>new Response('',{status:503}));
 await assert.rejects(bootstrapOwner(h.options),{code:'N8N_OWNER_BOOTSTRAP_TIMEOUT'});
 assert.equal(h.posts().length,0);
 assert(h.calls.every(c=>c.path==='/healthz/readiness'));
 const refused=harness(()=>{throw new Error('ECONNREFUSED');});
 await assert.rejects(bootstrapOwner(refused.options),{code:'N8N_OWNER_BOOTSTRAP_TIMEOUT'});
});

test('AbortSignal interrupts pending fetch and sleep without leaking unhandled rejections',async()=>{
 const unhandled:unknown[]=[];
 const onUnhandled=(reason:unknown)=>unhandled.push(reason);
 process.on('unhandledRejection',onUnhandled);
 try{
  const pendingFetch=new AbortController();
  const hang=bootstrapOwner({env,fetch:()=>new Promise<never>(()=>{}),signal:pendingFetch.signal});
  setTimeout(()=>pendingFetch.abort(),10);
  await assert.rejects(hang,{code:'N8N_OWNER_BOOTSTRAP_ABORTED'});
  const pendingSleep=new AbortController();
  const slow=bootstrapOwner({env,fetch:async()=>new Response('',{status:503}) as never,signal:pendingSleep.signal});
  setTimeout(()=>pendingSleep.abort(),10);
  await assert.rejects(slow,{code:'N8N_OWNER_BOOTSTRAP_ABORTED'});
  const already=new AbortController();already.abort();
  const h=harness(()=>settings(true));
  await assert.rejects(bootstrapOwner({...h.options,signal:already.signal}),{code:'N8N_OWNER_BOOTSTRAP_ABORTED'});
  assert.equal(h.calls.length,0);
  await new Promise(r=>setImmediate(r));
 }finally{process.off('unhandledRejection',onUnhandled);}
 assert.deepEqual(unhandled,[]);
});

test('error codes are allowlisted and unknown failures are generic',async()=>{
 assert.equal(ERROR_CODES.length,7);
 const h=harness(()=>settings(false));
 await assert.rejects(bootstrapOwner({...h.options,sleep:async()=>{throw new Error(SECRET);},fetch:async()=>{throw new Error(SECRET);}}) ,(e:Error)=>!message(e).includes(SECRET));
});

test('health requires marker, readiness and a strictly false setup flag; no secrets or POST',async()=>{
 const ok=(flag:unknown,ready=200)=>harness(call=>call.path==='/healthz/readiness'?new Response('',{status:ready}):settings(flag));
 const good=ok(false);
 assert.equal(await checkOwnerHealth({fetch:good.options.fetch,readMarker:()=>'ready'}),true);
 assert.deepEqual(good.calls.map(c=>c.method),['GET','GET']);
 const missing=ok(false);
 assert.equal(await checkOwnerHealth({fetch:missing.options.fetch,readMarker:()=>{throw new Error('ENOENT');}}),false);
 assert.equal(missing.calls.length,0);
 assert.equal(await checkOwnerHealth({fetch:ok(false).options.fetch,readMarker:()=>'stale'}),false);
 assert.equal(await checkOwnerHealth({fetch:ok(true).options.fetch,readMarker:()=>'ready'}),false);
 assert.equal(await checkOwnerHealth({fetch:ok('false').options.fetch,readMarker:()=>'ready'}),false);
 assert.equal(await checkOwnerHealth({fetch:ok(false,503).options.fetch,readMarker:()=>'ready'}),false);
 assert.equal(await checkOwnerHealth({fetch:async()=>{throw new Error('down');},readMarker:()=>'ready'}),false);
 assert.equal(READY_MARKER,'/tmp/campus-n8n-owner-ready');
});

test('health CLI prints nothing, exits 1 without marker and rejects other arguments',()=>new Promise<void>((done,fail)=>{
 const script=resolve('scripts/n8n-owner-bootstrap.mjs');
 let output='';
 const p=spawn(process.execPath,[script,'--healthcheck'],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH??''}});
 p.stdout.on('data',d=>{output+=d;});p.stderr.on('data',d=>{output+=d;});
 p.on('close',code=>{
  try{assert.equal(code,1);assert.equal(output,'');}catch(e){return fail(e);}
  const other=spawn(process.execPath,[script,'--other'],{stdio:'ignore'});
  other.on('close',c=>{try{assert.equal(c,1);done();}catch(e){fail(e);}});
 });
}));

test('owner setup attempt marker: claimed before the POST, cleared after readback, absent on success',async()=>{
 let flag=true;
 const h=harness(call=>{
  if(call.path==='/rest/owner/setup'){assert.equal(h.attempt.marker,true);flag=false;}
  return call.path==='/rest/settings'?settings(flag):new Response('',{status:200});
 });
 assert.equal(await bootstrapOwner(h.options),'created');
 assert.deepEqual([h.attempt.claims,h.attempt.clears,h.attempt.marker],[1,1,false]);
});

test('restart with the flag still true and a surviving marker never POSTs again',async()=>{
 const h=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
 h.attempt.marker=true;
 await assert.rejects(bootstrapOwner(h.options),{code:'N8N_OWNER_SETUP_REVIEW_REQUIRED'});
 assert.equal(h.posts().length,0);assert.equal(h.attempt.marker,true);
 assert(ERROR_CODES.includes('N8N_OWNER_SETUP_REVIEW_REQUIRED'));
});

test('POST whose response is lost: the next bootstrap sees flag false, clears the marker and sends 0 POSTs',async()=>{
 let flag=true;
 const first=harness(call=>{
  if(call.path==='/rest/owner/setup'){flag=false;throw new Error(SECRET);}// side effect happened, response lost
  return call.path==='/rest/settings'?settings(flag):new Response('',{status:200});
 });
 await assert.rejects(bootstrapOwner(first.options),{code:'N8N_OWNER_SETUP_FAILED'});
 assert.equal(first.posts().length,1);assert.equal(first.attempt.marker,true);
 const second=harness(call=>call.path==='/rest/settings'?settings(flag):new Response('',{status:200}));
 second.attempt.marker=first.attempt.marker;
 assert.equal(await bootstrapOwner(second.options),'existing');
 assert.equal(second.posts().length,0);assert.equal(second.attempt.marker,false);
});

test('failed POSTs keep the marker so a second bootstrap cannot send a second POST',async()=>{
 const failures:(()=>Response|Promise<Response>)[]=[
  ()=>new Response('x',{status:400}),
  ()=>new Response('x',{status:500}),
  ()=>{throw new Error(SECRET);},
 ];
 for(const fail of failures){
  const h=harness(call=>call.path==='/rest/owner/setup'?fail():call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
  await assert.rejects(bootstrapOwner(h.options),{code:'N8N_OWNER_SETUP_FAILED'});
  assert.equal(h.attempt.marker,true);
  await assert.rejects(bootstrapOwner(h.options),{code:'N8N_OWNER_SETUP_REVIEW_REQUIRED'});
  assert.equal(h.posts().length,1);
 }
 // Readback stuck at true: deadline, marker retained.
 const stuck=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
 await assert.rejects(bootstrapOwner(stuck.options),{code:'N8N_OWNER_BOOTSTRAP_TIMEOUT'});
 assert.equal(stuck.attempt.marker,true);
});

test('abort while the claimed POST is pending keeps the marker; the next bootstrap sends 0 POSTs and requires review',async()=>{
 const abort=new AbortController();
 const h=harness(call=>{
  if(call.path==='/rest/owner/setup'){setTimeout(()=>abort.abort(),5);return new Promise<Response>(()=>{});}
  return call.path==='/rest/settings'?settings(true):new Response('',{status:200});
 });
 await assert.rejects(bootstrapOwner({...h.options,signal:abort.signal}),{code:'N8N_OWNER_BOOTSTRAP_ABORTED'});
 assert.equal(h.posts().length,1);assert.equal(h.attempt.marker,true);assert.equal(h.attempt.clears,0);
 await assert.rejects(bootstrapOwner(h.options),{code:'N8N_OWNER_SETUP_REVIEW_REQUIRED'});
 assert.equal(h.posts().length,1);assert.equal(h.attempt.marker,true);
});

test('missing env never claims a marker; claim/clear unknown errors map to a safe code',async()=>{
 const h=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
 await assert.rejects(bootstrapOwner({...h.options,env:{}}),{code:'N8N_OWNER_ENV_REQUIRED'});
 assert.equal(h.attempt.claims,0);
 const claimErr=harness(call=>call.path==='/rest/settings'?settings(true):new Response('',{status:200}));
 try{await bootstrapOwner({...claimErr.options,claimAttempt:()=>{throw new Error(SECRET);}});assert.fail('no throw');}
 catch(error){assert.equal((error as OwnerBootstrapError).code,'N8N_OWNER_BOOTSTRAP_FAILED');assert.equal(message(error).includes(SECRET),false);}
 assert.equal(claimErr.posts().length,0);
 for(const flag of [false,true]){
  let f=true;
  const c=harness(call=>{if(call.path==='/rest/owner/setup')f=false;return call.path==='/rest/settings'?settings(flag?f:false):new Response('',{status:200});});
  try{await bootstrapOwner({...c.options,clearAttempt:()=>{throw new Error(SECRET);}});assert.fail('no throw');}
  catch(error){assert.equal((error as OwnerBootstrapError).code,'N8N_OWNER_BOOTSTRAP_FAILED');assert.equal(message(error).includes(SECRET),false);}
 }
});

test('marker file is atomic wx, non-secret and cleared on the real default path',async()=>{
 const src=readFileSync(join(repo,'scripts/n8n-owner-bootstrap.mjs'),'utf8');
 assert(/flag: 'wx'/.test(src));
 assert(/ATTEMPT_MARKER = '\/home\/node\/\.n8n\//.test(src));
 assert(!/writeFileSync\(ATTEMPT_MARKER, [^)]*(email|password)/i.test(src));
});

// ---- supervisor with fakes ----
class FakeChild extends EventEmitter implements SupervisedChild{
 pid=4242;kills:string[]=[];
 kill(signal?:string){this.kills.push(signal??'SIGTERM');}
}
function supervised(overrides:Partial<SuperviseN8nOptions>={}){
 const child=new FakeChild(),proc=new EventEmitter(),events:string[]=[],logs:string[]=[],signals:string[]=[];
 const spawns:{command:string;args:string[];env:Record<string,string|undefined>;detached:boolean;stdio:string[]}[]=[];
 let marker=true;
 const options:SuperviseN8nOptions={
  env:{PATH:'/bin',N8N_OWNER_EMAIL:EMAIL,N8N_OWNER_PASSWORD:SECRET,N8N_OWNER_OTHER:'x',DB_TYPE:'postgresdb'},
  spawnFn:(command,args,o)=>{spawns.push({command,args,...o});events.push('spawn');return child;},
  bootstrap:async()=>'existing',
  groupAlive:()=>false,
  writeMarker:()=>{marker=true;events.push('write');},
  removeMarker:()=>{marker=false;events.push('remove');},
  killGroup:(_c,s)=>{signals.push(s);},
  processRef:proc as never,
  killGraceMs:30,
  log:m=>logs.push(m),
  ...overrides,
 };
 return {child,proc,events,logs,signals,spawns,options,marker:()=>marker,run:()=>superviseN8n(options)};
}
const tick=()=>new Promise(r=>setTimeout(r,5));

test('supervisor removes stale marker before spawn and spawns the official entrypoint without shell or owner env',async()=>{
 const s=supervised();const done=s.run();await tick();
 assert.deepEqual(s.events.slice(0,2),['remove','spawn']);
 assert.equal(s.spawns[0]!.command,'/docker-entrypoint.sh');assert.deepEqual(s.spawns[0]!.args,[]);
 assert.equal(s.spawns[0]!.detached,true);assert.deepEqual(s.spawns[0]!.stdio,['ignore','inherit','inherit']);
 assert.equal(s.spawns[0]!.env.DB_TYPE,'postgresdb');
 assert.deepEqual(Object.keys(s.spawns[0]!.env).filter(k=>k.startsWith('N8N_OWNER_')),[]);
 assert.equal(JSON.stringify(s.spawns[0]).includes(SECRET),false);
 assert.equal(s.marker(),true);// bootstrap resolved: marker written
 s.child.emit('close',0,null);
 assert.equal(await done,0);assert.equal(s.marker(),false);assert.deepEqual(s.logs,[]);
});

test('marker is written only after bootstrap succeeds',async()=>{
 let release:()=>void=()=>{};
 const s=supervised({bootstrap:()=>new Promise(r=>{release=()=>r('created');})});
 const done=s.run();await tick();
 assert.equal(s.events.includes('write'),false);
 release();await tick();
 assert.equal(s.events.at(-1),'write');
 s.child.emit('close',3,null);
 assert.equal(await done,3);
});

test('bootstrap failure logs only a safe code, terminates the child group and exits non-zero',async()=>{
 const s=supervised({bootstrap:async()=>{throw Object.assign(new Error(SECRET),{code:'N8N_OWNER_SETUP_FAILED'});}});
 const done=s.run();await tick();
 assert.deepEqual(s.signals,['SIGTERM']);assert.equal(s.events.includes('write'),false);
 s.child.emit('close',0,'SIGTERM');
 assert.equal(await done,1);
 assert.deepEqual(s.logs,['N8N_OWNER_BOOTSTRAP_FAILED: n8n startup stopped.']);
 assert.equal(s.logs.join().includes(SECRET),false);
});

test('allowlisted bootstrap code is preserved in the log line',async()=>{
 const s=supervised({bootstrap:async()=>{throw new OwnerBootstrapError('N8N_OWNER_SETUP_FAILED');}});
 const done=s.run();await tick();s.child.emit('close',null,'SIGTERM');
 assert.equal(await done,1);assert.deepEqual(s.logs,['N8N_OWNER_SETUP_FAILED: n8n startup stopped.']);
});

test('marker write failure and marker cleanup failure fail closed',async()=>{
 const w=supervised({writeMarker:()=>{throw new Error(SECRET);}});
 const wd=w.run();await tick();assert.deepEqual(w.signals,['SIGTERM']);w.child.emit('close',0,'SIGTERM');
 assert.equal(await wd,1);assert.equal(w.logs.join().includes(SECRET),false);
 const r=supervised({removeMarker:()=>{throw new Error('EACCES');}});
 assert.equal(await r.run(),1);assert.equal(r.spawns.length,0);
});

test('spawn throw, spawn error event, and early child exit are startup failures',async()=>{
 const thrown=supervised({spawnFn:()=>{throw new Error(SECRET);}});
 assert.equal(await thrown.run(),1);assert.equal(thrown.logs.join().includes(SECRET),false);
 const s=supervised();s.child.pid=undefined as never;
 s.options.bootstrap=()=>new Promise(()=>{});
 const done=s.run();await tick();s.child.emit('error',new Error(SECRET));
 assert.equal(await done,1);assert.equal(s.logs.join().includes(SECRET),false);
 for(const code of [0,5]){
  const early=supervised({bootstrap:()=>new Promise(()=>{})});
  const d=early.run();await tick();early.child.emit('close',code,null);
  assert.equal(await d,1);assert.equal(early.marker(),false);
 }
});

test('signal during spawn return: handlers already exist, signal is forwarded to the real child, no bootstrap or marker',async()=>{
 for(const name of ['SIGTERM','SIGINT'] as const){
  let bootstraps=0,atSpawn=-1;
  const child=new FakeChild();
  const s=supervised({bootstrap:async()=>{bootstraps++;return 'created';},killGraceMs:500});
  s.options.spawnFn=()=>{
   atSpawn=s.proc.listenerCount(name);
   s.proc.emit(name);// the window between spawn and handler registration in the old order
   assert.deepEqual(s.signals,[]);// no child yet: nothing to forward
   return child;
  };
  const d=s.run();await tick();
  assert.equal(atSpawn,1);
  assert.deepEqual(s.signals,[name]);
  assert.equal(bootstraps,0);assert.equal(s.events.includes('write'),false);assert.equal(s.marker(),false);
  child.emit('close',null,name);
  assert.equal(await d,0);
  assert.deepEqual(s.logs,[]);assert.equal(s.events.includes('write'),false);
  assert.equal(s.proc.listenerCount('SIGTERM')+s.proc.listenerCount('SIGINT'),0);
 }
 // The forwarded signal keeps the original grace: a child that ignores it is SIGKILLed.
 const stuck=supervised({killGraceMs:20,groupAlive:()=>true,reapMs:20});
 stuck.options.spawnFn=()=>{stuck.proc.emit('SIGTERM');return stuck.child;};
 assert.equal(await stuck.run(),1);
 assert.deepEqual(stuck.signals,['SIGTERM','SIGKILL']);
 assert.equal(stuck.proc.listenerCount('SIGTERM')+stuck.proc.listenerCount('SIGINT'),0);
});

test('spawn throw clears registered listeners and timers, even after a pending signal',async()=>{
 const plain=supervised({spawnFn:()=>{throw new Error(SECRET);}});
 assert.equal(await plain.run(),1);
 assert.equal(plain.proc.listenerCount('SIGTERM')+plain.proc.listenerCount('SIGINT'),0);
 assert.deepEqual(plain.signals,[]);
 const signalled=supervised();
 signalled.options.spawnFn=()=>{signalled.proc.emit('SIGINT');throw new Error(SECRET);};
 assert.equal(await signalled.run(),1);
 assert.equal(signalled.proc.listenerCount('SIGTERM')+signalled.proc.listenerCount('SIGINT'),0);
 assert.deepEqual(signalled.signals,[]);assert.equal(signalled.marker(),false);
 assert.equal(signalled.logs.join().includes(SECRET),false);
 const marker=supervised({removeMarker:()=>{throw new Error('EACCES');}});
 assert.equal(await marker.run(),1);
 assert.equal(marker.proc.listenerCount('SIGTERM')+marker.proc.listenerCount('SIGINT'),0);
});

test('natural exit then signal never schedules more than one group poll and leaves no timer behind',async()=>{
 let alive=true,probes=0;
 const s=supervised({groupAlive:()=>{probes++;return alive;},pollMs:5,killGraceMs:60,reapMs:200});
 const killed:string[]=[];
 s.options.killGroup=(_c,sig)=>{killed.push(sig);if(sig==='SIGKILL')alive=false;};
 const d=s.run();await tick();
 s.child.emit('close',7,null);// natural exit, group lingers
 s.proc.emit('SIGTERM');s.proc.emit('SIGINT');s.child.emit('close',7,null);
 const before=probes;await new Promise(r=>setTimeout(r,22));
 assert(probes-before<=6,`polls ${probes-before}`);// one 5ms poller, not several
 assert.equal(await d,1);
 assert.equal(killed.filter(k=>k==='SIGKILL').length,1);
 const after=probes;await new Promise(r=>setTimeout(r,40));
 assert.equal(probes,after);// finish cleared every timer
});

test('child exit after ready removes the marker and propagates status',async()=>{
 for(const code of [0,9]){
  const s=supervised();const d=s.run();await tick();assert.equal(s.marker(),true);
  s.child.emit('close',code,null);assert.equal(await d,code);assert.equal(s.marker(),false);
 }
 const sig=supervised();const d=sig.run();await tick();sig.child.emit('close',null,'SIGKILL');
 assert.equal(await d,1);
});

test('SIGTERM and SIGINT in readiness, POST and ready phases are forwarded and abort bootstrap',async()=>{
 for(const name of ['SIGTERM','SIGINT'] as const){
  for(const phase of ['readiness','post','ready'] as const){
   let aborted=false;
   const s=supervised({bootstrap:({signal})=>phase==='ready'?Promise.resolve('created' as const):new Promise((_,reject)=>{signal!.addEventListener('abort',()=>{aborted=true;reject(new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_ABORTED'));});})});
   const d=s.run();await tick();
   assert.equal(s.proc.listenerCount('SIGTERM'),1);
   s.proc.emit(name);
   assert.deepEqual(s.signals,[name],`${name}/${phase}`);assert.equal(s.marker(),false);
   if(phase!=='ready')assert.equal(aborted,true);
   s.proc.emit(name);assert.deepEqual(s.signals,[name]);// idempotent
   await tick();assert.equal(s.marker(),false);assert.deepEqual(s.logs,[]);
   s.child.emit('close',null,name);
   assert.equal(await d,0);assert.equal(s.marker(),false);
   assert.equal(s.proc.listenerCount('SIGTERM')+s.proc.listenerCount('SIGINT'),0);
  }
 }
});

test('signal racing bootstrap resolution can never recreate the marker',async()=>{
 let resolveBootstrap:(v:'created')=>void=()=>{};
 const s=supervised({bootstrap:()=>new Promise(r=>{resolveBootstrap=r;})});
 const d=s.run();await tick();
 s.proc.emit('SIGTERM');resolveBootstrap('created');await tick();
 assert.equal(s.events.includes('write'),false);assert.equal(s.marker(),false);
 s.child.emit('close',0,null);assert.equal(await d,0);
});

test('direct child exits on TERM but the group stays alive: no early resolve, SIGKILL at the original deadline',async()=>{
 let alive=true;
 const s=supervised({groupAlive:()=>alive,pollMs:5,reapMs:200});
 const killed:string[]=[];
 s.options.killGroup=(_c,sig)=>{killed.push(sig);if(sig==='SIGKILL')alive=false;};
 const start=Date.now();let resolved=false;
 const d=s.run().then(c=>{resolved=true;return c;});await tick();
 s.proc.emit('SIGTERM');s.child.emit('close',0,null);
 await new Promise(r=>setTimeout(r,15));
 assert.equal(resolved,false);assert.deepEqual(killed,['SIGTERM']);
 assert.equal(await d,1);assert(Date.now()-start>=25);
 assert.deepEqual(killed,['SIGTERM','SIGKILL']);assert.equal(s.marker(),false);
 assert.equal(s.proc.listenerCount('SIGTERM'),0);
});

test('group that disappears before the grace deadline resolves without SIGKILL; later events are idempotent',async()=>{
 let alive=true;
 const s=supervised({groupAlive:()=>alive,pollMs:5,killGraceMs:500});
 const d=s.run();await tick();s.proc.emit('SIGTERM');s.child.emit('close',null,'SIGTERM');
 await tick();alive=false;
 assert.equal(await d,0);assert.deepEqual(s.signals,['SIGTERM']);
 s.proc.emit('SIGTERM');s.child.emit('close',0,null);await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(s.signals,['SIGTERM']);
});

test('natural child exit with a lingering group terminates it before resolving with the child status',async()=>{
 let alive=true;
 const s=supervised({groupAlive:()=>alive,pollMs:5,killGraceMs:500});
 s.options.killGroup=(_c,sig)=>{s.signals.push(sig);alive=false;};
 const d=s.run();await tick();s.child.emit('close',7,null);
 assert.equal(await d,7);assert.deepEqual(s.signals,['SIGTERM']);assert.equal(s.marker(),false);
});

test('a child that ignores SIGTERM is SIGKILLed after the grace period and exit is non-zero',async()=>{
 const s=supervised();const d=s.run();await tick();
 s.proc.emit('SIGTERM');assert.deepEqual(s.signals,['SIGTERM']);
 await new Promise(r=>setTimeout(r,60));assert.deepEqual(s.signals,['SIGTERM','SIGKILL']);
 s.child.emit('close',null,'SIGKILL');
 assert.equal(await d,1);assert.equal(s.marker(),false);
});

// ---- real subprocess lifecycle ----
interface Fixture{dir:string;parent:string}
function fixture(childBody:string):Fixture{
 const dir=mkdtempSync(join(tmpdir(),'owner-supervisor-'));
 writeFileSync(join(dir,'child.mjs'),childBody);
 writeFileSync(join(dir,'parent.mjs'),`
import {spawn} from 'node:child_process';
import {superviseN8n} from ${JSON.stringify(`file://${repo}/scripts/start-n8n.mjs`)};
const dir=${JSON.stringify(dir)};
const code=await superviseN8n({
 env:{PATH:process.env.PATH},
 markerPath:dir+'/marker',
 bootstrap:async()=>{await new Promise(r=>setTimeout(r,200));return 'existing';},
 spawnFn:(_c,_a,o)=>spawn(process.execPath,[dir+'/child.mjs',dir],o),
 killGraceMs:Number(process.env.GRACE??'5000'),
});
process.exit(code);
`);
 return {dir,parent:join(dir,'parent.mjs')};
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const waitFor=async(cond:()=>boolean,ms=10000)=>{const end=Date.now()+ms;while(!cond()){if(Date.now()>end)throw new Error('timeout waiting');await new Promise(r=>setTimeout(r,25));}};
function runParent(f:Fixture,env:Record<string,string>={}){
 const p=spawn(process.execPath,[f.parent],{stdio:'ignore',env:{PATH:process.env.PATH??'',...env}});
 const exit=new Promise<{code:number|null}>(r=>p.on('close',code=>r({code})));
 return {p,exit};
}
const gracefulChild=`
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const dir=process.argv[2];
const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(dir+'/pids',JSON.stringify({child:process.pid,grand:grand.pid}));
for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{writeFileSync(dir+'/signal',s);process.exit(0);});
setInterval(()=>{},1000);
`;

test('real subprocess: TERM and INT reach the child group, marker is cleared, exit is 0 and nothing is orphaned',async()=>{
 for(const name of ['SIGTERM','SIGINT'] as const){
  const f=fixture(gracefulChild);
  try{
   const {p,exit}=runParent(f);
   await waitFor(()=>existsSync(join(f.dir,'marker'))&&existsSync(join(f.dir,'pids')));// child start can lag the 200ms bootstrap under load
   assert.equal(readFileSync(join(f.dir,'marker'),'utf8'),'ready');
   const pids=JSON.parse(readFileSync(join(f.dir,'pids'),'utf8'));
   p.kill(name);
   assert.equal((await exit).code,0);
   assert.equal(readFileSync(join(f.dir,'signal'),'utf8'),name);
   assert.equal(existsSync(join(f.dir,'marker')),false);
   await waitFor(()=>!alive(pids.child)&&!alive(pids.grand));
  }finally{rmSync(f.dir,{recursive:true,force:true});}
 }
});

test('real subprocess: child exit status propagates and a stuck child is SIGKILLed after grace',async()=>{
 const exits=fixture(`process.exit(Number(process.env.CODE??3));`);
 try{assert.equal((await runParent(exits,{CODE:'3'}).exit).code,1);}// exits before bootstrap completes
 finally{rmSync(exits.dir,{recursive:true,force:true});}
 const late=fixture(`import {writeFileSync} from 'node:fs';
setTimeout(()=>process.exit(7),600);writeFileSync(process.argv[2]+'/pids',JSON.stringify({child:process.pid}));`);
 try{assert.equal((await runParent(late).exit).code,7);assert.equal(existsSync(join(late.dir,'marker')),false);}
 finally{rmSync(late.dir,{recursive:true,force:true});}
 const stuck=fixture(`import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>{});writeFileSync(process.argv[2]+'/pids',JSON.stringify({child:process.pid}));setInterval(()=>{},1000);`);
 try{
  const {p,exit}=runParent(stuck,{GRACE:'300'});
  await waitFor(()=>existsSync(join(stuck.dir,'marker')));
  const pid=JSON.parse(readFileSync(join(stuck.dir,'pids'),'utf8')).child;
  p.kill('SIGTERM');
  assert.equal((await exit).code,1);
  await waitFor(()=>!alive(pid));
 }finally{rmSync(stuck.dir,{recursive:true,force:true});}
});

test('real subprocess: descendant ignoring SIGTERM outlives the direct child; supervisor waits out the grace, kills the group, leaves no orphan',async()=>{
 const f=fixture(`
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const dir=process.argv[2];
const grand=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1]+'/grand-ready','1');setInterval(()=>{},1000)",dir],{stdio:'ignore'});
writeFileSync(dir+'/pids',JSON.stringify({child:process.pid,grand:grand.pid}));
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`);
 try{
  const {p,exit}=runParent(f,{GRACE:'900'});
  await waitFor(()=>existsSync(join(f.dir,'marker'))&&existsSync(join(f.dir,'grand-ready')));
  const pids=JSON.parse(readFileSync(join(f.dir,'pids'),'utf8'));
  const start=Date.now();
  p.kill('SIGTERM');
  await waitFor(()=>!alive(pids.child));
  assert.equal(alive(pids.grand),true);// direct child gone, descendant still running
  await new Promise(r=>setTimeout(r,300));
  assert.equal(alive(pids.grand),true);// supervisor has not resolved early
  assert.equal(alive(p.pid!),true);
  const {code}=await exit;
  assert(Date.now()-start>=800,'resolved before the grace deadline');
  assert.equal(code,1);
  assert.equal(alive(pids.grand),false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('real subprocess: natural child exit cleans up a leftover descendant before the supervisor exits',async()=>{
 const f=fixture(`
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const dir=process.argv[2];
const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(dir+'/pids',JSON.stringify({child:process.pid,grand:grand.pid}));
setTimeout(()=>process.exit(7),600);
`);
 try{
  const {exit}=runParent(f,{GRACE:'3000'});
  await waitFor(()=>existsSync(join(f.dir,'pids')));
  const pids=JSON.parse(readFileSync(join(f.dir,'pids'),'utf8'));
  assert.equal((await exit).code,7);
  assert.equal(alive(pids.grand),false);
  assert.equal(existsSync(join(f.dir,'marker')),false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
