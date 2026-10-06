import {createHash,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {Fault} from '../../utils/fault.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class BindingRepository {
 constructor(private readonly pool:Pool){}
  async issue(userId:string){
   const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
   const client=await this.pool.connect();
   try{
    await client.query('BEGIN');
    await client.query('INSERT INTO campus_identities(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[userId]);
    const owner=await client.query('SELECT generation,revoked FROM campus_identities WHERE user_id=$1 FOR UPDATE',[userId]);
    if(owner.rows[0].revoked)throw new Fault(403,'BINDING_REVOKED');
    // One browser session per user; logging in rotates the previous browser credential.
    await client.query('DELETE FROM campus_liff_sessions WHERE user_id=$1 OR expires_at<=now()',[userId]);
    await client.query('INSERT INTO campus_liff_sessions(token_hash,csrf_hash,user_id,generation) VALUES($1,$2,$3,$4)',[hash(token),hash(csrf),userId,owner.rows[0].generation]);
    await client.query('COMMIT');return {token,csrf};
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async authorize(token:string,csrf:string){
   if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!/^[A-Za-z0-9_-]{43}$/.test(csrf))throw new Fault(401,'LIFF_SESSION_REQUIRED');
   const result=await this.pool.query(`SELECT s.user_id FROM campus_liff_sessions s JOIN campus_identities i ON i.user_id=s.user_id
    WHERE s.token_hash=$1 AND s.csrf_hash=$2 AND s.expires_at>now() AND NOT i.revoked AND i.generation=s.generation`,[hash(token),hash(csrf)]);
   if(!result.rowCount)throw new Fault(401,'LIFF_SESSION_REQUIRED');return String(result.rows[0].user_id);
  }
}
