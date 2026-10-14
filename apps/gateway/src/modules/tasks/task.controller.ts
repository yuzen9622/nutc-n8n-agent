import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import {isLeaveQuery} from '../../../../shared/leave-contract.js';
import { taskAuthSchema,toolSchema,completionSchema } from './task.schema.js';
import type { TaskService } from './task.service.js';
import { readRaw,json } from '../../utils/http.js';
import { Fault } from '../../utils/fault.js';
export class TaskController {
  constructor(private readonly service:TaskService,private readonly token:string) {}
  async handle(path:'prepare'|'tool'|'complete',req:IncomingMessage,res:ServerResponse) {
    const token=req.headers['x-campus-service'];
    const digest=(value:string)=>createHash('sha256').update(value).digest();
    if(typeof token!=='string' || !timingSafeEqual(digest(token),digest(this.token))) throw new Fault(401,'SERVICE_DENIED');
    let body:unknown;
    try{const raw=await readRaw(req);body=JSON.parse(raw.toString('utf8'));}catch{throw new Fault(400,'INVALID_REQUEST');}
    let result:unknown;
    if(path==='prepare') result=await this.service.prepare(taskAuthSchema.parse(body));
    else if(path==='tool') {
      if(body&&typeof body==='object'){
        const raw=body as Record<string,unknown>;
        if(raw.kind==='personal'&&typeof raw.query==='string'&&isLeaveQuery(raw.query)){
          const auth=taskAuthSchema.parse({taskId:raw.taskId,lease:raw.lease,capability:raw.capability});
          const records=raw.query==='leave'&&raw.params&&typeof raw.params==='object'&&['records','query','leave_notes'].includes(String((raw.params as Record<string,unknown>).action));
          if(raw.query!=='leave_notes'&&!records)await this.service.guardLeave(auth,raw.query);
          const canonical=new Set(['taskId','lease','capability','kind','query','params']);
          if(Object.keys(raw).some(k=>!canonical.has(k)))throw new Fault(400,'LEAVE_EXTRA_DENIED');
        }
      }
      const input=toolSchema.parse(body);
      const {taskId,lease,capability,kind,query,params,...extra}=input;
      const mergedParams=params?{...extra,...params}:extra;
      result=await this.service.tool(taskAuthSchema.parse({taskId,lease,capability}),kind,query,Object.keys(mergedParams).length?mergedParams:undefined);
    }
    else {const input=completionSchema.parse(body);result=await this.service.complete({taskId:input.taskId,lease:input.lease,capability:input.capability},input.output,input.knowledgeObservations);}
    json(res,200,{data:result});
  }
}
