import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bootstrapN8n,bootstrapPlan} from '../scripts/bootstrap-n8n.mjs';

const env={N8N_ENCRYPTION_KEY:'e'.repeat(32),AGENT_DB_PASSWORD:'db-password',SERVICE_TOKEN:'s'.repeat(32),N8N_WEBHOOK_TOKEN:'w'.repeat(32),GEMINI_PROXY_TOKEN:'g'.repeat(32)};
const workflows=()=>['campusNativeAgentLive','campusKnowledgeIngest'].map(id=>JSON.parse(readFileSync(`workflows/agent/${id}.json`,'utf8')));

// This double covers orchestration only; actual PostgreSQL + CLI is tested separately.
function harness({existing=false,marker=false,status='complete',locked=true,failAt=0}={}){
  const queries:string[]=[],commands:{args:string[],input?:string}[]=[],messages:string[]=[];
  const client={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};
    if(sql.includes('to_regclass'))return {rows:[{marker:marker?'campus_bootstrap.state':null}]};
    if(sql.startsWith('SELECT status'))return {rows:status?[{status}]:[]};
    if(sql.includes(' AS existing'))return {rows:[{existing}]};
    return {rows:[]};
  }};
  const options={client,env,loadWorkflows:workflows,log:(s:string)=>messages.push(s),runCli:async(command:{args:string[],input?:string})=>{
    commands.push(command);if(commands.length===failAt)throw new Error(`upstream leaked ${env.SERVICE_TOKEN}`);
  }};
  return {queries,commands,messages,options};
}

test('bootstrap uses official stdin imports, fixed credentials and only publishes the main workflow',()=>{
  const commands=bootstrapPlan(env,workflows());
  assert.deepEqual(commands.map(c=>c.args),[
    ['import:credentials','--input=/dev/stdin'],['import:workflow','--input=/dev/stdin'],['publish:workflow','--id=campusNativeAgentLive'],
  ]);
  const credentials=JSON.parse(commands[0]!.input!);
  assert.deepEqual(credentials.map((c:{id:string})=>c.id),['campus-agent-postgres','campus-live-service','campus-live-webhook','campus-live-gemini-proxy']);
  assert.deepEqual(credentials[0].data,{host:'postgres',port:5432,database:'campus_agent',user:'campus_agent',password:env.AGENT_DB_PASSWORD,ssl:'disable'});
  assert.deepEqual(credentials[3].data,{apiKey:env.GEMINI_PROXY_TOKEN,host:'http://gateway:3100/providers/gemini'});
  assert.deepEqual(JSON.parse(commands[1]!.input!),workflows());
  for(const secret of Object.values(env))assert(!commands.flatMap(c=>c.args).join(' ').includes(secret));
});

test('missing secrets and mismatched artifacts refuse initialization',()=>{
  for(const key of Object.keys(env))assert.throws(()=>bootstrapPlan({...env,[key]:''},workflows()),/BOOTSTRAP_REQUIRED_/);
  assert.throws(()=>bootstrapPlan(env,[]),/INVALID_WORKFLOWS/);
  const bad=workflows();bad[0].active=true;assert.throws(()=>bootstrapPlan(env,bad),/INVALID_WORKFLOWS/);
  const unknown=workflows();unknown[0].nodes[0].credentials={httpHeaderAuth:{id:'unknown'}};
  assert.throws(()=>bootstrapPlan(env,unknown),/UNKNOWN_CREDENTIAL/);
  const alias=workflows();alias[0].nodes.find((n:{credentials?:{googlePalmApi?:{name:string}}})=>n.credentials?.googlePalmApi).credentials.googlePalmApi.name='stale alias';
  assert.throws(()=>bootstrapPlan(env,alias),/UNKNOWN_CREDENTIAL/);
});

test('fresh initialization records pending before CLI and complete only after publication',async()=>{
  const h=harness();assert.equal(await bootstrapN8n(h.options),'initialized');
  assert.equal(h.commands.length,3);
  assert(h.queries.findIndex(s=>s.includes("VALUES(1,'pending')"))<h.queries.findIndex(s=>s.includes("SET status='complete'")));
  assert.equal(h.queries.at(-1),"SELECT pg_advisory_unlock(hashtextextended('campus-n8n-bootstrap',0))");
  assert(!h.messages.join(' ').includes(env.SERVICE_TOKEN));
});

test('existing databases and completed initialization never import, publish or update credentials',async()=>{
  for(const fixture of [{existing:true},{marker:true}]){
    const h=harness(fixture);h.options.loadWorkflows=()=>{throw new Error('must not read new artifacts');};
    h.options.env={} as typeof env;
    assert.equal(await bootstrapN8n(h.options),fixture.marker?'already-initialized':'existing-database');
    assert.equal(h.commands.length,0);
    assert(h.queries.every(s=>/^SELECT\s/.test(s)));
  }
});

test('incomplete initialization cannot silently retry or overwrite partial data',async()=>{
  for(const status of ['pending','']){
    const h=harness({marker:true,status});await assert.rejects(bootstrapN8n(h.options),/BOOTSTRAP_INCOMPLETE/);
    assert.equal(h.commands.length,0);assert(h.queries.every(s=>s.startsWith('SELECT ')));
  }
});

test('each CLI failure leaves pending, releases lock and masks raw output',async()=>{
  for(const failAt of [1,2,3]){
    const codes=['IMPORT_CREDENTIALS','IMPORT_WORKFLOW','PUBLISH_WORKFLOW'];
    const h=harness({failAt});await assert.rejects(bootstrapN8n(h.options),{message:`BOOTSTRAP_CLI_${codes[failAt-1]}_FAILED`});
    assert.equal(h.commands.length,failAt);assert(!h.queries.some(s=>s.includes("SET status='complete'")));
    assert.match(h.queries.at(-1)!,/pg_advisory_unlock/);
    assert(!h.messages.join(' ').includes(env.SERVICE_TOKEN));
  }
});

test('competing initializer refuses work without releasing the other session lock',async()=>{
  const h=harness({locked:false});await assert.rejects(bootstrapN8n(h.options),/ALREADY_RUNNING/);
  assert.equal(h.commands.length,0);assert.equal(h.queries.length,1);
});

test('invalid fresh configuration performs no schema writes',async()=>{
  const h=harness();h.options.env={...env,SERVICE_TOKEN:''};
  await assert.rejects(bootstrapN8n(h.options),/BOOTSTRAP_REQUIRED_SERVICE_TOKEN/);
  assert.equal(h.commands.length,0);assert(h.queries.every(s=>/^SELECT\s/.test(s)));
});

test('Docker initialization is ordered before server, secrets stay in env, no persistent import files',()=>{
  const compose=readFileSync('docker-compose.yml','utf8'),dockerfile=readFileSync('Dockerfile','utf8');
  assert.match(compose,/n8n-init: \{condition: service_completed_successfully\}/);
  assert.match(compose,/target: n8n-init/);
  assert.match(compose,/\/home\/node\/\.n8n:uid=1000,gid=1000,mode=0700/);
  const image=dockerfile.match(/FROM (docker\.n8n\.io\/n8nio\/n8n:[^ ]+) AS n8n-init/)![1]!;
  assert(compose.replace(/\\\n\s*/g,'').includes(image));
  assert(!dockerfile.includes('COPY .env'));
  assert(!dockerfile.includes('--set='));
  assert(dockerfile.includes('\\getenv n8n_password N8N_DB_PASSWORD'));
  assert(dockerfile.includes('\\getenv agent_password AGENT_DB_PASSWORD'));
  const source=readFileSync('scripts/bootstrap-n8n.mjs','utf8');
  assert(!source.includes('writeFile'));assert(!source.includes('importCredentials'));
});
