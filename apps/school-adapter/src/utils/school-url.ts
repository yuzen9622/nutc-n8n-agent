import {SCHOOL} from '../constants/school.js';
import {SchoolError} from './school-error.js';
export function schoolUrl(input:string):URL {
 let url:URL;try{url=new URL(input);}catch{throw new SchoolError('SCHOOL_URL_DENIED',{reason:'malformed',protocol:'other',host:'other'});}
 const reason=!SCHOOL.origins.has(url.origin)?'origin':url.username||url.password?'userinfo':url.href.length>4096?'length':undefined;
 if(reason){
  // Origin hostname only: URL paths, queries and embedded credentials never enter logs.
  const protocol=url.protocol==='http:'||url.protocol==='https:'?url.protocol:'other';
  const host=url.hostname.slice(0,253);
  throw new SchoolError('SCHOOL_URL_DENIED',{reason,protocol,host});
 }
 url.hash='';return url;
}
