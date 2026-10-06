import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';
assert.equal(base,'http://localhost:15679');
assert(process.argv.includes('--send-line'),'This acceptance sends the real student result to the sole invited owner; use --send-line explicitly.');
const api=await session(),eventId=`operator-school-acceptance-${randomUUID()}`;
const container=script=>execFileSync('docker',['exec','-i','campus-phase1-gateway-1','node','--input-type=module'],{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000});
let auth,workflow,report;
try{
 const setup=container(`
 import {Pool} from 'pg';import {LineRepository} from './dist/apps/gateway/src/modules/line/line.repository.js';import {TaskRepository} from './dist/apps/gateway/src/modules/tasks/task.repository.js';
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const owners=await pool.query('SELECT user_id FROM campus_identities WHERE invited AND NOT revoked');if(owners.rowCount!==1)throw new Error('OWNER_COUNT');
  const busy=await pool.query("SELECT count(*)::int n FROM campus_tasks WHERE state='running' OR (state='pending' AND expires_at>now())");if(busy.rows[0].n!==0)throw new Error('LIVE_TASKS_PRESENT');
  if(process.env.LIVE_AGENT_ENABLED==='true')throw new Error('WORKER_MUST_BE_DISABLED_FOR_OPERATOR_ACCEPTANCE');
  const owner=owners.rows[0].user_id;
  const valid=await pool.query("SELECT count(*)::int n FROM campus_school_sessions WHERE user_id=$1 AND expires_at>now() AND last_used_at>now()-interval '30 minutes'",[owner]);if(valid.rows[0].n!==1)throw new Error('VALID_SCHOOL_SESSION_REQUIRED');
  await new LineRepository(pool,process.env.SESSION_SECRET,process.env.LIFF_ID).accept(${JSON.stringify(eventId)},owner,'[管理驗收，不是 LINE 入站] 查詢本人的課表、缺曠與公告','message');
  const task=await new TaskRepository(pool,process.env.SESSION_SECRET,process.env.LIFF_ID).claim();if(!task)throw new Error('NO_TASK');
  const own=await pool.query('SELECT event_id FROM campus_tasks WHERE id=$1',[task.id]);if(own.rows[0].event_id!==${JSON.stringify(eventId)})throw new Error('WRONG_TASK');
  console.log(JSON.stringify({taskId:task.id,lease:task.lease,capability:task.capability}));
 }finally{await pool.end();}`);
 auth=JSON.parse(setup.trim());
 const live=await api('/workflows/campusNativeAgentLive');
 const clone=id=>{const node=live.nodes.find(n=>n.id===id);assert(node,`Missing live node ${id}`);return structuredClone(node);};
 const prepare=clone('prepare');prepare.parameters.jsonBody=JSON.stringify(auth);prepare.onError='stopWorkflow';
 const input=clone('input');
 const tools=['schedule','absence','announcements'].map(action=>{
  const node=clone(`direct-student_${action}`);node.type='n8n-nodes-base.httpRequest';node.typeVersion=4.4;
  delete node.parameters.toolDescription;
  node.parameters.jsonBody=`={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,lease:$('整理訊息').first().json.lease,capability:$('整理訊息').first().json.capability,kind:'personal',query:'${action}'}) }}`;
  node.onError='stopWorkflow';return node;
 });
 const complete=clone('validate');complete.onError='stopWorkflow';
 complete.parameters.jsonBody="={{ JSON.stringify({taskId:$('整理訊息').first().json.taskId,lease:$('整理訊息').first().json.lease,capability:$('整理訊息').first().json.capability,output:JSON.stringify({answer:'管理者真實校務資料與派送驗收',sourceIds:[]})}) }}";
 const nodes=[{id:'manual',name:'管理驗收入口',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},prepare,input,...tools,complete];
 const connections={};for(let i=0;i<nodes.length-1;i++)connections[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};
 workflow=await api('/workflows','POST',{name:'TEMP operator real school and LINE acceptance (no model)',nodes,connections,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
 const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:'管理驗收入口'}});
 let execution;
 for(let i=0;i<120;i++){
  execution=await api(`/executions/${started.executionId}`);
  if(['success','error','crashed','canceled'].includes(execution.status))break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(execution.status,'success','Actual school HTTP workflow failed; raw data withheld');
 const data=typeof execution.data==='string'?parse(execution.data):execution.data;
 const statuses=[];
 for(const tool of tools){
  const value=data.resultData.runData[tool.name].at(-1).data.main[0][0].json.data;
  assert.equal(value.status,'ready');assert(!('items' in value));assert(!('result' in value));
  statuses.push({operation:value.operation,status:value.status,onlyReference:true});
 }
 const completed=data.resultData.runData[complete.name].at(-1).data.main[0][0].json.data;
 assert.equal(completed.status,'queued');
 const result=JSON.parse(container(`
 import {Pool} from 'pg';import {TaskRepository} from './dist/apps/gateway/src/modules/tasks/task.repository.js';import {LineProvider} from './dist/apps/gateway/src/modules/line/line.provider.js';
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const before=await pool.query('SELECT encrypted,school_session_id IS NOT NULL AS school_bound FROM campus_outbox WHERE task_id=$1',[${JSON.stringify(auth.taskId)}]);if(before.rowCount!==1||!before.rows[0].encrypted||!before.rows[0].school_bound)throw new Error('PRIVATE_OUTBOX_REQUIRED');
  const provider=new LineProvider(process.env.LINE_LOGIN_CHANNEL_ID,process.env.LINE_ACCESS_TOKEN);let sent=false;
  await new TaskRepository(pool,process.env.SESSION_SECRET,process.env.LIFF_ID).deliverOne(async(owner,reply,key)=>{if(!reply.includes('我的課表')||!reply.includes('我的缺曠紀錄')||!reply.includes('校務公告'))throw new Error('PRIVATE_TEMPLATE_MISSING');await provider.push(owner,reply,key);sent=true;});
  const after=await pool.query('SELECT state,reply FROM campus_outbox WHERE task_id=$1',[${JSON.stringify(auth.taskId)}]);
  console.log(JSON.stringify({encryptedBeforeDelivery:true,schoolSessionChecked:true,realLineAccepted:sent,state:after.rows[0].state,replyErased:after.rows[0].reply===''}));
 }finally{await pool.end();}`));
 assert.equal(result.realLineAccepted,true);assert.equal(result.state,'sent');assert.equal(result.replyErased,true);
 report={checkedAt:new Date().toISOString(),n8n:'2.41.7',executionId:started.executionId,status:'pass',input:'explicit operator-created acceptance task for existing sole invited owner; not a LINE inbound event',school:'real persistent AIS session and actual school HTTP queries',tools:statuses,...result,gemini:'not-run; no model selection proof',privateExecutionData:'tool outputs contain references/status only; no school rows returned to n8n'};
}catch(error){console.error(`Real school runtime acceptance failed (${error.name}); raw subprocess, credentials and student data withheld.`);process.exitCode=1;}
finally{
 try{
  if(workflow){await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');assert(!(await api('/workflows')).some(w=>w.id===workflow.id));}
  const cleanup=JSON.parse(container(`
  import {Pool} from 'pg';const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try{
   const event=${JSON.stringify(eventId)};await pool.query('BEGIN');
   const ids=(await pool.query('SELECT id FROM campus_tasks WHERE event_id=$1',[event])).rows.map(r=>r.id);
   await pool.query('DELETE FROM campus_outbox_sources WHERE outbox_id IN (SELECT id FROM campus_outbox WHERE task_id=ANY($1::uuid[]))',[ids]);
   for(const table of ['campus_outbox','campus_private_results','campus_task_evidence'])await pool.query('DELETE FROM '+table+' WHERE task_id=ANY($1::uuid[])',[ids]);
   await pool.query('DELETE FROM campus_tasks WHERE event_id=$1',[event]);await pool.query('DELETE FROM campus_inbox WHERE event_id=$1',[event]);await pool.query('COMMIT');
   const left=await pool.query('SELECT count(*)::int n FROM campus_inbox WHERE event_id=$1',[event]);console.log(JSON.stringify({operatorRowsRemoved:left.rows[0].n===0}));
  }finally{await pool.end();}`));
  assert.equal(cleanup.operatorRowsRemoved,true);
  if(report){writeFileSync('docs/verification/school-live-runtime.json',JSON.stringify({...report,cleanup:{...cleanup,temporaryWorkflowAndExecutionRemoved:true,realSchoolSessionRetained:true}},null,2)+'\n');console.log('Real school HTTP -> encrypted private outbox -> actual LINE push accepted; temporary acceptance rows removed. No model / LINE inbound event claimed.');}
 }catch(error){console.error(`Operator acceptance cleanup failed (${error.name}); raw output withheld.`);process.exitCode=1;}
}
