import {randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {LeaveAuth,LeaveIntent,LeaveReceipt} from '../../../../shared/leave-contract.js';
import {LeaveCrypto,type LeaveBinding} from './leave.crypto.js';
import type {LeaveRow} from './leave.parse.js';
export type LeavePayload={intent:LeaveIntent;rows:LeaveRow[];code:number};
export type LeaveTask={id:string;user_id:string;generation:string;prompt:string;created_at:Date;leased_until:Date;sessionId:string};
export type LeavePending=LeaveBinding & {state:string;preview_task_id:string|null;preview_lease:string;expires_at:Date;presented_at:Date|null;encrypted_payload:string|null;attempt_id:string|null;confirm_origin_task_id:string|null;confirm_task_id:string|null;confirm_lease:string|null};
export class LeaveRepository {
 constructor(private readonly pool:Pool,readonly crypto:LeaveCrypto){}
 async transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(error){await c.query('ROLLBACK');if(error instanceof Error&&/^LEAVE_[A-Z_]+$/.test(error.message))throw error;throw Error('LEAVE_TRANSACTION_DENIED');}finally{c.release();}}
 async guard(c:PoolClient,auth:LeaveAuth,expectedSession?:string):Promise<LeaveTask>{
  const found=await c.query('SELECT user_id FROM campus_tasks WHERE id=$1',[auth.taskId]);if(!found.rowCount)throw Error('LEAVE_TASK_DENIED');
  const owner=await c.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND NOT revoked FOR UPDATE',[found.rows[0].user_id]);if(!owner.rowCount)throw Error('LEAVE_TASK_DENIED');
  const task=await c.query(`SELECT * FROM campus_tasks WHERE id=$1 AND lease=$2 AND capability_hash=$3 AND generation=$4 AND state='running' AND started_at IS NOT NULL AND tool_calls>0 AND expires_at>clock_timestamp() AND leased_until>clock_timestamp() FOR UPDATE`,[auth.taskId,auth.lease,createHash('sha256').update(auth.capability).digest('hex'),owner.rows[0].generation]);
  if(!task.rowCount)throw Error('LEAVE_TASK_DENIED');
  const session=await c.query("SELECT id FROM campus_school_sessions WHERE user_id=$1 AND expires_at>clock_timestamp() AND last_used_at>clock_timestamp()-interval '30 minutes' FOR UPDATE",[found.rows[0].user_id]);
  if(!session.rowCount||(expectedSession&&session.rows[0].id!==expectedSession))throw Error('LEAVE_SESSION_CHANGED');
  return {...task.rows[0],generation:String(task.rows[0].generation),sessionId:session.rows[0].id};
 }
 validate(auth:LeaveAuth){return this.transaction(c=>this.guard(c,auth));}
 async pending(c:PoolClient,t:LeaveTask){const q=await c.query('SELECT * FROM campus_leave_previews WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[t.user_id]);return q.rows[0] as LeavePending|undefined;}
 async beginPreview(auth:LeaveAuth){return this.transaction(async c=>{
  const t=await this.guard(c,auth);if(t.prompt.trim()==='確認送出')throw Error('LEAVE_CONFIRM_CANNOT_PREVIEW');
  const unresolved=await c.query("SELECT 1 FROM campus_leave_previews WHERE user_id=$1 AND state IN ('attempted','ambiguous')",[t.user_id]);if(unresolved.rowCount)throw Error('LEAVE_UNRESOLVED');
  await c.query("UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND state='pending' AND origin_task_id<>$2",[t.user_id,t.id]);
  return t;
 });}
 async save(auth:LeaveAuth,t:LeaveTask,payload:LeavePayload):Promise<LeavePending>{return this.transaction(async c=>{
  await this.guard(c,auth,t.sessionId);
  const existing=await c.query('SELECT * FROM campus_leave_previews WHERE origin_task_id=$1 FOR UPDATE',[t.id]);
  if(existing.rowCount){const row=existing.rows[0] as LeavePending;if(row.state!=='pending'||!row.encrypted_payload||this.crypto.open(row.encrypted_payload,row,'payload')!==JSON.stringify(payload))throw Error('LEAVE_PREVIEW_REPLAY_DENIED');return row;}
  const unresolved=await c.query("SELECT 1 FROM campus_leave_previews WHERE user_id=$1 AND state IN ('attempted','ambiguous')",[t.user_id]);if(unresolved.rowCount)throw Error('LEAVE_UNRESOLVED');
  const b:LeaveBinding={id:randomUUID(),user_id:t.user_id,generation:t.generation,school_session_id:t.sessionId,origin_task_id:t.id};
  const q=await c.query(`INSERT INTO campus_leave_previews(id,user_id,generation,school_session_id,origin_task_id,preview_task_id,preview_lease,state,encrypted_payload) VALUES($1,$2,$3,$4,$5,$5,$6,'pending',$7) RETURNING *`,[b.id,b.user_id,b.generation,b.school_session_id,b.origin_task_id,auth.lease,this.crypto.seal(JSON.stringify(payload),b,'payload')]);return q.rows[0];
 });}
 async confirmPending(c:PoolClient,auth:LeaveAuth,t:LeaveTask):Promise<LeavePending>{
  if(t.prompt.trim()!=='確認送出')throw Error('LEAVE_EXACT_CONFIRM_REQUIRED');
  const p=await this.pending(c,t);if(!p||p.state!=='pending'||String(p.generation)!==t.generation||p.school_session_id!==t.sessionId||p.origin_task_id===t.id||p.confirm_task_id!==t.id||!p.presented_at||new Date(t.created_at)<=new Date(p.presented_at)||new Date(p.expires_at)<=new Date())throw Error('LEAVE_PENDING_UNAVAILABLE');
  const ready=await c.query("SELECT 1 FROM campus_tasks WHERE id=$1 AND lease=$2 AND state='completed'",[p.preview_task_id,p.preview_lease]);if(!ready.rowCount)throw Error('LEAVE_PENDING_UNAVAILABLE');return p;
 }
 async cancel(auth:LeaveAuth,p:LeavePending){await this.transaction(async c=>{await this.guard(c,auth,p.school_session_id);await c.query("UPDATE campus_leave_previews SET state='cancelled',encrypted_payload=NULL WHERE id=$1 AND state='pending'",[p.id]);});}
 async attempt(auth:LeaveAuth,p:LeavePending,before:number[]):Promise<string>{return this.transaction(async c=>{
  const t=await this.guard(c,auth,p.school_session_id);if(new Date(t.leased_until).getTime()-Date.now()<40000)throw Error('LEAVE_LEASE_TOO_SHORT');
  const current=await this.confirmPending(c,auth,t);if(current.id!==p.id)throw Error('LEAVE_PENDING_CHANGED');const id=randomUUID();
  const winner=await c.query(`UPDATE campus_leave_previews SET state='attempted',attempt_id=$2,attempted_at=now(),confirm_task_id=$3,confirm_origin_task_id=$3,confirm_lease=$4,encrypted_before_ids=$5 WHERE id=$1 AND state='pending' AND confirm_task_id=$3 AND expires_at>clock_timestamp() RETURNING id`,[p.id,id,t.id,auth.lease,this.crypto.seal(JSON.stringify(before),p,'before')]);if(!winner.rowCount)throw Error('LEAVE_ATTEMPT_DENIED');return id;
 });}
 async finish(p:LeavePending,attempt:string,receipt:LeaveReceipt,evidence:string){
  // Terminal result can only fill its own durable attempt; never restore pending.
  const done=await this.pool.query(`UPDATE campus_leave_previews SET state=$3,finished_at=now(),outcome_code=$4,encrypted_outcome=$5 WHERE id=$1 AND attempt_id=$2 AND state='attempted'`,[p.id,attempt,receipt.state,receipt.code,this.crypto.seal(JSON.stringify({receipt,evidence}),p,'outcome')]);
  if(done.rowCount!==1)throw Error('LEAVE_FINISH_DENIED');
 }
 payload(p:LeavePending):LeavePayload{if(!p.encrypted_payload)throw Error('LEAVE_PAYLOAD_UNAVAILABLE');try{return JSON.parse(this.crypto.open(p.encrypted_payload,p,'payload'));}catch{throw Error('LEAVE_PAYLOAD_UNAVAILABLE');}}
 async cleanup(){
  await this.pool.query("UPDATE campus_leave_previews SET state='expired',encrypted_payload=NULL WHERE state='pending' AND expires_at<=now()");
  await this.pool.query("UPDATE campus_leave_previews SET state='ambiguous',outcome_code='LEAVE_INTERRUPTED' WHERE state='attempted' AND attempted_at<now()-interval '2 minutes'");
  await this.pool.query("UPDATE campus_leave_previews SET encrypted_payload=NULL,encrypted_before_ids=NULL,encrypted_outcome=NULL WHERE created_at<now()-interval '7 days'");
  await this.pool.query("DELETE FROM campus_leave_previews WHERE created_at<now()-interval '7 days' AND state NOT IN ('attempted','ambiguous')");
 }
}
