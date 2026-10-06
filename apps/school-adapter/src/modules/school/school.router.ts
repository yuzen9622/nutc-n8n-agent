import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {ZodError} from 'zod';
import type {SchoolController} from './school.controller.js';
import {reply} from '../../utils/http.js';
import {SchoolError} from '../../utils/school-error.js';
import {SCHOOL_ERROR_STATUS} from '../../constants/errors.js';
export function schoolRouter(controller:SchoolController,token:string){
 const expected=createHash('sha256').update(token).digest();
 return async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   if(req.method==='GET'&&req.url==='/health/live')return reply(res,200,{ok:true});
   const supplied=req.headers['x-campus-school'];
   if(typeof supplied!=='string'||!timingSafeEqual(expected,createHash('sha256').update(supplied).digest()))return reply(res,401,{error:'SERVICE_AUTH_REQUIRED'});
   if(req.method==='POST'&&req.url==='/internal/v1/school/login')return await controller.login(req,res);
   if(req.method==='POST'&&req.url==='/internal/v1/school/query')return await controller.query(req,res);
   reply(res,404,{error:'NOT_FOUND'});
  }catch(error){
   if(res.destroyed)return;
   if(error instanceof ZodError||error instanceof SyntaxError)return reply(res,400,{error:'INVALID_REQUEST'});
   if(error instanceof SchoolError){
    // Record only our diagnostic code: never account, password, cookies or school HTML.
    console.warn(JSON.stringify({event:'school_request_failed',code:/^(?:SCHOOL|OCR)_[A-Z_]{1,64}$/.test(error.code)?error.code:'SCHOOL_UNAVAILABLE',...(error.urlDiagnostic?{urlDiagnostic:error.urlDiagnostic}:{})}));
    return reply(res,SCHOOL_ERROR_STATUS[error.code]??503,{error:error.code});
   }
   console.warn(JSON.stringify({event:'school_request_failed',code:'SCHOOL_UNAVAILABLE'}));
   reply(res,503,{error:'SCHOOL_UNAVAILABLE'});
  }
 };
}
