import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {SessionCrypto} from './session.crypto.js';
import {SchoolError} from '../../utils/school-error.js';
export type LoginFailure='technical_failure'|'credentials_rejected'|'account_locked'|'authentication_rejected';
export type LoginLease={id:string;userId:string;accountHash:string;generation:string};
export type StoredSchoolSession={id:string;cookies:string};
export class SchoolSessionRepository {
 constructor(private readonly pool:Pool,private readonly crypto:SessionCrypto){}
 private async transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await this.pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 private async owner(client:PoolClient,userId:string){
  const row=await client.query('SELECT generation FROM campus_identities WHERE user_id=$1 AND invited AND NOT revoked FOR SHARE',[userId]);
  if(!row.rowCount)throw new SchoolError('SCHOOL_IDENTITY_DENIED');return String(row.rows[0].generation);
 }
 async beginLogin(userId:string,account:string):Promise<LoginLease>{
  const accountHash=this.crypto.accountHash(account);
  return this.transaction(async client=>{
   // Always lock in deterministic order for shared-account and shared-user attempts.
   for(const key of [`school:account:${accountHash}`,`school:user:${userId}`].sort())await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
   const generation=await this.owner(client,userId);
   await client.query('DELETE FROM campus_school_login_jobs WHERE expires_at<=now()');
   const busy=await client.query('SELECT 1 FROM campus_school_login_jobs WHERE user_id=$1 OR account_hash=$2',[userId,accountHash]);
   if(busy.rowCount)throw new SchoolError('SCHOOL_LOGIN_BUSY');
   // Count explicit school login rejections, including unknown nonzero auth
   // errors, separately from OCR/transport/parser failures and legacy outcomes.
   const count=await client.query("SELECT count(*)::int AS n,bool_or(outcome='account_locked') AS locked FROM campus_school_login_attempts WHERE completed_at>now()-interval '15 minutes' AND outcome IN ('credentials_rejected','account_locked','authentication_rejected') AND (user_id=$1 OR account_hash=$2)",[userId,accountHash]);
   if(count.rows[0].locked)throw new SchoolError('SCHOOL_ACCOUNT_LOCKED');
   if(count.rows[0].n>=2)throw new SchoolError('SCHOOL_LOGIN_RATE_LIMIT');
   const bound=await client.query('SELECT user_id FROM campus_school_sessions WHERE account_hash=$1',[accountHash]);
   if(bound.rowCount && bound.rows[0].user_id!==userId)throw new SchoolError('SCHOOL_ACCOUNT_ALREADY_BOUND');
   const id=randomUUID();
   await client.query('INSERT INTO campus_school_login_attempts(id,user_id,account_hash) VALUES($1,$2,$3)',[id,userId,accountHash]);
   await client.query('INSERT INTO campus_school_login_jobs(id,user_id,account_hash,generation) VALUES($1,$2,$3,$4)',[id,userId,accountHash,generation]);
   return {id,userId,accountHash,generation};
  });
 }
 async finishLogin(lease:LoginLease,cookies:string):Promise<string>{
  if(cookies.length>128*1024)throw new SchoolError('SCHOOL_SESSION_TOO_LARGE');
  return this.transaction(async client=>{
   const generation=await this.owner(client,lease.userId);
   if(generation!==lease.generation)throw new SchoolError('SCHOOL_LOGIN_CANCELLED');
   const job=await client.query('SELECT 1 FROM campus_school_login_jobs WHERE id=$1 AND user_id=$2 AND account_hash=$3 AND generation=$4 AND expires_at>now() FOR UPDATE',[lease.id,lease.userId,lease.accountHash,lease.generation]);
   if(!job.rowCount)throw new SchoolError('SCHOOL_LOGIN_CANCELLED');
   const id=randomUUID(),encrypted=this.crypto.seal(cookies,lease.userId,id);
   // Unique account_hash also guards two distinct owners completing concurrently.
   try{await client.query(`INSERT INTO campus_school_sessions(user_id,id,account_hash,encrypted_cookies) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id) DO UPDATE SET id=EXCLUDED.id,account_hash=EXCLUDED.account_hash,encrypted_cookies=EXCLUDED.encrypted_cookies,created_at=now(),last_used_at=now(),expires_at=now()+interval '8 hours'`,[lease.userId,id,lease.accountHash,encrypted]);}
   catch(error){if((error as {code?:string}).code==='23505')throw new SchoolError('SCHOOL_ACCOUNT_ALREADY_BOUND');throw error;}
   await client.query("UPDATE campus_school_login_attempts SET outcome='success',completed_at=now() WHERE id=$1 AND user_id=$2 AND outcome='pending'",[lease.id,lease.userId]);
   await client.query('DELETE FROM campus_school_login_jobs WHERE id=$1',[lease.id]);return id;
  });
 }
 async cancelLogin(lease:LoginLease,outcome:LoginFailure='technical_failure'){
  await this.transaction(async client=>{
   await client.query("UPDATE campus_school_login_attempts SET outcome=$3,completed_at=now() WHERE id=$1 AND user_id=$2 AND outcome='pending'",[lease.id,lease.userId,outcome]);
   await client.query('DELETE FROM campus_school_login_jobs WHERE id=$1 AND user_id=$2',[lease.id,lease.userId]);
  });
 }
 async session(userId:string):Promise<StoredSchoolSession>{
  return this.transaction(async client=>{
   await this.owner(client,userId);
   const found=await client.query("UPDATE campus_school_sessions SET last_used_at=now() WHERE user_id=$1 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' RETURNING id,encrypted_cookies",[userId]);
   if(!found.rowCount)throw new SchoolError('SCHOOL_LOGIN_REQUIRED');
   const {id,encrypted_cookies}=found.rows[0];return {id,cookies:this.crypto.open(encrypted_cookies,userId,id)};
  });
 }
 async withSession<T>(userId:string,handler:(session:StoredSchoolSession)=>Promise<{cookies:string;data:T}>):Promise<T>{
  return this.transaction(async client=>{
   await this.owner(client,userId);
   // The row lock serializes cookie mutation across parallel tools and adapter processes.
   const found=await client.query("SELECT id,encrypted_cookies FROM campus_school_sessions WHERE user_id=$1 AND expires_at>now() AND last_used_at>now()-interval '30 minutes' FOR UPDATE",[userId]);
   if(!found.rowCount)throw new SchoolError('SCHOOL_LOGIN_REQUIRED');
   const {id,encrypted_cookies}=found.rows[0];
   const result=await handler({id,cookies:this.crypto.open(encrypted_cookies,userId,id)});
   if(result.cookies.length>128*1024)throw new SchoolError('SCHOOL_SESSION_TOO_LARGE');
   const changed=await client.query("UPDATE campus_school_sessions SET encrypted_cookies=$3,last_used_at=now() WHERE user_id=$1 AND id=$2 AND expires_at>clock_timestamp() AND last_used_at>clock_timestamp()-interval '30 minutes'",[userId,id,this.crypto.seal(result.cookies,userId,id)]);
   if(!changed.rowCount)throw new SchoolError('SCHOOL_LOGIN_REQUIRED');return result.data;
  });
 }
 async invalidate(userId:string,id:string){await this.pool.query("UPDATE campus_school_sessions SET encrypted_cookies='',expires_at=now() WHERE user_id=$1 AND id=$2",[userId,id]);}
 async cleanup(){
  await this.pool.query("UPDATE campus_school_sessions SET encrypted_cookies='' WHERE encrypted_cookies<>'' AND (expires_at<=now() OR last_used_at<=now()-interval '30 minutes')");
  await this.pool.query('DELETE FROM campus_school_login_jobs WHERE expires_at<=now()');
  await this.pool.query("DELETE FROM campus_school_login_attempts WHERE created_at<=now()-interval '30 minutes'");
 }
}
