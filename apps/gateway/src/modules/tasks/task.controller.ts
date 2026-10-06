import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
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
      const input=toolSchema.parse(body);
      const {taskId,lease,capability,kind,query,params,...extra}=input;
      const mergedParams=params?{...extra,...params}:extra;
      result=await this.service.tool(taskAuthSchema.parse({taskId,lease,capability}),kind,query,Object.keys(mergedParams).length?mergedParams:undefined);
    }
    else {const input=completionSchema.parse(body);result=await this.service.complete({taskId:input.taskId,lease:input.lease,capability:input.capability},input.output,input.knowledgeObservations);}
    json(res,200,{data:result});
  }
}
