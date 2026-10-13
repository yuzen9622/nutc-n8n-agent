import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setupN8n,setupPlan,MAX_INPUT_BYTES,type SetupCommand} from '../scripts/setup-n8n.mjs';
import {buildInternalCredentials} from '../scripts/n8n-credentials.mjs';
import {runtimeEnv} from '../apps/shared/runtime-config.mjs';

const env={POSTGRES_PASSWORD:'db-secret',APP_MASTER_KEY:'a1'.repeat(32)};
const input=()=>JSON.stringify(buildInternalCredentials(env));
const workflows=()=>['campusNativeAgentLive','campusKnowledgeIngest','campusGoogleSearch'].map(id=>JSON.parse(readFileSync(`workflows/agent/${id}.json`,'utf8')));
function harness({owner=true,existing=false,locked=true,failAt=0}={}){
  const queries:{sql:string;values?:string[][]}[]=[],commands:SetupCommand[]=[],messages:string[]=[];
  const client={query:async(sql:string,values?:string[][])=>{
    queries.push({sql,values});
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};
    if(sql.includes(' AS configured'))return {rows:[{configured:owner}]};
    if(sql.includes(' AS existing'))return {rows:[{existing}]};
    return {rows:[]};
  }};
  const options={client,input:input(),loadWorkflows:workflows,log:(s:string)=>messages.push(s),runCli:async(command:SetupCommand)=>{
    commands.push(command);if(commands.length===failAt)throw new Error(`leaked ${input()}`);
  }};
  return {queries,commands,messages,options};
}

test('manual plan imports exactly three derived internal credentials and three inactive workflows without publishing',()=>{
  const credentials=buildInternalCredentials(env),derived=runtimeEnv(env);
  assert.deepEqual(credentials.map(c=>c.id),['campus-agent-postgres','campus-live-service','campus-live-webhook']);
  assert.deepEqual(credentials[0]!.data,{host:'postgres',port:5432,database:'campus_agent',user:'campus_agent',password:env.POSTGRES_PASSWORD,ssl:'disable'});
  assert.deepEqual(credentials[1]!.data,{name:'X-Campus-Service',value:derived.SERVICE_TOKEN});
  assert.deepEqual(credentials[2]!.data,{name:'X-Campus-Webhook',value:derived.N8N_WEBHOOK_TOKEN});
  const commands=setupPlan(input(),workflows());
  assert.deepEqual(commands.map(c=>c.args),[['import:credentials','--input=/dev/stdin'],['import:workflow','--input=/dev/stdin']]);
  assert.deepEqual(JSON.parse(commands[0]!.input),credentials);
  assert.deepEqual(JSON.parse(commands[1]!.input),workflows());
  for(const secret of [env.APP_MASTER_KEY,env.POSTGRES_PASSWORD,derived.SERVICE_TOKEN!,derived.N8N_WEBHOOK_TOKEN!])assert(!commands.flatMap(c=>c.args).join(' ').includes(secret));
  assert(!credentials.some(c=>/google/i.test(c.type)));
  for(const key of Object.keys(env))assert.throws(()=>buildInternalCredentials({...env,[key]:''}));
});

test('fresh metadata database requires owner and absent targets; holds the same lock through both imports',async()=>{
  const h=harness();
  h.options.runCli=async command=>{
    assert(!h.queries.some(q=>q.sql.includes('pg_advisory_unlock')));
    h.commands.push(command);
  };
  assert.equal(await setupN8n(h.options),'initialized');
  assert.equal(h.commands.length,2);
  assert(h.queries.every(q=>q.sql.startsWith('SELECT ')));
  assert.match(h.queries[1]!.sql,/FROM "user" WHERE email IS NOT NULL/);
  assert(!h.queries[1]!.sql.includes('roleSlug'));
  assert.deepEqual(h.queries[2]!.values,[['campus-agent-postgres','campus-live-service','campus-live-webhook'],['campusNativeAgentLive','campusKnowledgeIngest','campusGoogleSearch']]);
  assert.match(h.queries.at(-1)!.sql,/pg_advisory_unlock/);
  assert.equal(h.messages.length,2);
});

test('owner missing or any target existing refuses without CLI or DB writes',async()=>{
  for(const fixture of [{owner:false},{existing:true}]){
    const h=harness(fixture);h.options.loadWorkflows=()=>{throw new Error('must not load');};
    await assert.rejects(setupN8n(h.options),new RegExp(fixture.owner===false?'SETUP_OWNER_REQUIRED':'SETUP_TARGET_EXISTS'));
    assert.equal(h.commands.length,0);assert.equal(h.messages.length,0);
    assert(h.queries.every(q=>q.sql.startsWith('SELECT ')));
    assert.match(h.queries.at(-1)!.sql,/pg_advisory_unlock/);
  }
});

test('each of the six target IDs is queried, so partial imports naturally refuse retry',async()=>{
  for(const id of ['campus-agent-postgres','campus-live-service','campus-live-webhook','campusNativeAgentLive','campusKnowledgeIngest','campusGoogleSearch']){
    const h=harness();const query=h.options.client.query;
    h.options.client.query=async(sql,values)=>sql.includes(' AS existing')?{rows:[{existing:values!.flat().includes(id)}]}:query(sql,values);
    await assert.rejects(setupN8n(h.options),/SETUP_TARGET_EXISTS/);assert.equal(h.commands.length,0);
  }
});

test('competing advisory lock does no work and does not unlock another session',async()=>{
  const h=harness({locked:false});await assert.rejects(setupN8n(h.options),/SETUP_ALREADY_RUNNING/);
  assert.equal(h.commands.length,0);assert.equal(h.queries.length,1);assert.equal(h.messages.length,0);
});

test('missing, malformed, oversized and non-contract credentials never write',async()=>{
  const bad=['','null','{','{}','[]',' '.repeat(MAX_INPUT_BYTES+1)];
  for(const mutate of [
    (c:any[])=>c.pop(),
    (c:any[])=>{c[0].id='arbitrary';},
    (c:any[])=>{c[0].name='wrong';},
    (c:any[])=>{c[0].type='googlePalmApi';},
    (c:any[])=>{c[0].data.database='other';},
    (c:any[])=>{c[0].data.password='';},
    (c:any[])=>{c[0].data.port='5432';},
    (c:any[])=>{c[1].data.name='wrong';},
    (c:any[])=>{c[1].data.value='short';},
    (c:any[])=>{c[1].data.extra='arbitrary';},
    (c:any[])=>{c[2]=c[1];},
  ]){const c=buildInternalCredentials(env);mutate(c);bad.push(JSON.stringify(c));}
  for(const payload of bad){
    const h=harness();h.options.input=payload;
    await assert.rejects(setupN8n(h.options),/SETUP_INVALID_INPUT/);
    assert.equal(h.commands.length,0);assert(h.queries.every(q=>q.sql.startsWith('SELECT ')));
    assert.match(h.queries.at(-1)!.sql,/pg_advisory_unlock/);
  }
});

test('workflow contracts reject unknown IDs, activation, alias/type mismatch and fake Google credentials',()=>{
  assert.throws(()=>setupPlan(input(),[]),/INVALID_WORKFLOWS/);
  for(const mutate of [
    (w:any[])=>{w[0].id='other';},
    (w:any[])=>{w[0].active=true;},
    (w:any[])=>{w[0].nodes[0].credentials.httpHeaderAuth.id='other';},
    (w:any[])=>{w[0].nodes[0].credentials.httpHeaderAuth.name='alias';},
    (w:any[])=>{w[0].nodes[0].credentials={postgres:{id:'campus-live-webhook',name:'Campus live webhook'}};},
    (w:any[])=>{w[0].nodes.find((n:any)=>/GoogleGemini/.test(n.type)).credentials={googlePalmApi:{id:'fake',name:'fake'}};},
  ]){const w=workflows();mutate(w);assert.throws(()=>setupPlan(input(),w),/SETUP_(INVALID_WORKFLOWS|UNKNOWN_CREDENTIAL)/);}
});

test('CLI interruptions stop later commands, release lock and expose no raw output or secret',async()=>{
  for(const failAt of [1,2]){
    const h=harness({failAt});
    await assert.rejects(setupN8n(h.options),{message:`SETUP_CLI_${failAt===1?'IMPORT_CREDENTIALS':'IMPORT_WORKFLOW'}_FAILED`});
    assert.equal(h.commands.length,failAt);assert.equal(h.messages.length,failAt-1);
    assert.match(h.queries.at(-1)!.sql,/pg_advisory_unlock/);
    for(const secret of [env.POSTGRES_PASSWORD,env.APP_MASTER_KEY,runtimeEnv(env).SERVICE_TOKEN!,runtimeEnv(env).N8N_WEBHOOK_TOKEN!])assert(!h.messages.join(' ').includes(secret));
  }
});

test('host shell uses Docker-only stdin pipeline, correct cwd and pipefail',()=>{
  const source=readFileSync('scripts/setup-n8n.sh','utf8');
  assert.match(source,/set -euo pipefail/);
  assert(!source.includes('echo'));assert(!source.includes('mktemp'));
  const dir=mkdtempSync(join(tmpdir(),'campus-setup-test-'));
  try{
    writeFileSync(join(dir,'docker'),'#!/bin/sh\ncase "$*" in\n"compose exec -T gateway node scripts/n8n-credentials.mjs --json") printf "{\\\"test\\\":true}"; exit "${PRODUCER_EXIT:-0}";;\n"compose exec -T n8n node /opt/campus/setup-n8n.mjs") cat >/dev/null; test "$PWD" = "$EXPECTED_ROOT";;\n*) exit 90;;\nesac\n',{mode:0o755});
    const shellEnv={...process.env,PATH:`${dir}:${process.env.PATH}`,EXPECTED_ROOT:resolve('.')};
    const good=spawnSync('bash',[resolve('scripts/setup-n8n.sh')],{cwd:tmpdir(),env:shellEnv,encoding:'utf8'});
    assert.equal(good.status,0,good.stderr);assert.equal(good.stdout,'');
    const fail=spawnSync('bash',[resolve('scripts/setup-n8n.sh')],{cwd:tmpdir(),env:{...shellEnv,PRODUCER_EXIT:'7'},encoding:'utf8'});
    assert.equal(fail.status,7);assert.equal(fail.stdout,'');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('credential producer --json prints only JSON, and failures reveal no secrets',()=>{
  // Isolated copy prevents loading the real project .env in this CLI test.
  const dir=mkdtempSync(join(tmpdir(),'campus-credentials-test-'));
  try{
    mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'apps/shared'),{recursive:true});
    for(const file of ['scripts/n8n-credentials.mjs','scripts/env.mjs','apps/shared/runtime-config.mjs'])writeFileSync(join(dir,file),readFileSync(file));
    const command=realpathSync(join(dir,'scripts/n8n-credentials.mjs'));
    const result=spawnSync(process.execPath,[command,'--json'],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),buildInternalCredentials(env));
    for(const args of [[],['--json','extra']]){
      const bad=spawnSync(process.execPath,[command,...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
      assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.equal(bad.stderr,'SETUP_CREDENTIALS_FAILED: raw output withheld.\n');
    }
    const missing=spawnSync(process.execPath,[command,'--json'],{env:{PATH:process.env.PATH,POSTGRES_PASSWORD:env.POSTGRES_PASSWORD},encoding:'utf8'});
    assert.equal(missing.status,1);assert.equal(missing.stdout,'');assert(!missing.stderr.includes(env.POSTGRES_PASSWORD));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('runtime CLI captures output, uses fixed official pg/workflow paths and creates no secret files',()=>{
  const source=readFileSync('scripts/setup-n8n.mjs','utf8');
  assert(source.includes('/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js'));
  assert(source.includes('/import/agent/${id}.json'));
  assert(source.includes("stdio:['pipe','pipe','pipe']"));
  assert(source.includes('maxBuffer:1024*1024'));assert(source.includes('timeout:120_000'));
  assert(!source.includes('writeFile'));assert(!source.includes('publish:workflow'));assert(!source.includes('campus_bootstrap'));
  const oversized=spawnSync(process.execPath,['scripts/setup-n8n.mjs'],{input:'x'.repeat(MAX_INPUT_BYTES+1),encoding:'utf8'});
  assert.equal(oversized.status,1);assert.equal(oversized.stdout,'');assert.match(oversized.stderr,/SETUP_INVALID_INPUT/);assert(!oversized.stderr.includes('xxxxx'));
});
