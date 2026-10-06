import { z } from 'zod';
import { Fault } from '../../utils/fault.js';
import type { LeasedTask } from './task.repository.js';
const result=z.object({status:z.enum(['queued','duplicate','unavailable'])});
export class DispatchProvider {
  constructor(private readonly url:string,private readonly token:string,private readonly request:typeof fetch=fetch) {
    const target=new URL(url);
    if (!['http:','https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash)
      throw new Error('INVALID_N8N_WEBHOOK_URL');
  }
  async dispatch(task:LeasedTask,signal:AbortSignal):Promise<void> {
    // The prompt, LINE user ID, and generation are read at the authenticated prepare endpoint.
    const response=await this.request(this.url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(95_000)]),
      headers:{'content-type':'application/json','X-Campus-Webhook':this.token},
      body:JSON.stringify({taskId:task.id,lease:task.lease,capability:task.capability})});
    if(!response.ok) throw new Fault(503,'AGENT_UNAVAILABLE');
    const parsed=result.safeParse(await response.json());
    if(!parsed.success || parsed.data.status==='unavailable') throw new Fault(503,'AGENT_UNAVAILABLE');
  }
}
