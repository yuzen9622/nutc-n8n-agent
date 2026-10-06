import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'flatted';
import {session,base} from './n8n-client.mjs';
import {parseAgentAnswer} from '../dist/apps/gateway/src/modules/tasks/task.schema.js';
const readJson=p=>{try{return JSON.parse(readFileSync(p,'utf8'));}catch{throw new Error('Native QA input/report unavailable; refusing paid execution.');}};
assert.equal(base,'http://localhost:15679');
const ids=process.argv.slice(2),allowed=new Set(['QA-01','QA-10','QA-11','QA-21','QA-22','QA-23','QA-29','QA-31','QA-36','QA-37','QA-38']);
assert(ids.length>0&&ids.length<=8&&new Set(ids).size===ids.length&&ids.every(id=>allowed.has(id)));
const manifest=readJson('docs/qa/phase-2-5.json'),path='docs/verification/native-owner-qa.json';
const report=existsSync(path)?readJson(path):{scope:'Explicit administrator-created tasks for sole invited owner; real native Agent/Memory/RAG/school tools and completion; no LINE inbound or delivery claimed',cases:[]};
assert(ids.every(id=>!report.cases.some(c=>c.id===id)),'No automatic paid retries; inspect prior evidence first.');
const api=await session(),live=await api('/workflows/campusNativeAgentLive');
assert.equal(live.active,false,'Operator QA requires inactive live workflow');
const container=script=>execFileSync('docker',['exec','-i','campus-phase1-gateway-1','node','--input-type=module'],{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000});
const parseContainer=script=>{try{return JSON.parse(container(script));}catch{throw new Error('Native QA setup/query failed; raw subprocess data withheld.');}};
const baseline=parseContainer(`import {Pool} from 'pg';const p=new Pool({connectionString:process.env.DATABASE_URL});try{if(process.env.LIVE_AGENT_ENABLED==='true')throw new Error('WORKER_ACTIVE');const o=await p.query('SELECT count(*)::int n FROM campus_identities WHERE invited AND NOT revoked');if(o.rows[0].n!==1)throw new Error('OWNER_COUNT');const busy=await p.query("SELECT count(*)::int n FROM campus_tasks WHERE state='running' OR(state='pending' AND expires_at>now())");if(busy.rows[0].n)throw new Error('LIVE_TASKS_PRESENT');const m=await p.query('SELECT COALESCE(max(id),0)::int id FROM live_agent_chat_histories');console.log(JSON.stringify({memoryId:m.rows[0].id}));}finally{await p.end();}`);
const save=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const eventIds=[];
try{
 for(const id of ids){
  const entry=manifest.cases.find(c=>c.id===id),event=`operator-native-qa-${randomUUID()}`;eventIds.push(event);
  const record={id,question:entry.question,expected:entry.expected,status:'creating',startedAt:new Date().toISOString()};report.cases.push(record);save();
  let workflow;
  try{
   const auth=JSON.parse(container(`import {Pool} from 'pg';import {LineRepository} from './dist/apps/gateway/src/modules/line/line.repository.js';import {TaskRepository} from './dist/apps/gateway/src/modules/tasks/task.repository.js';const p=new Pool({connectionString:process.env.DATABASE_URL});try{const o=await p.query('SELECT user_id FROM campus_identities WHERE invited AND NOT revoked');if(o.rowCount!==1)throw new Error('OWNER_COUNT');await new LineRepository(p,process.env.SESSION_SECRET,process.env.LIFF_ID).accept(${JSON.stringify(event)},o.rows[0].user_id,${JSON.stringify(entry.question)},'message');const t=await new TaskRepository(p,process.env.SESSION_SECRET,process.env.LIFF_ID).claim();if(!t)throw new Error('NO_TASK');const own=await p.query('SELECT event_id FROM campus_tasks WHERE id=$1',[t.id]);if(own.rows[0].event_id!==${JSON.stringify(event)}){await p.query("UPDATE campus_tasks SET state='pending',lease=NULL,leased_until=NULL,capability_hash=NULL WHERE id=$1 AND lease=$2 AND started_at IS NULL",[t.id,t.lease]);throw new Error('CONCURRENT_REAL_TASK');}console.log(JSON.stringify({taskId:t.id,lease:t.lease,capability:t.capability}));}finally{await p.end();}`));
   const clone=n=>{const x=live.nodes.find(v=>v.id===n);assert(x);return structuredClone(x);};
   const prepare=clone('prepare');prepare.parameters.jsonBody=JSON.stringify(auth);prepare.onError='stopWorkflow';
   const input=clone('input'),agent=clone('agent'),complete=clone('validate');agent.onError='stopWorkflow';complete.onError='stopWorkflow';
   const extra=['gemini','memory','vector','embedding','direct-student_schedule','direct-student_absence','direct-student_announcements','direct-official_search'].map(clone);
   const start={id:'manual',name:'管理者原生驗收',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
   const nodes=[start,prepare,input,agent,complete,...extra],connections={};
   for(const [a,b] of [[start,prepare],[prepare,input],[input,agent],[agent,complete]])connections[a.name]={main:[[{node:b.name,type:'main',index:0}]]};
   for(const n of extra)connections[n.name]=Object.fromEntries(Object.entries(live.connections[n.name]??{}).filter(([type])=>type!=='main'));
   workflow=await api('/workflows','POST',{name:`TEMP real native owner QA ${id}`,nodes,connections,settings:{executionOrder:'v1',executionTimeout:90,saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}});
   const started=await api(`/workflows/${workflow.id}/run`,'POST',{triggerToStartFrom:{name:start.name}});record.executionId=started.executionId;record.status='running';save();
   let execution;
   for(let n=0;n<100;n++){execution=await api(`/executions/${started.executionId}`);if(['success','error','crashed','canceled'].includes(execution.status))break;await new Promise(r=>setTimeout(r,1000));}
   record.executionStatus=execution.status;save();assert.equal(execution.status,'success','Native owner execution failed; raw output withheld');
   const data=typeof execution.data==='string'?parse(execution.data):execution.data;
   const output=data.resultData.runData[agent.name].at(-1).data.main[0][0].json;
   const steps=(output.intermediateSteps??[]).map(s=>({tool:s.action.tool,observation:s.observation}));
   // Student responses must never include private rows in any saved n8n output.
   const privateSteps=steps.filter(s=>s.tool.startsWith('student_'));
   for(const step of privateSteps){const text=typeof step.observation==='string'?step.observation:JSON.stringify(step.observation);assert(!/"(?:items|encrypted_reply|result)"\s*:/.test(text),'Private rows in model observation');}
   const completion=data.resultData.runData[complete.name].at(-1).data.main[0][0].json.data;assert.equal(completion.status,'queued');
   const flags=JSON.parse(container(`import {Pool} from 'pg';import {TaskRepository} from './dist/apps/gateway/src/modules/tasks/task.repository.js';const p=new Pool({connectionString:process.env.DATABASE_URL});try{const q=await p.query('SELECT o.id,o.reply,o.encrypted,o.school_session_id,t.generation,t.school_login_required FROM campus_outbox o JOIN campus_tasks t ON t.id=o.task_id WHERE t.id=$1',[${JSON.stringify(auth.taskId)}]);if(q.rowCount!==1)throw new Error('OUTBOX_MISSING');const row=q.rows[0],repo=new TaskRepository(p,process.env.SESSION_SECRET,process.env.LIFF_ID);const reply=row.encrypted?repo.crypt(row.reply,row.id,true):row.reply;console.log(JSON.stringify({encrypted:row.encrypted,schoolBound:!!row.school_session_id,loginRequired:row.school_login_required,hasSchedule:reply.includes('我的課表'),hasAbsence:reply.includes('我的缺曠紀錄'),hasAnnouncements:reply.includes('校務公告'),hasOfficialSource:reply.includes('https://student.nutc.edu.tw/')}));}finally{await p.end();}`));
   record.answer=parseAgentAnswer(output.output);record.steps=steps;record.memoryNodeExecuted=!!data.resultData.runData[extra.find(n=>n.id==='memory').name];record.outboxFlags=flags;
   record.status='needs-semantic-review';record.finishedAt=new Date().toISOString();save();
   console.log(JSON.stringify({id,status:record.status,answer:record.answer,tools:steps.map(s=>s.tool),outboxFlags:flags}));
  }catch(e){record.status='needs-fix';record.failureName=e.name;save();throw new Error(`Native owner QA ${id} failed; inspect stored nonprivate evidence before any retry.`);}
  finally{if(workflow){await api(`/workflows/${workflow.id}/archive`,'POST');await api(`/workflows/${workflow.id}`,'DELETE');record.temporaryWorkflowRemoved=true;save();}}
 }
}finally{
 container(`import {Pool} from 'pg';const p=new Pool({connectionString:process.env.DATABASE_URL});try{const events=${JSON.stringify(eventIds)};await p.query('BEGIN');const tasks=(await p.query('SELECT id FROM campus_tasks WHERE event_id=ANY($1::text[])',[events])).rows.map(r=>r.id);await p.query('DELETE FROM campus_outbox_sources WHERE outbox_id IN (SELECT id FROM campus_outbox WHERE task_id=ANY($1::uuid[]))',[tasks]);for(const table of ['campus_outbox','campus_private_results','campus_task_evidence'])await p.query('DELETE FROM '+table+' WHERE task_id=ANY($1::uuid[])',[tasks]);await p.query('DELETE FROM campus_tasks WHERE id=ANY($1::uuid[])',[tasks]);await p.query('DELETE FROM campus_inbox WHERE event_id=ANY($1::text[])',[events]);await p.query('DELETE FROM live_agent_chat_histories WHERE id>$1 AND session_id IN (SELECT session_key FROM campus_conversations WHERE user_id IN (SELECT user_id FROM campus_identities WHERE invited AND NOT revoked))',[${baseline.memoryId}]);await p.query('COMMIT');}finally{await p.end();}`);
 report.cleanup='temporary workflows/executions, exact operator tasks/outbox and test-only new owner Memory rows removed; real identity/session/corpus/fee ledger retained';save();
}
