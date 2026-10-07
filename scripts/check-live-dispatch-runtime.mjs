import {requiredEnv} from './env.mjs';
import {importCredentials} from './n8n-credentials.mjs';
import {session,base} from './n8n-client.mjs';
import {readFileSync,writeFileSync,mkdirSync,cpSync,realpathSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {parse} from 'flatted';
import assert from 'node:assert/strict';
const googleMode=process.argv.includes('--google-grounding');
if(!['http://localhost:15679','http://127.0.0.1:15679'].includes(base))throw new Error('LOCAL_N8N_REQUIRED');
const api=await session();
const unique=randomUUID().replaceAll('-','');
const directory=`.local/live-probe-${unique}`,remote=`/handoff/live-probe-${unique}`,schema=`live_probe_${unique}`;
const credentialId=`probe-${unique.slice(0,16)}`,token=randomBytes(32).toString('hex');
mkdirSync(`${directory}/node_modules`,{recursive:true});
writeFileSync(`${directory}/package.json`,'{"type":"module"}');
cpSync('dist/apps/gateway/src',`${directory}/gateway`,{recursive:true});
cpSync(realpathSync('node_modules/zod'),`${directory}/node_modules/zod`,{recursive:true});
const migration=['002-line-inbox.sql','003-task-dispatch.sql','004-public-evidence.sql','005-school-sessions.sql','006-liff-sessions.sql','007-private-results.sql','009-school-login-notice.sql','010-google-grounded-results.sql','011-provider-http-outcomes.sql','012-school-login-outcomes.sql','013-school-auth-rejections.sql','014-extended-private-operations.sql','015-public-line-access.sql'].map(name=>readFileSync(`apps/gateway/migrations/${name}`,'utf8')).join('\n');
const serviceScript=`
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from '/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js';
import {LineRepository} from './gateway/modules/line/line.repository.js';
import {LineService} from './gateway/modules/line/line.service.js';
import {LineProvider} from './gateway/modules/line/line.provider.js';
import {LineController} from './gateway/modules/line/line.controller.js';
import {lineRouter} from './gateway/modules/line/line.router.js';
import {TaskRepository} from './gateway/modules/tasks/task.repository.js';
import {TaskService} from './gateway/modules/tasks/task.service.js';
import {TaskController} from './gateway/modules/tasks/task.controller.js';
const pool=new pg.Pool({host:'postgres',database:'campus_agent',user:'campus_agent',password:process.env.AGENT_DB_PASSWORD,options:'-c search_path=${schema}',max:5});
await pool.query('CREATE SCHEMA ${schema}');
await pool.query(${JSON.stringify(migration)});
const user='U'+'a'.repeat(32);
const identities=new LineRepository(pool,'isolated-runtime-secret-32-bytes');
await identities.accept('runtime',user,'runtime isolation question','message');
const tasks=new TaskRepository(pool,'runtime-private-key-with-at-least-32-characters','2011885607-MccunYXG'),task=await tasks.claim();
const schoolId='12345678-1234-4234-8234-123456789012';
await pool.query('INSERT INTO campus_school_sessions(user_id,id,account_hash,encrypted_cookies) VALUES($1,$2,$3,$4)',[user,schoolId,'fixture-hash','unused-cookie']);
const schoolFixture={query:async()=>({sessionId:schoolId,result:{kind:'schedule',items:[{weekday:1,periods:[1],startTime:'08:10',endTime:'09:00',title:'PRIVATE_RUNTIME_SENTINEL',teacher:'',className:''}]}})};

const service=new LineService(identities,new LineProvider('123','unused',async()=>{throw Error('External calls prohibited in this test');}));
const searchFixture={search:async()=>[{sourceId:'web:runtime-fixture',url:'https://school.example.edu.tw/rules',title:'Runtime fixture',text:'This is explicitly synthetic provider text used only to verify the source ledger.',version:'runtime-v1',fetchedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),publishedAt:null}]};
const groundingFixture=${googleMode?"{searchHtml:async()=>'<article>GROUNDING_RUNTIME_SENTINEL</article>'}":'undefined'};
const server=createServer(lineRouter(new LineController(service,'unused',user),new TaskController(new TaskService(tasks,identities,searchFixture,schoolFixture,groundingFixture),process.env.RUNTIME_SERVICE_TOKEN)));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync('${remote}/port',String(server.address().port));
console.log('READY:'+JSON.stringify({taskId:task.id,lease:task.lease,capability:task.capability}));
process.stdin.resume();
process.stdin.once('data',async()=>{
 server.close();
 try {
  const outbox=await pool.query('SELECT state,reply,encrypted FROM campus_outbox');
  let delivered='';await tasks.deliverOne(async(_user,reply)=>{delivered=reply;});
  const memory=await pool.query('SELECT count(*)::int n FROM live_agent_chat_histories');
  writeFileSync('${remote}/result.json',JSON.stringify({outbox:outbox.rows,privateDelivered:delivered.includes('PRIVATE_RUNTIME_SENTINEL'),citationDelivered:delivered.includes(${googleMode?"'https://liff.line.me/'":"'https://school.example.edu.tw/rules'"}),groundedOwnerReadable:${googleMode?"(await tasks.groundedResult(user,task.id)).includes('GROUNDING_RUNTIME_SENTINEL')":'null'},memoryRows:memory.rows[0].n}));
 } finally {await pool.query('DROP SCHEMA ${schema} CASCADE');await pool.end();process.exit(0);}
});
`;
writeFileSync(`${directory}/server.mjs`,serviceScript,{mode:0o600});
// Test credentials stay in memory and encrypted n8n storage, never an import file.
try {importCredentials([{id:credentialId,name:credentialId,type:'httpHeaderAuth',data:{name:'X-Campus-Service',value:token}}]);} catch {rmSync(directory,{recursive:true,force:true});throw new Error('Isolated test credential import failed; raw output withheld.');}
const child=spawn('docker',['compose','--env-file','.env','-f','docker-compose.yml','exec','-T','-e','AGENT_DB_PASSWORD','-e','RUNTIME_SERVICE_TOKEN','n8n','node',`${remote}/server.mjs`],{stdio:['pipe','pipe','pipe'],env:{...process.env,AGENT_DB_PASSWORD:requiredEnv('AGENT_DB_PASSWORD'),RUNTIME_SERVICE_TOKEN:token}});
let taskAuth;
let workflow;
let executionId;
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Runtime probe readiness timeout')),20000);
  let pending='';child.stdout.on('data',chunk=>{pending+=chunk.toString();const match=pending.match(/READY:(.+)\n/);if(match){taskAuth=JSON.parse(match[1]);clearTimeout(timer);resolve();}});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Runtime probe exited before readiness'));});
 });
 const port=Number(readFileSync(`${directory}/port`,'utf8'));
 const auth=taskAuth;
 const main=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
 const clone=id=>structuredClone(main.nodes.find(n=>n.id===id));
 const prepare=clone('prepare');prepare.parameters.url=`http://127.0.0.1:${port}/internal/v1/agent/prepare`;
 prepare.parameters.jsonBody=JSON.stringify(auth);prepare.credentials={httpHeaderAuth:{id:credentialId,name:credentialId}};prepare.onError='stopWorkflow';
 const search=clone('direct-official_search');search.type='n8n-nodes-base.httpRequest';search.typeVersion=4.4;delete search.parameters.toolDescription;
 search.parameters.url=`http://127.0.0.1:${port}/internal/v1/agent/tool`;search.credentials=prepare.credentials;
 search.parameters.jsonBody="={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,lease:$('整理訊息').first().json.lease,capability:$('整理訊息').first().json.capability,kind:'web',query:'runtime fixture'}) }}";
 const personal=clone('direct-student_schedule');personal.type='n8n-nodes-base.httpRequest';personal.typeVersion=4.4;delete personal.parameters.toolDescription;
 personal.parameters.url=search.parameters.url;personal.credentials=prepare.credentials;
 personal.parameters.jsonBody=search.parameters.jsonBody.replace("kind:'web',query:'runtime fixture'","kind:'personal',query:'schedule'");
 const complete=clone('validate');complete.parameters.url=`http://127.0.0.1:${port}/internal/v1/agent/complete`;
 complete.parameters.jsonBody="={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,lease:$('整理訊息').first().json.lease,capability:$('整理訊息').first().json.capability,output:JSON.stringify({answer:'本人校務 PRIVATE_RUNTIME_SENTINEL 與本次公開 runtime fixture 的合成整理回答',sourceIds:['web:runtime-fixture']})}) }}";
 if(googleMode)complete.parameters.jsonBody=complete.parameters.jsonBody.replace("['web:runtime-fixture']",'[]');
 complete.credentials=prepare.credentials;complete.onError='stopWorkflow';
 const memory=clone('memory');
  // A schema-qualified table is not assumed supported. Native Memory test uses a uniquely named table
 // in public with the same trigger policy and a temporary scoped mapping in the test schema.
 const table=`probe_memory_${unique}`;
 const sql=`SET ROLE campus_agent; CREATE TABLE public.${table} (LIKE ${schema}.live_agent_chat_histories INCLUDING ALL); CREATE TRIGGER campus_memory_identity BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.campus_guard_memory_insert(); ALTER FUNCTION ${schema}.campus_guard_memory_insert() SET search_path TO ${schema};`;
 execFileSync('docker',['compose','--env-file','.env','-f','docker-compose.yml','exec','-T','postgres','psql','-U','bootstrap','-d','campus_agent','-v','ON_ERROR_STOP=1'],{input:sql,stdio:['pipe','pipe','pipe']});
 memory.parameters.tableName=table;
 memory.credentials={postgres:{id:'campus-agent-postgres',name:'Campus Agent Postgres'}};
 const manager={id:'memory-probe',name:'原生記憶寫入',type:'@n8n/n8n-nodes-langchain.memoryManager',typeVersion:1.1,position:[960,0],parameters:{mode:'insert',insertMode:'insert',messages:{messageValues:[{type:'user',message:'runtime-only memory probe',hideFromUI:false}]}}};
 const nodes=[{id:'manual',name:'測試入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},prepare,clone('input'),manager,memory,search,personal,complete];
 const connections={};const link=(a,b,type='main')=>{connections[a]??={};connections[a][type]=[[{node:b,type,index:0}]];};
 link('測試入口',prepare.name);link(prepare.name,'整理訊息');link('整理訊息',manager.name);link(memory.name,manager.name,'ai_memory');link(manager.name,search.name);link(search.name,personal.name);link(personal.name,complete.name);
 workflow=await api('/workflows','POST',{name:'TEMP live gateway and guarded memory verification',nodes,connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
 const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:'測試入口'}});
 executionId=started.executionId;
 let execution;
 for(let i=0;i<120;i++) {execution=await api(`/executions/${started.executionId}`);if(['success','error','crashed','canceled'].includes(execution.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
 const data=typeof execution.data==='string'?parse(execution.data):execution.data;
 assert.equal(execution.status,'success',data.resultData.error?.message??'Runtime did not finish');
 const result=data.resultData.runData[complete.name].at(-1).data.main[0][0].json.data;
 assert.equal(result.status,'queued');
 const privateTool=data.resultData.runData[personal.name].at(-1).data.main[0][0].json.data;
 assert.equal(privateTool.operation,'schedule');assert.match(privateTool.ref,/^[0-9a-f-]{36}$/);
 assert(privateTool.data.includes('PRIVATE_RUNTIME_SENTINEL'));assert.equal(privateTool.message,privateTool.data);
 if(googleMode){assert(!JSON.stringify(data).includes('GROUNDING_RUNTIME_SENTINEL'));assert.equal(data.resultData.runData[search.name].at(-1).data.main[0][0].json.data.status,'grounded_answer_ready');}
 assert.equal(data.resultData.runData[personal.name].at(-1).data.main[0][0].json.data.status,'ready');
 const nativeCount=execFileSync('docker',['compose','--env-file','.env','-f','docker-compose.yml','exec','-T','postgres','psql','-U','bootstrap','-d','campus_agent','-tAc',`SELECT count(*) FROM public.${table}`],{encoding:'utf8'}).trim();
 assert.equal(nativeCount,'1');
 const exit=new Promise(resolve=>child.once('exit',resolve));child.stdin.write('stop\n');await exit;
 const state=JSON.parse(readFileSync(`${directory}/result.json`,'utf8'));assert.equal(state.outbox.length,1);
 assert(state.outbox[0].encrypted);assert(!state.outbox[0].reply.includes('PRIVATE_RUNTIME_SENTINEL'));assert(state.privateDelivered);assert(state.citationDelivered);
 if(googleMode)assert.equal(state.groundedOwnerReadable,true);
 mkdirSync('.local/verification',{recursive:true});writeFileSync(googleMode?'.local/verification/google-search-runtime.json':'.local/verification/live-dispatch-runtime.json',JSON.stringify({recordedAt:new Date().toISOString(),executionId:started.executionId,status:'pass',n8n:'2.41.7',syntheticTestInputs:true,gateway:'actual prepare, direct search configuration and completion HTTP endpoints',memory:'native Postgres Memory insert with generation trigger',outbox:'single encrypted mixed answer; local delivery validates private template and citation; no LINE network call',gemini:'not-run',school:'synthetic school provider; actual owner-authorized HTTP tool exposes rendered owner-only data and lease-bound ref for Gemini, per explicit user approval; no live school or Gemini call',sourceLedger:googleMode?'Google grounded answer synthetic fixture; encrypted owner result and LINE link verified; no live Google call':'runtime fixture recorded and checked; Brave network mocked; no school corpus'},null,2)+'\n');
 console.log('Live gateway HTTP, guarded native Memory and durable outbox passed in n8n. No external provider calls.');
} finally {
 if(child.exitCode===null) {const exit=new Promise(resolve=>child.once('exit',resolve));child.stdin.write('stop\n');await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,5000))]);}
 if(executionId)await api('/executions/delete','POST',{ids:[executionId]});
 if(workflow) {await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');}
 await api(`/credentials/${credentialId}`,'DELETE');
 execFileSync('docker',['compose','--env-file','.env','-f','docker-compose.yml','exec','-T','postgres','psql','-U','bootstrap','-d','campus_agent','-v','ON_ERROR_STOP=1'],{input:`SET ROLE campus_agent; DROP TABLE IF EXISTS public.probe_memory_${unique}; DROP SCHEMA IF EXISTS ${schema} CASCADE;`,stdio:['pipe','pipe','pipe']});
 rmSync(directory,{recursive:true,force:true});
}
