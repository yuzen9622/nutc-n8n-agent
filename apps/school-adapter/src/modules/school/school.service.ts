import {CookieJar} from 'tough-cookie';
import {SchoolClient} from './school.client.js';
import type {SchoolLoginService} from './login.service.js';
import type {LoginFailure,SchoolSessionRepository} from './session.repository.js';
import {StudentService,type StudentAction} from './student.service.js';
import {SchoolError} from '../../utils/school-error.js';
export class SchoolService {
 constructor(private readonly sessions:SchoolSessionRepository,private readonly authentication:SchoolLoginService,private readonly students=new StudentService()){}
 async login(userId:string,account:string,password:string){
  const lease=await this.sessions.beginLogin(userId,account);let client:SchoolClient|undefined;let failure:LoginFailure='technical_failure';
  try{
   client=await this.authentication.login(account,password);
   const id=await this.sessions.finishLogin(lease,JSON.stringify(await client.jar.serialize()));
   return {bound:true,sessionId:id};
  }catch(error){
   if(error instanceof SchoolError && error.code==='SCHOOL_CREDENTIALS_REJECTED')failure='credentials_rejected';
   if(error instanceof SchoolError && error.code==='SCHOOL_ACCOUNT_LOCKED')failure='account_locked';
   if(error instanceof SchoolError && error.code==='SCHOOL_AUTHENTICATION_REJECTED')failure='authentication_rejected';
   throw error;
  }finally{await client?.jar.removeAllCookies();await this.sessions.cancelLogin(lease,failure);}
 }
 async query(userId:string,action:StudentAction){
  let sessionId:string|undefined;
  try{return await this.sessions.withSession(userId,async stored=>{
   sessionId=stored.id;
   let jar:CookieJar;try{jar=await CookieJar.deserialize(stored.cookies);}catch{throw new SchoolError('SCHOOL_SESSION_INVALID');}
   try{const data=await this.students.query(new SchoolClient(jar),action);return {cookies:JSON.stringify(await jar.serialize()),data:{sessionId:stored.id,result:data}};}
   finally{await jar.removeAllCookies();}
  });}catch(error){
   if(sessionId && error instanceof SchoolError && ['SCHOOL_SESSION_EXPIRED','SCHOOL_SESSION_INVALID'].includes(error.code))await this.sessions.invalidate(userId,sessionId);
   throw error;
  }
 }
}
