import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Fault } from '../../utils/fault.js';
import type { VerifiedSource } from '../search/official-reader.js';
import type { TaskAuth } from './task.schema.js';
import {LEAVE_FALLBACK,type LeaveReply} from '../../../../shared/leave-contract.js';
import {renderLeaveOutcome} from '../personal/personal.render.js';
import type {KnowledgeEvidence} from '../knowledge/knowledge.evidence.js';
export type LeasedTask = { id: string; userId: string; generation: string; prompt: string; lease: string; capability: string; deliveryMode?:'line'|'capture'; leaveControlled?:boolean };

// Called inside the ingress transaction after the identity lock and the new task INSERT.
// The first accepted message after a presented preview is the only one that may bind as confirm; anything else seals the preview.
export async function bindLeaveConfirmation(c:PoolClient,userId:string,generation:string|number,taskId:string,prompt:string):Promise<void>{
  const found=await c.query(`SELECT p.id,p.generation,p.confirm_task_id,p.presented_at,p.origin_task_id,p.expires_at>clock_timestamp() AS live,o.created_at AS origin_created
    FROM campus_leave_previews p JOIN campus_tasks o ON o.id=p.origin_task_id WHERE p.user_id=$1 AND p.state='pending' ORDER BY p.id FOR UPDATE OF p`,[userId]);
  for(const p of found.rows){
    if(p.confirm_task_id)continue;
    const intervening=await c.query('SELECT 1 FROM campus_tasks WHERE user_id=$1 AND id<>$2 AND id<>$3 AND created_at>$4 LIMIT 1',[userId,p.origin_task_id,taskId,p.origin_created]);
    const valid=prompt.trim()==='確認送出'&&String(p.generation)===String(generation)&&p.presented_at&&p.live&&!intervening.rowCount;
    if(valid)await c.query('UPDATE campus_leave_previews SET confirm_task_id=$2 WHERE id=$1 AND state=\'pending\' AND confirm_task_id IS NULL',[p.id,taskId]);
    else await c.query("UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE id=$1 AND state='pending' AND confirm_task_id IS NULL",[p.id]);
  }
}

export class TaskRepository {
  constructor(private readonly pool: Pool,private readonly privateSecret?:string,private readonly liffId?:string) {
    if(liffId && !/^\d+-[A-Za-z0-9]+$/.test(liffId))throw new Error('INVALID_LIFF_ID');
  }
  private loginMessage(){return '查詢本人資料前，請先登入或重新登入學校帳號。密碼只在綁定頁輸入，不要傳到聊天室。'+(this.liffId?'\nhttps://liff.line.me/'+this.liffId:'\n請開啟校園助理的 LIFF 綁定頁。');}
  async recordLoginRequired(auth:TaskAuth){
    return this.transaction(async client=>{
      const task=await this.authorized(client,auth);
      if(!task.started_at)throw new Fault(409,'TASK_NOT_STARTED');
      await client.query('UPDATE campus_tasks SET school_login_required=true WHERE id=$1',[task.id]);
      await client.query('DELETE FROM campus_private_results WHERE task_id=$1',[task.id]);
      const loginMsg = this.loginMessage();
      return {
        status:'login_required',
        message: loginMsg,
        loginUrl: this.liffId ? `https://liff.line.me/${this.liffId}` : undefined,
        notice:'使用者尚未登入學校帳號，請引導使用者點擊以下連結進行登入：\n' + loginMsg
      };
    });
  }
  private crypt(text:string,context:string,open=false){
    if(!this.privateSecret||this.privateSecret.length<32)throw new Fault(503,'PRIVATE_KEY_REQUIRED');
    const key=createHash('sha256').update('campus-private-v1:'+this.privateSecret).digest();
    try{
      if(open){const [iv,tag,data]=text.split('.');const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv!,'base64url'),{authTagLength:16});cipher.setAAD(Buffer.from(context));cipher.setAuthTag(Buffer.from(tag!,'base64url'));return Buffer.concat([cipher.update(Buffer.from(data!,'base64url')),cipher.final()]).toString('utf8');}
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(v=>v.toString('base64url')).join('.');
    }catch{throw new Fault(503,'PRIVATE_RESULT_UNAVAILABLE');}
  }
  async recordPersonal(auth:TaskAuth,operation:string,schoolSessionId:string,reply:string){
    return this.transaction(async client=>{
      const task=await this.authorized(client,auth);
      const session=await client.query("SELECT id FROM campus_school_sessions WHERE user_id=$1 AND id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[task.user_id,schoolSessionId]);
      if(!session.rowCount)throw new Fault(401,'SCHOOL_LOGIN_REQUIRED');
      await client.query('UPDATE campus_tasks SET school_login_required=false WHERE id=$1',[task.id]);
      const id=randomUUID();
      const result=await client.query(`INSERT INTO campus_private_results(id,task_id,lease,operation,school_session_id,encrypted_reply)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_id,lease,operation) DO UPDATE SET school_session_id=EXCLUDED.school_session_id,encrypted_reply=EXCLUDED.encrypted_reply,expires_at=now()+interval '5 minutes' RETURNING id`,
        [id,task.id,auth.lease,operation,schoolSessionId,this.crypt(reply,`${task.id}:${auth.lease}:${operation}`)]);
      return {
        status:'ready',
        ref:result.rows[0].id,
        operation,
        data:reply,
        message:reply,
        notice:'已成功取得學生資料。請根據這些內容整理思考後，以親切自然的方式回答使用者的問題。'
      };
    });
  }
  async leaveControlled(auth:TaskAuth){return this.transaction(async c=>Boolean((await this.authorized(c,auth)).leave_controlled));}
  async guardLeave(auth:TaskAuth){return this.transaction(async c=>{const t=await this.authorized(c,auth);if(!t.started_at)throw new Fault(409,'TASK_NOT_STARTED');await c.query('UPDATE campus_tasks SET leave_controlled=true WHERE id=$1',[t.id]);});}
  async beginLeavePreview(auth:TaskAuth){return this.transaction(async c=>{const t=await this.authorized(c,auth);if(t.prompt.trim()==='確認送出')throw new Fault(409,'LEAVE_CONFIRM_CANNOT_PREVIEW');await c.query('SELECT id FROM campus_school_sessions WHERE user_id=$1 FOR UPDATE',[t.user_id]);await c.query("UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND state='pending' AND origin_task_id<>$2",[t.user_id,t.id]);});}
  async recordLeaveResult(auth:TaskAuth,result:LeaveReply){return this.transaction(async c=>{
    const t=await this.authorized(c,auth);const session=await c.query("SELECT id FROM campus_school_sessions WHERE user_id=$1 AND id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[t.user_id,result.sessionId]);if(!session.rowCount)throw new Fault(401,'SCHOOL_LOGIN_REQUIRED');
    if(t.leave_result_state==='succeeded'&&result.receipt.state!=='succeeded')return {status:'succeeded',message:'本次結果已由伺服器驗證；不會再次送出。',notice:'本地結果不可改写。'};
    const reply=renderLeaveOutcome(result.receipt),context=`leave:${t.id}:${auth.lease}:${t.generation}:${result.receipt.state}`;
    await c.query('UPDATE campus_tasks SET leave_controlled=true,leave_result_state=$2,leave_result_ciphertext=$3,leave_result_session_id=$4,leave_preview_id=$5 WHERE id=$1',[t.id,result.receipt.state,this.crypt(reply,context),result.sessionId,result.previewId??null]);
    return {status:result.receipt.state,message:reply,notice:'這是伺服器固定結果，不得改寫或自行宣稱成功。'};
  });}
  private async transaction<T>(action:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const value=await action(client); await client.query('COMMIT'); return value; }
    catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async claim():Promise<LeasedTask|null> {
    return this.transaction(async client => {
      // Identity is always locked first, including completion, clear and delivery.
      const owner=await client.query(`SELECT i.user_id FROM campus_identities i
        WHERE NOT i.revoked
        AND EXISTS(SELECT 1 FROM campus_tasks t WHERE t.user_id=i.user_id AND t.generation=i.generation AND t.state='pending' AND t.expires_at>now())
        AND NOT EXISTS(SELECT 1 FROM campus_tasks t WHERE t.user_id=i.user_id AND t.state='running')
        ORDER BY i.user_id FOR UPDATE OF i SKIP LOCKED LIMIT 1`);
      if (!owner.rowCount) return null;
      // Recheck with a fresh statement snapshot after acquiring the identity lock.
      const busy=await client.query("SELECT 1 FROM campus_tasks WHERE user_id=$1 AND state='running'",[owner.rows[0].user_id]);
      if (busy.rowCount) return null;
      const capability=randomBytes(32).toString('base64url');
      const task=await client.query(`UPDATE campus_tasks SET state='running',lease=$2,capability_hash=$3,leased_until=now()+interval '90 seconds'
        WHERE id=(SELECT id FROM campus_tasks WHERE user_id=$1 AND generation=(SELECT generation FROM campus_identities WHERE user_id=$1) AND state='pending' AND expires_at>now() ORDER BY created_at,id LIMIT 1)
        RETURNING id,user_id,generation,prompt,lease,delivery_mode`,[owner.rows[0].user_id,randomUUID(),createHash('sha256').update(capability).digest('hex')]);
      if (!task.rowCount) return null;
      const row=task.rows[0]; return {id:row.id,userId:row.user_id,generation:row.generation,prompt:row.prompt,lease:row.lease,capability,deliveryMode:row.delivery_mode};
    });
  }
  private async authorized(client:PoolClient,auth:TaskAuth) {
    const found=await client.query('SELECT user_id FROM campus_tasks WHERE id=$1',[auth.taskId]);
    if (!found.rowCount) throw new Fault(403,'TASK_DENIED');
    const owner=await client.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[found.rows[0].user_id]);
    if(!owner.rowCount) throw new Fault(403,'TASK_REVOKED');
    const task=await client.query(`SELECT * FROM campus_tasks WHERE id=$1 AND lease=$2 AND capability_hash=$3 AND generation=$4
      AND state='running' AND leased_until>now() AND expires_at>now() FOR UPDATE`,
      [auth.taskId,auth.lease,createHash('sha256').update(auth.capability).digest('hex'),owner.rows[0].generation]);
    if(!task.rowCount) throw new Fault(403,'TASK_DENIED');
    return task.rows[0];
  }
  async prepare(auth:TaskAuth,sessionKey:(userId:string,generation:string)=>string) {
    return this.transaction(async client=>{
      const row=await this.authorized(client,auth);
      if(row.started_at) return {accepted:false,status:'duplicate'} as const;
      const key=sessionKey(row.user_id,row.generation);
      await client.query('INSERT INTO campus_conversations(session_key,user_id,generation) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[key,row.user_id,row.generation]);
      await client.query("UPDATE campus_tasks SET started_at=now(),leave_controlled=leave_controlled OR $2 WHERE id=$1",[row.id,row.prompt.trim()==='確認送出']);
      const session=await client.query("SELECT id FROM campus_school_sessions WHERE user_id=$1 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[row.user_id]);
      const isSchoolLoggedIn=Boolean(session.rowCount);
      return {
        accepted:true,
        taskId:row.id,
        lease:auth.lease,
        capability:auth.capability,
        prompt:row.prompt,
        sessionKey:key,
        isSchoolLoggedIn,
        leaveConfirmationRequired:row.prompt.trim()==='確認送出',
        loginMessage:this.loginMessage(),
        loginUrl:this.liffId ? `https://liff.line.me/${this.liffId}` : undefined
      } as const;
    });
  }
  async authorizeTool(auth:TaskAuth):Promise<LeasedTask> {
    return this.transaction(async client=>{
      const row=await this.authorized(client,auth);
      if(!row.started_at) throw new Fault(409,'TASK_NOT_STARTED');
      if(row.tool_calls>=4) throw new Fault(429,'TOOL_BUDGET');
      await client.query('UPDATE campus_tasks SET tool_calls=tool_calls+1 WHERE id=$1',[row.id]);
      return {id:row.id,userId:row.user_id,generation:row.generation,prompt:row.prompt,lease:auth.lease,capability:auth.capability};
    });
  }
  async forCompletion(auth:TaskAuth):Promise<LeasedTask> {
    return this.transaction(async client=>{
      const row=await this.authorized(client,auth);
      if(!row.started_at) throw new Fault(409,'TASK_NOT_STARTED');
      return {id:row.id,userId:row.user_id,generation:row.generation,prompt:row.prompt,lease:auth.lease,capability:auth.capability,leaveControlled:row.leave_controlled};
    });
  }
  async recordEvidence(auth:TaskAuth,sources:VerifiedSource[]):Promise<void> {
    await this.transaction(async client=>{
      const task=await this.authorized(client,auth);
      if(!task.started_at || task.tool_calls===0) throw new Fault(409,'TOOL_NOT_STARTED');
      // Consistent source lock order prevents deadlocks between concurrent searches/completions.
      for(const source of [...sources].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))) {
        await client.query(`INSERT INTO campus_sources(source_id,url,title,current_version,fetched_at,valid_until)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[source.sourceId,source.url,source.title,source.version,source.fetchedAt,source.validUntil]);
        const current=await client.query('SELECT state,url,fetched_at FROM campus_sources WHERE source_id=$1 FOR UPDATE',[source.sourceId]);
        if(!current.rowCount || current.rows[0].state!=='active' || current.rows[0].url!==source.url) throw new Fault(422,'SOURCE_WITHDRAWN');
        // A slow earlier fetch must not supersede a newer publication.
        if(new Date(current.rows[0].fetched_at).getTime()>new Date(source.fetchedAt).getTime()) throw new Fault(409,'SOURCE_SUPERSEDED');
        await client.query(`INSERT INTO campus_source_versions(source_id,version,text,published_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[source.sourceId,source.version,source.text,source.publishedAt]);
        await client.query('UPDATE campus_sources SET title=$2,current_version=$3,fetched_at=$4,valid_until=$5 WHERE source_id=$1',
          [source.sourceId,source.title,source.version,source.fetchedAt,source.validUntil]);
        await client.query(`INSERT INTO campus_task_evidence(task_id,source_id,version,lease,operation) VALUES($1,$2,$3,$4,'web') ON CONFLICT DO NOTHING`,[task.id,source.sourceId,source.version,auth.lease]);
      }
    });
  }
  async recordKnowledgeEvidence(auth:TaskAuth,documents:KnowledgeEvidence[]):Promise<void>{
    await this.transaction(async client=>{
      const task=await this.authorized(client,auth);
      if(!task.started_at)throw new Fault(409,'TASK_NOT_STARTED');
      if(documents.length>30)throw new Fault(422,'TOO_MANY_KNOWLEDGE_RESULTS');
      for(const doc of [...documents].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))){
        const source=await client.query(`SELECT source_id FROM campus_sources WHERE source_id=$1 AND current_version=$2 AND state='active' AND valid_until>now() FOR SHARE`,[doc.sourceId,doc.version]);
        if(!source.rowCount)throw new Fault(422,'UNVERIFIED_SOURCES');
        const chunk=await client.query(`SELECT id FROM campus_knowledge_chunks WHERE source_id=$1 AND version=$2 AND metadata->>'chunkId'=$3 AND text=$4`,[doc.sourceId,doc.version,doc.chunkId,doc.text]);
        if(chunk.rowCount!==1)throw new Fault(422,'UNVERIFIED_KNOWLEDGE_CHUNK');
        await client.query(`INSERT INTO campus_task_evidence(task_id,source_id,version,lease,operation) VALUES($1,$2,$3,$4,'knowledge') ON CONFLICT DO NOTHING`,[task.id,doc.sourceId,doc.version,auth.lease]);
      }
    });
  }
  async fail(task:LeasedTask):Promise<void> {
    await this.transaction(async client=>{
      const owner=await client.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[task.userId]);
      if(!owner.rowCount || String(owner.rows[0].generation)!==String(task.generation)) return;
      const changed=await client.query(`UPDATE campus_tasks SET state='failed',prompt=''
        WHERE id=$1 AND user_id=$2 AND generation=$3 AND lease=$4 AND state='running' RETURNING id,school_login_required,leave_controlled`,[task.id,task.userId,task.generation,task.lease]);
      if(!changed.rowCount) return;
      await client.query('INSERT INTO campus_outbox(id,task_id,user_id,generation,reply) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id) DO NOTHING',
        [randomUUID(),task.id,task.userId,task.generation,changed.rows[0].leave_controlled?LEAVE_FALLBACK:changed.rows[0].school_login_required?this.loginMessage():'目前無法完成查詢，請稍後再試。']);
    });
  }
  // Only a trusted completion service may call this; never expose as a public route.
  async complete(task:LeasedTask,reply:string,sourceIds:string[]=[]):Promise<void> {
    await this.transaction(async client => {
      const owner=await client.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[task.userId]);
      if (!owner.rowCount || String(owner.rows[0].generation)!==String(task.generation)) throw new Fault(403,'TASK_REVOKED');
      const controlled=await client.query('SELECT * FROM campus_tasks WHERE id=$1 AND lease=$2 FOR UPDATE',[task.id,task.lease]);
      if(controlled.rows[0]?.leave_controlled){
        const row=controlled.rows[0];
        const session=await client.query("SELECT id FROM campus_school_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[row.leave_result_session_id,task.userId]);
        const trusted=Boolean(row.leave_result_ciphertext&&session.rowCount),rendered=trusted?this.crypt(row.leave_result_ciphertext,`leave:${task.id}:${task.lease}:${task.generation}:${row.leave_result_state}`,true):LEAVE_FALLBACK;
        const updated=await client.query("UPDATE campus_tasks SET state='completed',prompt='' WHERE id=$1 AND lease=$2 AND capability_hash=$3 AND state='running' AND leased_until>now() AND expires_at>now() RETURNING id",[task.id,task.lease,createHash('sha256').update(task.capability).digest('hex')]);if(!updated.rowCount)throw new Fault(409,'STALE_TASK_LEASE');
        const id=randomUUID();await client.query('INSERT INTO campus_outbox(id,task_id,user_id,generation,reply,encrypted,school_session_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,task.id,task.userId,task.generation,trusted?this.crypt(rendered,id):rendered,trusted,trusted?row.leave_result_session_id:null]);
        await client.query('DELETE FROM campus_private_results WHERE task_id=$1',[task.id]);return;
      }
      if(reply.length>5000)throw new Fault(422,'INVALID_REPLY');
      const ids=[...new Set(sourceIds)].sort();
      const sources=ids.length?await client.query(`SELECT s.source_id,s.url,s.title,s.current_version FROM campus_sources s
        WHERE s.source_id=ANY($1::text[]) AND s.state='active' AND s.valid_until>now()
        AND EXISTS(SELECT 1 FROM campus_task_evidence e WHERE e.source_id=s.source_id AND e.version=s.current_version AND e.task_id=$2 AND e.lease=$3)
        ORDER BY s.source_id FOR SHARE OF s`,[ids,task.id,task.lease]):{rows:[],rowCount:0};
      if(sources.rowCount!==ids.length) throw new Fault(422,'UNVERIFIED_SOURCES');
      const privateRows=await client.query(`SELECT p.* FROM campus_private_results p JOIN campus_school_sessions s ON s.id=p.school_session_id AND s.user_id=$3
        WHERE p.task_id=$1 AND p.lease=$2 AND p.expires_at>now() AND s.expires_at>now() AND s.last_used_at>now()-interval '30 minutes' ORDER BY p.operation FOR SHARE OF s`,[task.id,task.lease,task.userId]);
      const privateCount=await client.query('SELECT count(*)::int n FROM campus_private_results WHERE task_id=$1 AND lease=$2',[task.id,task.lease]);
      if(privateRows.rowCount!==privateCount.rows[0].n)throw new Fault(401,'PRIVATE_RESULT_EXPIRED');
      const sessionIds=[...new Set(privateRows.rows.map(row=>row.school_session_id))];
      if(sessionIds.length>1)throw new Fault(409,'SCHOOL_SESSION_CHANGED');
      const privateReply=privateRows.rows.map(row=>this.crypt(row.encrypted_reply,`${task.id}:${task.lease}:${row.operation}`,true)).join('\n\n');
      const currentTask=(await client.query('SELECT school_login_required FROM campus_tasks WHERE id=$1 AND lease=$2',[task.id,task.lease])).rows[0];
      const loginNotice=currentTask?.school_login_required?this.loginMessage():'';
      // Login URLs are trusted local results, never replaced by an outer model's credential link.
      const replyContent = currentTask?.school_login_required ? '' : reply.trim();
      const rendered = [
        replyContent ? replyContent : privateReply,
        (!replyContent && loginNotice) ? loginNotice : ''
      ].filter(Boolean).join('\n\n') + (ids.length ? '\n\n來源：\n' + sources.rows.map(s => `${s.title}\n${s.url}`).join('\n') : '');
      if(!rendered.trim() || rendered.length>5000) throw new Fault(422,'REPLY_TOO_LONG');
      const updated=await client.query(`UPDATE campus_tasks SET state='completed',prompt=''
        WHERE id=$1 AND user_id=$2 AND generation=$3 AND lease=$4 AND capability_hash=$5 AND state='running' AND leased_until>now() AND expires_at>now() RETURNING id`,
        [task.id,task.userId,task.generation,task.lease,createHash('sha256').update(task.capability).digest('hex')]);
      if (!updated.rowCount) throw new Fault(409,'STALE_TASK_LEASE');
      const outboxId=randomUUID();
      await client.query('INSERT INTO campus_outbox(id,task_id,user_id,generation,reply,encrypted,school_session_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [outboxId,task.id,task.userId,task.generation,privateReply?this.crypt(rendered,outboxId):rendered,Boolean(privateReply),sessionIds[0]??null]);
      await client.query('DELETE FROM campus_private_results WHERE task_id=$1',[task.id]);
      for(const source of sources.rows) await client.query('INSERT INTO campus_outbox_sources(outbox_id,source_id,version) VALUES($1,$2,$3)',[outboxId,source.source_id,source.current_version]);
    });
  }
  private async presented(c:PoolClient,taskId:string){await c.query(`UPDATE campus_leave_previews p SET presented_at=clock_timestamp() FROM campus_tasks t WHERE t.id=$1 AND p.id=t.leave_preview_id AND p.origin_task_id=t.id AND t.state='completed' AND t.leave_result_state='pending' AND p.state='pending' AND p.expires_at>clock_timestamp() AND p.presented_at IS NULL`,[taskId]);}
  async enqueueCapture(runId:string,userId:string,sessionId:string,prompt:string,expectedGeneration?:string){
    if(!/^[a-f0-9-]{36}$/.test(runId)||!prompt.trim()||prompt.length>2000)throw new Fault(400,'CAPTURE_DENIED');
    return this.transaction(async c=>{
      const owner=await c.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[userId]);if(!owner.rowCount)throw new Fault(403,'CAPTURE_DENIED');
      if(expectedGeneration!==undefined&&String(owner.rows[0].generation)!==expectedGeneration)throw new Fault(403,'CAPTURE_GENERATION_CHANGED');
      const session=await c.query("SELECT id FROM campus_school_sessions WHERE user_id=$1 AND id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[userId,sessionId]);if(!session.rowCount)throw new Fault(401,'SCHOOL_LOGIN_REQUIRED');
      const id=randomUUID(),event=`capture:${runId}:${id}`;
      await c.query('INSERT INTO campus_inbox(event_id,user_id) VALUES($1,$2)',[event,userId]);
      // No committed LINE-mode window exists, even with a live worker.
      await c.query("INSERT INTO campus_tasks(id,event_id,user_id,generation,prompt,delivery_mode,created_at) VALUES($1,$2,$3,$4,$5,'capture',clock_timestamp())",[id,event,userId,owner.rows[0].generation,prompt]);
      await bindLeaveConfirmation(c,userId,owner.rows[0].generation,id,prompt);return id;
    });
  }
  private async capture(c:PoolClient,runId:string,taskId:string,userId:string,sessionId:string){
    const owner=await c.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[userId]);if(!owner.rowCount)throw new Fault(403,'CAPTURE_DENIED');
    const task=await c.query("SELECT * FROM campus_tasks WHERE id=$1 AND user_id=$2 AND generation=$3 AND delivery_mode='capture' AND event_id=$4 AND state='completed' AND created_at>now()-interval '5 minutes' FOR UPDATE",[taskId,userId,owner.rows[0].generation,`capture:${runId}:${taskId}`]);if(!task.rowCount)throw new Fault(409,'CAPTURE_NOT_READY');
    const session=await c.query("SELECT id FROM campus_school_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[sessionId,userId]);if(!session.rowCount)throw new Fault(401,'SCHOOL_LOGIN_REQUIRED');
    const q=await c.query("SELECT * FROM campus_outbox WHERE task_id=$1 AND state='pending' FOR UPDATE",[taskId]);const row=q.rows[0];if(!row||!row.encrypted||row.school_session_id!==sessionId)throw new Fault(403,'CAPTURE_DENIED');return row;
  }
  async captureResult(runId:string,taskId:string,userId:string,sessionId:string){return this.transaction(async c=>{const row=await this.capture(c,runId,taskId,userId,sessionId);return this.crypt(row.reply,row.id,true);});}
  async ackCapture(runId:string,taskId:string,userId:string,sessionId:string,expectedReply:string){return this.transaction(async c=>{const row=await this.capture(c,runId,taskId,userId,sessionId);if(this.crypt(row.reply,row.id,true)!==expectedReply)throw new Fault(403,'CAPTURE_REPLY_CHANGED');await c.query("UPDATE campus_outbox SET state='sent',reply='' WHERE id=$1",[row.id]);await this.presented(c,taskId);});}
  async deliverOne(send:(userId:string,reply:string,retryKey:string)=>Promise<void>):Promise<boolean> {
    return this.transaction(async client => {
      const owner=await client.query(`SELECT i.user_id,i.generation FROM campus_identities i WHERE NOT i.revoked
        AND EXISTS(SELECT 1 FROM campus_outbox o WHERE o.user_id=i.user_id AND o.generation=i.generation AND o.state='pending' AND o.next_attempt_at<=now() AND EXISTS(SELECT 1 FROM campus_tasks t WHERE t.id=o.task_id AND t.delivery_mode='line'))
        ORDER BY i.user_id FOR UPDATE OF i SKIP LOCKED LIMIT 1`);
      if (!owner.rowCount) return false;
      const selected=await client.query(`SELECT * FROM campus_outbox WHERE user_id=$1 AND generation=$2 AND state='pending' AND next_attempt_at<=now() AND EXISTS(SELECT 1 FROM campus_tasks t WHERE t.id=campus_outbox.task_id AND t.delivery_mode='line') ORDER BY created_at,id FOR UPDATE LIMIT 1`,
        [owner.rows[0].user_id,owner.rows[0].generation]);
      if (!selected.rowCount) return false;
      const row=selected.rows[0];
      // A retry key is valid for 24h at LINE; stop conservatively before that boundary.
      if (Date.now()-new Date(row.created_at).getTime()>=23*60*60*1000 || row.attempts>=8) {
        await client.query("UPDATE campus_outbox SET state='failed',reply='' WHERE id=$1",[row.id]); return true;
      }
      if(row.encrypted){
        const session=await client.query("SELECT id FROM campus_school_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR SHARE",[row.school_session_id,row.user_id]);
        if(!session.rowCount){await client.query("UPDATE campus_outbox SET state='cancelled',reply='' WHERE id=$1",[row.id]);return true;}
      }
      const links=await client.query('SELECT source_id,version FROM campus_outbox_sources WHERE outbox_id=$1 ORDER BY source_id',[row.id]);
      if(links.rowCount) {
        const available=await client.query(`SELECT source_id,current_version,state,valid_until FROM campus_sources WHERE source_id=ANY($1::text[]) ORDER BY source_id FOR SHARE`,[links.rows.map(link=>link.source_id)]);
        if(available.rowCount!==links.rowCount || available.rows.some((source,index)=>source.state!=='active' || source.current_version!==links.rows[index].version || new Date(source.valid_until).getTime()<=Date.now())) {
          // Keep the original retry payload immutable: cancel stale factual delivery instead of changing it.
          await client.query("UPDATE campus_outbox SET state='cancelled',reply='' WHERE id=$1",[row.id]);return true;
        }
      }
      try {
        // Hold the identity lock through the bounded provider call: revoke cannot overtake a send.
        await send(row.user_id,row.encrypted?this.crypt(row.reply,row.id,true):row.reply,row.id);
        await client.query("UPDATE campus_outbox SET state='sent',reply='',attempts=attempts+1 WHERE id=$1",[row.id]);
        await this.presented(client,row.task_id);
      } catch(error) {
        const permanent=error instanceof Fault && error.status<500;
        await client.query(`UPDATE campus_outbox SET state=$2,reply=CASE WHEN $2='failed' THEN '' ELSE reply END,
          attempts=attempts+1,next_attempt_at=now()+interval '30 seconds' WHERE id=$1`,[row.id,permanent?'failed':'pending']);
      }
      return true;
    });
  }
  async cleanup():Promise<void> {
    await this.transaction(async client => {
      await client.query("DELETE FROM campus_private_results WHERE expires_at<=now() OR task_id IN (SELECT id FROM campus_tasks WHERE state<>'running')");
      // An expired generation cannot be reused, even if an in-flight memory node writes late.
      await client.query("DELETE FROM live_agent_chat_histories WHERE created_at<now()-interval '7 days'");
      await client.query(`WITH expired AS (
        UPDATE campus_tasks SET state='failed',prompt='' WHERE
          (state='pending' AND expires_at<=now()) OR (state='running' AND leased_until<=now())
        RETURNING id,user_id,generation,leave_controlled)
        INSERT INTO campus_outbox(id,task_id,user_id,generation,reply)
        SELECT gen_random_uuid(),t.id,t.user_id,t.generation,CASE WHEN t.leave_controlled THEN '本次請假尚未取得可確認的結果；請至校務後台查看，系統不會自動再次送出。' ELSE '目前無法完成查詢，請稍後再試。' END
        FROM expired t JOIN campus_identities i ON i.user_id=t.user_id AND i.generation=t.generation
        WHERE NOT i.revoked ON CONFLICT(task_id) DO NOTHING`);
      await client.query("UPDATE campus_outbox SET state='failed',reply='' WHERE state IN ('pending','sending') AND created_at<now()-interval '23 hours'");
      await client.query("UPDATE campus_outbox SET reply='',state='cancelled' WHERE task_id IN (SELECT id FROM campus_tasks WHERE delivery_mode='capture') AND created_at<now()-interval '5 minutes' AND state='pending'");
      await client.query("UPDATE campus_tasks SET leave_result_ciphertext=NULL WHERE created_at<now()-interval '7 days' OR (delivery_mode='capture' AND created_at<now()-interval '5 minutes')");
      await client.query("UPDATE campus_tasks t SET leave_result_ciphertext=NULL WHERE t.leave_result_ciphertext IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_school_sessions s WHERE s.id=t.leave_result_session_id AND s.user_id=t.user_id AND s.encrypted_cookies<>'' AND s.expires_at>now() AND s.last_used_at>now()-interval '30 minutes')");
      await client.query("DELETE FROM campus_outbox WHERE created_at<now()-interval '7 days'");
      await client.query("DELETE FROM campus_tasks t WHERE created_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM campus_outbox o WHERE o.task_id=t.id)");
      await client.query("DELETE FROM campus_inbox i WHERE received_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM campus_tasks t WHERE t.event_id=i.event_id)");
    });
  }
}
