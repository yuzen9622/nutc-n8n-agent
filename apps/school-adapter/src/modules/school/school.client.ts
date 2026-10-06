import {schoolUrl} from '../../utils/school-url.js';
import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {CookieJar,Cookie,domainMatch} from 'tough-cookie';
import {SCHOOL} from '../../constants/school.js';
import {SchoolError} from '../../utils/school-error.js';
export type SchoolResponse={status:number;body:Buffer;contentType:string;location?:string;cookies:string[]};
export type SchoolTransport=(url:URL,options:{signal:AbortSignal;cookie:string;referer?:string;body?:string;csrfToken?:string})=>Promise<SchoolResponse>;
export const schoolTransport:SchoolTransport=(url,options)=>new Promise((resolve,reject)=>{
 const req=request(url,{method:options.body===undefined?'GET':'POST',signal:options.signal,agent:false,
  headers:{'User-Agent':'Mozilla/5.0 CampusAgent/1.0','Accept':'text/html,image/png,image/jpeg,image/gif','Accept-Encoding':'identity',...(options.cookie?{Cookie:options.cookie}:{}),...(options.referer?{Referer:options.referer}:{}),...(options.csrfToken?{'X-CSRF-TOKEN':options.csrfToken}:{}),...(options.body!==undefined?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(options.body)}:{})},
  lookup:(hostname,config,callback)=>{
   lookup(hostname,{all:true,verbatim:true}).then(addresses=>{
    if(!addresses.length||addresses.some(({address})=>ipaddr.parse(address).range()!=='unicast'))throw new SchoolError('SCHOOL_ADDRESS_DENIED');
    if(config.all)callback(null,addresses);else callback(null,addresses[0]!.address,addresses[0]!.family);
   }).catch(error=>callback(error,[],0));
  },
 },res=>{
  const chunks:Buffer[]=[];let count=0;
  if((res.headers['content-encoding'] && res.headers['content-encoding']!=='identity')||Number(res.headers['content-length']??0)>SCHOOL.responseLimit)res.destroy(new SchoolError('SCHOOL_RESPONSE_DENIED'));
  res.on('data',chunk=>{const b=Buffer.from(chunk);count+=b.length;if(count>SCHOOL.responseLimit)res.destroy(new SchoolError('SCHOOL_RESPONSE_TOO_LARGE'));else chunks.push(b);});
  res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks),contentType:res.headers['content-type']??'',location:res.headers.location,cookies:res.headers['set-cookie']??[]}));
 });req.on('error',reject);req.end(options.body);
});
export class SchoolClient {
 constructor(readonly jar=new CookieJar(),private readonly transport:SchoolTransport=schoolTransport){}
 async fetch(input:string,signal:AbortSignal,form?:URLSearchParams,options:{csrfToken?:string;referer?:string}={}):Promise<SchoolResponse & {url:string}>{
  let url=schoolUrl(input),body=form?.toString(),referer=options.referer,csrfToken=options.csrfToken;
  if(csrfToken&&(url.href!=='https://eportal.nutc.edu.tw/login_action.php'||!form||!csrfToken.length||csrfToken.length>512||/[\r\n]/.test(csrfToken)))throw new SchoolError('SCHOOL_URL_DENIED');
  if(referer)referer=schoolUrl(referer).origin+schoolUrl(referer).pathname;
  try{
   for(let redirects=0;redirects<=5;redirects++){
    signal.throwIfAborted();
    const response=await this.transport(url,{signal,cookie:await this.jar.getCookieString(url.href),body,referer,csrfToken});
    if(response.body.length>SCHOOL.responseLimit)throw new SchoolError('SCHOOL_RESPONSE_TOO_LARGE');
    // Browsers ignore Set-Cookie for unrelated domains. The school token bridge
    // also emits such cookies; never import them or fail a valid same-site session.
    for(const cookie of response.cookies){const parsed=Cookie.parse(cookie);if(!parsed||(parsed.domain&&!domainMatch(url.hostname,parsed.domain)))continue;await this.jar.setCookie(cookie,url.href);}
    if([301,302,303,307,308].includes(response.status)){
     if(!response.location||redirects===5 || (body!==undefined && [307,308].includes(response.status)))throw new SchoolError('SCHOOL_REDIRECT_DENIED');
     const next=schoolUrl(new URL(response.location,url).href);
     // Redirected credential submissions become GET; credentials are never replayed.
     referer=url.origin+url.pathname;url=next;body=undefined;csrfToken=undefined;continue;
    }
    if(response.status!==200)throw new SchoolError('SCHOOL_UNAVAILABLE');
    return {...response,url:url.href};
   }
   throw new SchoolError('SCHOOL_REDIRECT_DENIED');
  }catch(error){if(error instanceof SchoolError)throw error;throw new SchoolError(signal.aborted?'SCHOOL_TIMEOUT':'SCHOOL_UNAVAILABLE');}
 }
}
