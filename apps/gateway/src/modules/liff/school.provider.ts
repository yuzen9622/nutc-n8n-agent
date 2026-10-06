import {personalDataSchema,type PersonalAction} from '../personal/personal.schema.js';
import {z} from 'zod';
import {Fault} from '../../utils/fault.js';
const failures=new Set(['SCHOOL_CREDENTIALS_REJECTED','SCHOOL_AUTHENTICATION_REJECTED','SCHOOL_LOGIN_RATE_LIMIT','SCHOOL_LOGIN_BUSY','SCHOOL_ACCOUNT_ALREADY_BOUND','SCHOOL_ACCOUNT_LOCKED','SCHOOL_CAPTCHA_FAILED']);
export class SchoolProvider {
 constructor(private readonly origin:string,private readonly token:string,private readonly request:typeof fetch=fetch){}
 async query(userId:string,action:PersonalAction){
  const response=await this.request(`${this.origin}/internal/v1/school/query`,{method:'POST',headers:{'content-type':'application/json','x-campus-school':this.token},body:JSON.stringify({userId,action}),redirect:'error',signal:AbortSignal.timeout(12000)});
  const reader=response.body?.getReader();if(!reader)throw new Fault(502,'SCHOOL_UNAVAILABLE');
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>256*1024)throw new Fault(502,'SCHOOL_RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{await reader.cancel();}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Fault(502,'SCHOOL_UNAVAILABLE');}
  if(!response.ok){
    const failure=z.object({error:z.enum(['SCHOOL_LOGIN_REQUIRED','SCHOOL_SESSION_EXPIRED','SCHOOL_SESSION_INVALID'])}).safeParse(value);
    if(response.status===401 && failure.success)throw new Fault(401,'SCHOOL_LOGIN_REQUIRED');
    throw new Fault(503,'SCHOOL_UNAVAILABLE');
  }
  const parsed=z.object({data:z.object({sessionId:z.string().uuid(),result:personalDataSchema})}).safeParse(value);
  if(!parsed.success||parsed.data.data.result.kind!==action)throw new Fault(502,'SCHOOL_RESPONSE_INVALID');
  return parsed.data.data;
 }
 async bind(userId:string,account:string,password:string){
  const response=await this.request(`${this.origin}/internal/v1/school/login`,{method:'POST',headers:{'content-type':'application/json','x-campus-school':this.token},body:JSON.stringify({userId,account,password}),redirect:'error',signal:AbortSignal.timeout(35000)});
  const text=await response.text();if(text.length>8192)throw new Fault(502,'SCHOOL_UNAVAILABLE');
  let value:unknown;try{value=JSON.parse(text);}catch{throw new Fault(502,'SCHOOL_UNAVAILABLE');}
  if(!response.ok){const parsed=z.object({error:z.string()}).safeParse(value);const code=parsed.success && failures.has(parsed.data.error)?parsed.data.error:'SCHOOL_UNAVAILABLE';throw new Fault(code==='SCHOOL_UNAVAILABLE'?503:409,code);}
  if(!z.object({data:z.object({bound:z.literal(true),sessionId:z.string().uuid()})}).safeParse(value).success)throw new Fault(502,'SCHOOL_UNAVAILABLE');
 }
}
