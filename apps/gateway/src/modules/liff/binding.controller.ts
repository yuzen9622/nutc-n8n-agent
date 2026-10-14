import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {identitySchema} from '../line/line.schema.js';
import {bindingSchema} from './binding.schema.js';
import type {BindingService} from './binding.service.js';
import {Fault} from '../../utils/fault.js';
import {json,readRaw} from '../../utils/http.js';
const cookieName='__Host-campus_liff';
const jsonObject=z.record(z.string(),z.unknown());
function parseBody(raw:Buffer):Record<string,unknown>{
 try{return jsonObject.parse(JSON.parse(raw.toString('utf8')));}
 catch(error){if(error instanceof SyntaxError)throw new Fault(400,'INVALID_REQUEST');throw error;}
}
export class BindingController {
 constructor(private readonly service:BindingService,private readonly origin:string){}
 async handle(path:'identity'|'bind',req:IncomingMessage,res:ServerResponse){
  if(req.headers.origin!==this.origin)throw new Fault(403,'ORIGIN_DENIED');
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')throw new Fault(415,'JSON_REQUIRED');
  const body=parseBody(await readRaw(req));
  if(path==='identity'){
   const credentials=await this.service.identity(identitySchema.parse(body).idToken);
   res.setHeader('Set-Cookie',`${cookieName}=${credentials.token}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`);
   return json(res,200,{verified:true,csrfToken:credentials.csrf});
  }
  const cookies=(req.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${cookieName}=`));
  const csrf=req.headers['x-csrf-token'];
  if(cookies.length!==1||typeof csrf!=='string')throw new Fault(401,'LIFF_SESSION_REQUIRED');
  const values=bindingSchema.parse(body);
  await this.service.bind(cookies[0]!.slice(cookieName.length+1),csrf,values.account,values.password);
  json(res,200,{bound:true});
 }
}
