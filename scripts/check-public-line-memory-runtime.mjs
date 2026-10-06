import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';
import {requiredEnv} from './env.mjs';

// Only the known local n8n; never import to an arbitrary instance.
if(!['http://localhost:15679','http://127.0.0.1:15679'].includes(base))throw new Error('LOCAL_N8N_REQUIRED');
const unique=randomUUID().replaceAll('-',''),schema=`public_access_${unique}`,table=`public_memory_${unique}`;
const workflows=[],executions=[],checks=[];
const sql=input=>execFileSync('docker',['compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','postgres','psql','-U','bootstrap','-d','campus_agent','-v','ON_ERROR_STOP=1','-tA'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const migration=['002-line-inbox.sql','003-task-dispatch.sql','004-public-evidence.sql','005-school-sessions.sql','006-liff-sessions.sql','007-private-results.sql','009-school-login-notice.sql','010-google-grounded-results.sql','011-provider-http-outcomes.sql','012-school-login-outcomes.sql','013-school-auth-rejections.sql','014-extended-private-operations.sql','015-public-line-access.sql'].map(n=>readFileSync(`infra/db/migrations/${n}`,'utf8')).join('\n');
const faultUrl='data:text/javascript;base64,'+Buffer.from(readFileSync('dist/apps/gateway/src/utils/fault.js','utf8')).toString('base64');
const repository=readFileSync('dist/apps/gateway/src/modules/line/line.repository.js','utf8').replace("'../../utils/fault.js'",JSON.stringify(faultUrl));
let api;
try{
 api=await session();
 sql(`SET ROLE campus_agent; CREATE SCHEMA ${schema}; SET search_path TO ${schema};\n${migration}`);
 const setup=`import pg from '/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js';
 const {LineRepository}=await import('data:text/javascript;base64,${Buffer.from(repository).toString('base64')}');
 const pool=new pg.Pool({host:'postgres',database:'campus_agent',user:'campus_agent',password:process.env.AGENT_DB_PASSWORD,options:'-c search_path=${schema}'});
 try{const repo=new LineRepository(pool,'synthetic-native-memory-secret-32-bytes');const keys=[];
 for(const user of ['U'+'a'.repeat(32),'U'+'b'.repeat(32)]){const {sessionKey}=await repo.identity(user);keys.push(sessionKey);await pool.query('INSERT INTO campus_conversations(session_key,user_id,generation) VALUES($1,$2,0)',[sessionKey,user]);}console.log(JSON.stringify(keys));}finally{await pool.end();}`;
 const keys=JSON.parse(execFileSync('docker',['compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','-e','AGENT_DB_PASSWORD','n8n','node','--input-type=module'],{input:setup,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,AGENT_DB_PASSWORD:requiredEnv('AGENT_DB_PASSWORD')}}).trim());
 assert.notEqual(keys[0],keys[1]);
 sql(`SET ROLE campus_agent; CREATE TABLE public.${table} (LIKE ${schema}.live_agent_chat_histories INCLUDING ALL); ALTER FUNCTION ${schema}.campus_guard_memory_insert() SET search_path TO ${schema}; CREATE TRIGGER campus_memory_identity BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.campus_guard_memory_insert();`);
 const main=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
 const run=async workflow=>{
  const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:'測試入口'}});executions.push(started.executionId);
  for(let attempt=0;attempt<120;attempt++){
   const execution=await api(`/executions/${started.executionId}`);
   if(['success','error','crashed','canceled'].includes(execution.status))return {execution,data:typeof execution.data==='string'?parse(execution.data):execution.data};
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('PUBLIC_MEMORY_RUNTIME_TIMEOUT');
 };
 for(let index=0;index<2;index++){
  const memory=structuredClone(main.nodes.find(n=>n.id==='memory'));assert(memory);
  memory.parameters={...memory.parameters,sessionKey:keys[index],tableName:table};
  const manager={id:'memory-public-test',name:'原生記憶寫入',type:'@n8n/n8n-nodes-langchain.memoryManager',typeVersion:1.1,position:[240,0],parameters:{mode:'insert',insertMode:'insert',messages:{messageValues:[{type:'user',message:`SYNTHETIC_PUBLIC_OWNER_${index}`,hideFromUI:false}]}}};
  const workflow=await api('/workflows','POST',{name:`TEMP public LINE memory ${unique}-${index}`,nodes:[{id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},manager,memory],connections:{'測試入口':{main:[[{node:manager.name,type:'main',index:0}]]},[memory.name]:{ai_memory:[[{node:manager.name,type:'ai_memory',index:0}]]}},settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
  workflows.push(workflow);
  assert.equal((await run(workflow)).execution.status,'success');
 }
 const rows=JSON.parse(sql(`SELECT coalesce(json_agg(row_to_json(x)),'[]') FROM (SELECT session_id,message FROM public.${table} ORDER BY id) x;`).trim());
 assert.equal(rows.length,2);rows.forEach((row,index)=>{assert.equal(row.session_id,keys[index]);assert(JSON.stringify(row.message).includes(`SYNTHETIC_PUBLIC_OWNER_${index}`));assert(!JSON.stringify(row.message).includes(`SYNTHETIC_PUBLIC_OWNER_${1-index}`));});
 checks.push('two automatically registered identities write isolated native n8n Postgres Memory without invitations');
 sql(`SET ROLE campus_agent; UPDATE ${schema}.campus_identities SET revoked=true,generation=generation+1 WHERE user_id='U${'a'.repeat(32)}';`);
 const revoked=await run(workflows[0]);assert.equal(revoked.execution.status,'error');assert(JSON.stringify(revoked.data).includes('CHAT_SESSION_REVOKED'));
 assert.equal(sql(`SELECT count(*) FROM public.${table};`).trim(),'2');
 checks.push('revoked identity cannot perform a late native Memory write; other owner untouched');
} catch{
 throw new Error('Public LINE native Memory verification failed; raw output withheld.');
} finally{
 // Delete only executions/workflows created by this invocation. Cleanup errors fail the run.
 if(api){
  if(executions.length)await api('/executions/delete','POST',{ids:executions});
  for(const workflow of workflows){await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');}
 }
 sql(`SET ROLE campus_agent; DROP TABLE IF EXISTS public.${table}; DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
writeFileSync('docs/verification/public-line-memory-runtime.json',JSON.stringify({checkedAt:new Date().toISOString(),status:'pass',n8n:'2.41.7',syntheticTestInputs:true,externalProviderCalls:false,temporaryResourcesRemoved:true,checks},null,2)+'\n');
console.log('PASS: two-owner native Memory isolation, revocation and temporary-resource cleanup; no model, LINE or school calls.');
