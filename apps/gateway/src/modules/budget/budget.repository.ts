import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Fault } from '../../utils/fault.js';
export class BudgetRepository {
  constructor(private readonly pool:Pool,private readonly dailyMicroUsd:number,private readonly totalMicroUsd:number=dailyMicroUsd) {
    if(![dailyMicroUsd,totalMicroUsd].every(value=>Number.isSafeInteger(value) && value>=0)) throw Error('INVALID_DAILY_BUDGET');
  }
  async recordTokenOnlyResponse(id:string,status:number){
    if(!Number.isInteger(status)||status<200||status>599)throw new Fault(503,'INVALID_PROVIDER_STATUS');
    // Official Gemini billing FAQ exempts token charges for exactly HTTP 400/500.
    // This method is ONLY for the token-only relay, never Google Search/other paid tools.
    // Preserve one microUSD to satisfy the existing positive ledger invariant.
    await this.pool.query(`UPDATE campus_usage_reservations SET upstream_status=$2,
      amount_micro_usd=CASE WHEN $2 IN (400,500) THEN 1 ELSE amount_micro_usd END,
      settlement_basis=CASE WHEN $2 IN (400,500) THEN 'google_token_only_http_error' ELSE settlement_basis END,
      settled_at=CASE WHEN $2 IN (400,500) THEN now() ELSE settled_at END
      WHERE id=$1 AND provider IN ('gemini','embedding') AND upstream_status IS NULL`,[id,status]);
  }
  async settle(id:string,confirmedUpperMicroUsd:number){
    if(!Number.isSafeInteger(confirmedUpperMicroUsd)||confirmedUpperMicroUsd<0)throw new Fault(503,'INVALID_PROVIDER_USAGE');
    // Only confirmed successful provider usage may release excess reservation.
    // Ambiguous, failed or missing usage responses retain their full charge bound.
    await this.pool.query("UPDATE campus_usage_reservations SET amount_micro_usd=$2,settlement_basis='reported_token_upper_bound',settled_at=now() WHERE id=$1 AND amount_micro_usd>=$2",[id,Math.max(1,confirmedUpperMicroUsd)]);
  }
  async reserve(taskId:string|null,provider:'gemini'|'embedding'|'brave',maxCostMicroUsd:number):Promise<string> {
    if(!Number.isSafeInteger(maxCostMicroUsd) || maxCostMicroUsd<=0) throw new Fault(503,'PROVIDER_PRICE_REQUIRED');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('campus-shared-provider-budget'))");
      const total=await client.query(`SELECT COALESCE(sum(amount_micro_usd),0)::text total,
        COALESCE(sum(amount_micro_usd) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei'),0)::text amount
        FROM campus_usage_reservations`);
      if(BigInt(total.rows[0].amount)+BigInt(maxCostMicroUsd)>BigInt(this.dailyMicroUsd)) throw new Fault(429,'DAILY_PROVIDER_BUDGET');
      if(BigInt(total.rows[0].total)+BigInt(maxCostMicroUsd)>BigInt(this.totalMicroUsd)) throw new Fault(429,'TOTAL_PROVIDER_BUDGET');
      const id=randomUUID();
      await client.query('INSERT INTO campus_usage_reservations(id,task_id,provider,amount_micro_usd) VALUES($1,$2,$3,$4)',[id,taskId,provider,maxCostMicroUsd]);
      await client.query('COMMIT');return id;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
}
