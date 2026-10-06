import {z} from 'zod';
import type {BindingRepository} from './binding.repository.js';
import type {TaskRepository} from '../tasks/task.repository.js';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {identitySchema} from '../line/line.schema.js';
import {bindingSchema} from './binding.schema.js';
import type {BindingService} from './binding.service.js';
import {Fault} from '../../utils/fault.js';
import {json,readRaw} from '../../utils/http.js';
const cookieName='__Host-campus_liff';
export class BindingController {
 constructor(private readonly service:BindingService,private readonly origin:string,private readonly sessions?:BindingRepository,private readonly tasks?:TaskRepository){}
 async handle(path:'identity'|'bind'|'result',req:IncomingMessage,res:ServerResponse){
  if(req.headers.origin!==this.origin)throw new Fault(403,'ORIGIN_DENIED');
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')throw new Fault(415,'JSON_REQUIRED');
  const body=JSON.parse((await readRaw(req)).toString('utf8'));
  if(path==='identity'){
   const credentials=await this.service.identity(identitySchema.parse(body).idToken);
   res.setHeader('Set-Cookie',`${cookieName}=${credentials.token}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`);
   return json(res,200,{verified:true,csrfToken:credentials.csrf});
  }
  const cookies=(req.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${cookieName}=`));
  const csrf=req.headers['x-csrf-token'];
  if(cookies.length!==1||typeof csrf!=='string')throw new Fault(401,'LIFF_SESSION_REQUIRED');
  if(path==='result'){
   if(!this.sessions||!this.tasks)throw new Fault(503,'SEARCH_RESULT_UNAVAILABLE');
   const {taskId}=z.object({taskId:z.uuid()}).strict().parse(body);
   const userId=await this.sessions.authorize(cookies[0]!.slice(cookieName.length+1),csrf);
   return json(res,200,{html:await this.tasks.groundedResult(userId,taskId)});
  }
  const values=bindingSchema.parse(body);
  await this.service.bind(cookies[0]!.slice(cookieName.length+1),csrf,values.account,values.password);
  json(res,200,{bound:true});
 }
}
