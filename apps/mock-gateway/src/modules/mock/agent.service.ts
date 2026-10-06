import { randomUUID } from 'node:crypto';
import { Fault } from '../../constants/index.js';

// Only synthetic fixtures cross this boundary. Production inbox and retrieval are later phases.
export const agentPrompts = {
  knowledge: '請查詢合成校園知識庫的借書規則。',
  web: '請搜尋合成官方網站的今日開館時間。',
  personal: '請查詢我的合成課表；私人內容不要交給模型。',
  mixed: '請查詢合成借書規則及我的合成課表。',
} as const;
type Task = { capability: string; expires: number; calls: number; sources: Set<string>; privateRef?: string; response?: unknown };
export class AgentService {
  private tasks = new Map<string, Task>();
  private events = new Map<string, string>();
  prepare(eventId: string, scenario: keyof typeof agentPrompts, session: 'demo-a'|'demo-b' = 'demo-a') {
    for (const [id,t] of this.tasks) if(t.expires < Date.now()) this.tasks.delete(id);
    for (const [event,id] of this.events) if(!this.tasks.has(id)) this.events.delete(event);
    if(this.events.has(eventId)) return {accepted:false,synthetic:true,status:'duplicate'};
    if(this.tasks.size >= 1000) throw new Fault(429,'TASK_CAPACITY');
    const taskId=randomUUID(), capability=randomUUID();
    this.tasks.set(taskId,{capability,expires:Date.now()+90_000,calls:0,sources:new Set()});
    this.events.set(eventId,taskId);
    return {accepted:true,synthetic:true,taskId,capability,prompt:agentPrompts[scenario],sessionKey:`synthetic:${session}`};
  }
  private task(id:string,capability:string) {
    const t=this.tasks.get(id);
    if(!t || t.capability!==capability) throw new Fault(403,'TASK_DENIED');
    if(t.expires<Date.now()) throw new Fault(409,'TASK_EXPIRED');
    return t;
  }
  tool(id:string,capability:string,kind:'knowledge'|'web'|'personal',query:string) {
    const t=this.task(id,capability);
    if(t.response) throw new Fault(409,'TASK_COMPLETED');
    if(++t.calls>4) throw new Fault(429,'TOOL_BUDGET');
    if(kind==='personal') {
      if(!['schedule','absence','announcements'].includes(query)) throw new Fault(400,'ACTION_DENIED');
      // No course title, student identifier or private text is exposed to the agent.
      t.privateRef ??= randomUUID();
      return {synthetic:true,status:'prepared_locally',message:'私人結果由回覆階段本地組裝，不提供原文。'};
    }
    const sourceId=kind==='knowledge'?'synthetic-library-rules':'synthetic-library-hours';
    t.sources.add(sourceId);
    return {synthetic:true,sources:[{sourceId,text:kind==='knowledge'?'合成測試規則：每次最多借閱 5 本書。':'合成測試開館時間：09:00–17:00。'}],notice:'完全虛構的測試資料，不能作為真實校務答案。'};
  }
  complete(id:string,capability:string,output:string) {
    const t=this.task(id,capability);
    if(t.response) return t.response;
    let result: {answer:string;sourceIds:string[]};
    try {
      result=JSON.parse(output);
      if(!result || typeof result.answer!=='string' || !result.answer.trim() || result.answer.length>3000 || !Array.isArray(result.sourceIds) || Object.keys(result).some(k=>!['answer','sourceIds'].includes(k)) || result.sourceIds.some(s=>typeof s!=='string'||!t.sources.has(s))) throw Error();
      if(!t.privateRef && result.sourceIds.length===0) throw Error();
      if(t.sources.size>0 && result.sourceIds.length===0) throw Error();
    } catch {throw new Fault(422,'INVALID_AGENT_OUTPUT');}
    t.response={synthetic:true,delivered:false,status:'validated',answer:`【合成測試】${result.answer}`,sourceIds:result.sourceIds,privateResult:t.privateRef?'【合成測試】個人結果由本地模板呈現。':null};
    return t.response;
  }
}
