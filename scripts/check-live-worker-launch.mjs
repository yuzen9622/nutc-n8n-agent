import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {session,base} from './n8n-client.mjs';
assert.equal(base,'http://localhost:15679');
assert(process.argv.includes('--send-line'),'Automatic worker acceptance sends one real private LINE push; explicitly pass --send-line.');
const event=`operator-launch-${randomUUID()}`;
const prompt=`[管理上線驗收 ${event}，不是 LINE 入站] 查我的缺曠，並說明誤記怎麼更正。`;
const container=script=>execFileSync('docker',['exec','-i','campus-phase1-gateway-1','node','--input-type=module'],{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:115000});
let report;
try{
 const api=await session(),workflow=await api('/workflows/campusNativeAgentLive');assert.equal(workflow.active,true);
 const result=container(`
 import {Pool} from 'pg';import {LineRepository} from './dist/apps/gateway/src/modules/line/line.repository.js';
 const p=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  if(process.env.LIVE_AGENT_ENABLED!=='true')throw new Error('WORKER_DISABLED');
  if(process.env.GOOGLE_SEARCH_ENABLED==='true')throw new Error('UNVERIFIED_SEARCH_ENABLED');
  const o=await p.query('SELECT user_id FROM campus_identities WHERE invited AND NOT revoked');if(o.rowCount!==1)throw new Error('OWNER_COUNT');
  const accepted=await new LineRepository(p,process.env.SESSION_SECRET,process.env.LIFF_ID).accept(${JSON.stringify(event)},o.rows[0].user_id,${JSON.stringify(prompt)},'message');
  let row;
  for(let n=0;n<100;n++){
   const q=await p.query("SELECT t.state AS task_state,o.state AS delivery_state,o.encrypted,o.school_session_id IS NOT NULL AS school_bound,o.reply='' AS reply_erased,(SELECT count(*)::int FROM campus_outbox_sources s WHERE s.outbox_id=o.id) AS sources FROM campus_tasks t LEFT JOIN campus_outbox o ON o.task_id=t.id WHERE t.event_id=$1",[${JSON.stringify(event)}]);
   row=q.rows[0];if(row&&(['sent','failed','cancelled'].includes(row.delivery_state)))break;await new Promise(r=>setTimeout(r,1000));
  }
  if(row?.task_state!=='completed'||row.delivery_state!=='sent'||!row.encrypted||!row.school_bound||!row.reply_erased||!row.sources)throw new Error('AUTOMATIC_PRIVATE_MIXED_DELIVERY_FAILED');
  console.log(JSON.stringify({automaticWorker:true,taskCompleted:true,realLineAccepted:true,encryptedPrivateOutbox:true,schoolSessionChecked:true,replyErased:true,verifiedPublicSources:row.sources,searchEnabled:false}));
 }finally{await p.end();}`);
 let value;try{value=JSON.parse(result);}catch{throw new Error('Automatic worker result invalid; raw data withheld.');}
 report={checkedAt:new Date().toISOString(),status:'pass',n8n:'2.41.7',workflow:'campusNativeAgentLive',published:true,...value,input:'explicit administrator-created task, not a human LINE inbound event',dispatch:'actual running worker -> published production n8n webhook -> native Gemini/Memory/RAG/student tool -> completion -> actual LINE provider',budget:'existing ledger retained; authorized total/daily cap USD6 / NT300 test authorization',limits:'sole invited owner; live Google Search disabled; human LINE inbound and LIFF UI acceptance pending'};
}catch(e){console.error(`Live worker acceptance failed (${e.name}); raw subprocess output withheld.`);process.exitCode=1;}
finally{
 try{
  // Exact marker locates only this test's human Memory entry. Identity task locking
  // serializes its human/AI pair; never wipe all later owner Memory while live.
  container(`import {Pool} from 'pg';const p=new Pool({connectionString:process.env.DATABASE_URL});try{await p.query('BEGIN');const human=await p.query("SELECT id,session_id FROM live_agent_chat_histories WHERE message->>'type'='human' AND message->'data'->>'content'=$1",[${JSON.stringify(prompt)}]);if(human.rowCount>1)throw new Error('AMBIGUOUS_TEST_MEMORY');for(const h of human.rows){const next=await p.query("SELECT id,message->>'type' AS type FROM live_agent_chat_histories WHERE session_id=$1 AND id>$2 ORDER BY id LIMIT 1",[h.session_id,h.id]);const ids=[h.id];if(next.rows[0]?.type==='ai')ids.push(next.rows[0].id);await p.query('DELETE FROM live_agent_chat_histories WHERE id=ANY($1::int[])',[ids]);}const tasks=(await p.query('SELECT id FROM campus_tasks WHERE event_id=$1',[${JSON.stringify(event)}])).rows.map(r=>r.id);await p.query('DELETE FROM campus_outbox_sources WHERE outbox_id IN(SELECT id FROM campus_outbox WHERE task_id=ANY($1::uuid[]))',[tasks]);for(const table of ['campus_outbox','campus_private_results','campus_task_evidence'])await p.query('DELETE FROM '+table+' WHERE task_id=ANY($1::uuid[])',[tasks]);await p.query('DELETE FROM campus_tasks WHERE id=ANY($1::uuid[])',[tasks]);await p.query('DELETE FROM campus_inbox WHERE event_id=$1',[${JSON.stringify(event)}]);await p.query('COMMIT');}finally{await p.end();}`);
  if(report){report.cleanup='exact operator task/outbox and uniquely marked test Memory pair removed; real identity/session/corpus and all fee records retained';writeFileSync('docs/verification/live-worker-launch.json',JSON.stringify(report,null,2)+'\n');console.log('Published workflow and running automatic worker dispatched true private + official-corpus mixed reply; LINE accepted, private reply erased, operator test data removed.');}
 }catch(e){console.error(`Launch cleanup failed (${e.name}); raw output withheld.`);process.exitCode=1;}
}
