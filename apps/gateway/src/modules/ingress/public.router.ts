import type { IncomingMessage, ServerResponse } from 'node:http';
import { LiffController } from '../liff/liff.controller.js';
import { json,readRaw } from '../../utils/http.js';
import { Fault } from '../../utils/fault.js';

// Deliberately expose only the LINE/LIFF surface. Internal task and provider routes
// never reach the upstream even if callers possess an internal token.
export function publicRouter(origin:string,liffId?:string,request:typeof fetch=fetch,gatewayOrigin='http://127.0.0.1:3100'){
  // Deployment choice only; never derived from a public request or arbitrary URL.
  if(!['http://127.0.0.1:3100','http://gateway:3100'].includes(gatewayOrigin))throw new Error('INVALID_PUBLIC_GATEWAY_ORIGIN');
  let host:string;
  try{host=new URL(origin).host;}catch{throw new Error('INVALID_PUBLIC_ORIGIN');}
  const liff=new LiffController(origin,liffId);
  return async(req:IncomingMessage,res:ServerResponse)=>{
    try{
      if(req.headers.host!==host)return json(res,421,{error:'HOST_DENIED'});
      const path=req.url?.split('?')[0];
      if(req.method==='GET' && path && ['/liff','/liff/','/liff/app.js','/liff/config'].includes(path))return liff.handle(path,res);
      if(req.method!=='POST' || !['/line/webhook','/liff/identity','/liff/bind','/liff/result'].includes(req.url??''))return json(res,404,{error:'NOT_FOUND'});
      const body=await readRaw(req),headers=new Headers();
      for(const name of ['content-type','x-line-signature','origin','cookie','x-csrf-token']){
        const value=req.headers[name];if(typeof value==='string')headers.set(name,value);
      }
      const response=await request(`${gatewayOrigin}${req.url}`,{method:'POST',headers,body:new Uint8Array(body),redirect:'error',signal:AbortSignal.timeout(req.url==='/liff/bind'?40000:8000)});
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length>256*1024)throw new Fault(502,'UPSTREAM_RESPONSE_TOO_LARGE');
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Type','application/json; charset=utf-8');
      const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
      res.writeHead(response.status);res.end(bytes);
    }catch(error){if(!res.destroyed)json(res,error instanceof Fault?error.status:503,{error:error instanceof Fault?error.code:'SERVICE_UNAVAILABLE'});}
  };
}
