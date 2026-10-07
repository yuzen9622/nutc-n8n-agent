import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {requiredEnv} from './env.mjs';
import {session,base} from './n8n-client.mjs';

const before=process.argv.includes('--before');
if(!['http://localhost:15679','http://127.0.0.1:15679'].includes(base))throw new Error('LOCAL_N8N_REQUIRED');
const compose=['compose','--env-file','.env','-f','docker-compose.yml'];
const execute=(args,options={})=>execFileSync('docker',[...compose,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
const source=`import pg from '/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js';
const client=new pg.Client({host:'postgres',database:'campus_agent',user:'campus_agent',password:process.env.AGENT_DB_PASSWORD});
await client.connect();try{
 const state=(await client.query(\`SELECT
 (SELECT count(*)::int FROM campus_identities) identities,
 (SELECT count(*)::int FROM campus_school_sessions) school_sessions,
 (SELECT count(*)::int FROM campus_tasks WHERE state='running') running_tasks,
 (SELECT coalesce(md5(string_agg(user_id||':'||generation::text||':'||revoked::text,',' ORDER BY user_id)),md5('')) FROM campus_identities) identity_fingerprint,
 (SELECT coalesce(md5(string_agg(id::text||':'||encrypted_cookies,',' ORDER BY id)),md5('')) FROM campus_school_sessions) school_fingerprint,
 (SELECT checksum FROM campus_migrations WHERE name='015-public-line-access.sql') migration_checksum,
 pg_get_functiondef('campus_guard_memory_insert()'::regprocedure) memory_guard\`)).rows[0];
 console.log(JSON.stringify(state));
}finally{await client.end();}`;
let phase='database snapshot';
try {
const database=JSON.parse(execute(['exec','-T','-e','AGENT_DB_PASSWORD','n8n','node','--input-type=module'],{input:source,env:{...process.env,AGENT_DB_PASSWORD:requiredEnv('AGENT_DB_PASSWORD')}}).trim());
const configuration={searchEnabled:process.env.GOOGLE_SEARCH_ENABLED==='true'};
assert(!configuration.searchEnabled);
assert(!process.env.INVITED_LINE_USER_IDS);
if(before){
 writeFileSync('.local/public-line-deployment-before.json',JSON.stringify({recordedAt:new Date().toISOString(),database,configuration},null,2)+'\n');
 console.log(JSON.stringify({snapshot:'before',identities:database.identities,schoolSessions:database.school_sessions,runningTasks:database.running_tasks,configuration,migration015AlreadyApplied:Boolean(database.migration_checksum)}));
}else{
 const previous=JSON.parse(readFileSync('.local/public-line-deployment-before.json','utf8'));
 assert.deepEqual(configuration,previous.configuration);
 const checksum=createHash('sha256').update(readFileSync('apps/gateway/migrations/015-public-line-access.sql')).digest('hex');
 assert.equal(database.migration_checksum,checksum);assert(!database.memory_guard.includes('i.invited'));
 phase='service health and fresh process start';
 const states=JSON.parse(execFileSync('docker',['inspect','campus-phase1-gateway-1','campus-phase1-school-adapter-1','campus-phase1-n8n-1','campus-phase1-postgres-1'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).map(x=>({service:x.Name.replace('/campus-phase1-','').replace(/-1$/,''),running:x.State.Running,health:x.State.Health?.Status,startedAt:x.State.StartedAt}));
 states.forEach(x=>{assert(x.running);assert.equal(x.health,'healthy');});
 for(const service of ['gateway','school-adapter']){
  const state=states.find(x=>x.service===service);
  assert(new Date(state.startedAt)>new Date(previous.recordedAt));
 }
 phase='public endpoint boundaries';
 const endpoints=[];
 const probe=async(path,status,options)=>{
  const response=await fetch(path,{...options,signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,status);endpoints.push({path:new URL(path).pathname,status});return response;
 };
 const origin=requiredEnv('PUBLIC_ORIGIN');assert.equal(origin,'https://nutc-agent.yuzen.dev');
 await probe('http://127.0.0.1:3100/health/live',200);
 const page=await(await probe(origin+'/liff/',200)).text();
 assert(page.includes('本人的校務查詢結果會提供給 Google Gemini 整理'));
 assert(page.includes('校務登入密碼與 Cookie 不提供給模型，密碼不保存'));
 const config=await(await probe(origin+'/liff/config',200)).json();assert.equal(config.liffId,requiredEnv('LIFF_ID'));
 await probe(origin+'/internal/v1/agent/prepare',404);
 await probe(origin+'/line/webhook',401,{method:'POST',body:'{}'});
 await probe(origin+'/liff/bind',401,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({account:'synthetic',password:'not-submitted-to-school'})});
 await probe(origin+'/liff/identity',403,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({idToken:'not-sent-to-LINE'})});
 phase='active workflow and retained data';
 const api=await session();const workflow=await api('/workflows/campusNativeAgentLive');assert(workflow.active);
 const report={checkedAt:new Date().toISOString(),status:'pass',environment:'known local Docker campus-phase1; public Cloudflare ingress, not remote Linux',migration015ChecksumVerified:true,services:states,endpoints,privacyNoticeUpdated:true,published:{status:'user-confirmed',channelId:'2011885607',independentlyReadConsole:false},workflow:{id:workflow.id,active:workflow.active},configuration,retainedData:{identityFingerprintUnchanged:database.identity_fingerprint===previous.database.identity_fingerprint,schoolCookieFingerprintUnchanged:database.school_fingerprint===previous.database.school_fingerprint},realSchoolOrModelTestCalls:false,realLinePushTestCalls:false,secretsRecorded:false};
 assert(report.retainedData.identityFingerprintUnchanged);assert(report.retainedData.schoolCookieFingerprintUnchanged);
 mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/public-line-deployment.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,migration015ChecksumVerified:true,retainedData:report.retainedData,configuration,publicEndpoints:report.endpoints}));
}
} catch(error) {
 console.error(JSON.stringify({status:'failed',phase,error:error instanceof Error?error.name:'UnknownError'}));
 process.exitCode=1;
}
