import { randomUUID, createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Fault } from '../../utils/fault.js';

export class LineRepository {
  constructor(private readonly pool: Pool, private readonly sessionSecret: string,private readonly liffId?:string) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  sessionKey(userId: string, generation: string | number): string {
    return `line:${createHmac('sha256', this.sessionSecret).update(`${userId}:${generation}`).digest('hex')}`;
  }
  private async ensureOwner(client: PoolClient, userId: string): Promise<{ generation: string | number; revoked: boolean }> {
    // Public access: first contact creates the identity; concurrent first contacts converge on one row.
    await client.query('INSERT INTO campus_identities(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
    const owner = await client.query('SELECT generation,revoked FROM campus_identities WHERE user_id=$1 FOR UPDATE', [userId]);
    const row = owner.rows[0];
    if (!row) throw new Fault(500, 'IDENTITY_UNAVAILABLE');
    return row;
  }
  async identity(userId: string): Promise<{ sessionKey: string }> {
    return this.transaction(async client => {
      const owner = await this.ensureOwner(client, userId);
      if (owner.revoked) throw new Fault(403, 'BINDING_REVOKED');
      return { sessionKey: this.sessionKey(userId, owner.generation) };
    });
  }
  async accept(eventId: string, userId: string, prompt: string, command: 'message'|'clear'|'revoke'|'resume'|'follow'): Promise<void> {
    await this.transaction(async client => {
      const owner = await this.ensureOwner(client, userId);
      if (owner.revoked && command !== 'revoke' && command!=='resume') return;
      const inserted = await client.query('INSERT INTO campus_inbox(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [eventId,userId]);
      if (!inserted.rowCount) return;
      const generation = owner.generation;
      if(command==='resume'||command==='follow'){
        // The guard above admits follow only for active/new identities.
        // Only the exact signed one-to-one resume command can undo revocation.
        // School cookies remain deleted; resuming never restores an earlier school session.
        const renewed=owner.revoked?await client.query('UPDATE campus_identities SET generation=generation+1,revoked=false WHERE user_id=$1 RETURNING generation',[userId]):{rows:[{generation}]};
        const current=renewed.rows[0].generation,id=randomUUID();
        await client.query("INSERT INTO campus_tasks(id,event_id,user_id,generation,prompt,state) VALUES($1,$2,$3,$4,'','completed')",[id,eventId,userId,current]);
        const reply='已啟用校園助理。查詢本人資料前，請重新開啟 LIFF 並登入學校帳號；先前的校務登入不會恢復。'+(this.liffId?'\nhttps://liff.line.me/'+this.liffId:'');
        await client.query('INSERT INTO campus_outbox(id,task_id,user_id,generation,reply) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,userId,current,reply]);
        return;
      }
      if (command !== 'message') {
        await client.query('UPDATE campus_identities SET generation=generation+1,revoked=$2 WHERE user_id=$1', [userId, command === 'revoke']);
        await client.query('DELETE FROM live_agent_chat_histories WHERE session_id IN (SELECT session_key FROM campus_conversations WHERE user_id=$1)', [userId]);
        await client.query("UPDATE campus_tasks SET state='cancelled',prompt='' WHERE user_id=$1 AND state IN ('pending','running')", [userId]);
        await client.query("UPDATE campus_outbox SET state='cancelled',reply='' WHERE user_id=$1 AND state IN ('pending','sending')", [userId]);
        return;
      }
      await client.query('INSERT INTO campus_tasks(id,event_id,user_id,generation,prompt) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(),eventId,userId,generation,prompt]);
    });
  }
}
