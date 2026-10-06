import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { loadBuffer } from 'cheerio';
import { Fault } from '../../utils/fault.js';
import {PdfReader,type PdfPage} from './pdf.reader.js';

export type VerifiedSource={sourceId:string;url:string;title:string;text:string;version:string;fetchedAt:string;validUntil:string;publishedAt:null;pages?:PdfPage[]};
export type ReaderResponse={status:number;headers:Record<string,string|undefined>;body:Buffer};
export type ReaderTransport=(url:URL,signal:AbortSignal)=>Promise<ReaderResponse>;
export function isPublicAddress(address:string):boolean {
  try {return ipaddr.parse(address).range()==='unicast';} catch {return false;}
}
export function officialUrl(input:string,hosts:ReadonlySet<string>):URL {
  let url:URL;try {url=new URL(input);} catch {throw new Fault(422,'SOURCE_URL_DENIED');}
  if(url.protocol!=='https:' || url.username || url.password || url.port || isIP(url.hostname) || !hosts.has(url.hostname))
    throw new Fault(422,'SOURCE_URL_DENIED');
  url.hash='';
  if(url.href.length>2000) throw new Fault(422,'SOURCE_URL_DENIED');
  return url;
}
const limit=1024*1024;
export const officialTransport:ReaderTransport=(url,signal)=>new Promise((resolve,reject)=>{
  // The socket receives the vetted DNS result; it cannot perform a second, unverified lookup.
  const req=request(url,{method:'GET',agent:false,signal,headers:{'user-agent':'CampusAgent/1.0 public-document-reader','accept':'text/html,text/plain,application/pdf','accept-encoding':'identity'},
    lookup:(hostname,options,callback)=>{
      lookup(hostname,{all:true,verbatim:true}).then(addresses=>{
        if(!addresses.length || addresses.some(entry=>!isPublicAddress(entry.address))) throw new Fault(422,'SOURCE_ADDRESS_DENIED');
        if(options.all) callback(null,addresses);
        else callback(null,addresses[0]!.address,addresses[0]!.family);
      }).catch(error=>callback(error,[],0));
    },
  },res=>{
    const chunks:Buffer[]=[];let bytes=0;
    if(res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') {res.destroy(new Fault(422,'SOURCE_ENCODING_DENIED'));}
    if(Number(res.headers['content-length']??0)>limit) res.destroy(new Fault(422,'SOURCE_TOO_LARGE'));
    res.on('data',chunk=>{const part=Buffer.from(chunk);bytes+=part.length;if(bytes>limit) res.destroy(new Fault(422,'SOURCE_TOO_LARGE'));else chunks.push(part);});
    res.on('error',reject);
    res.on('end',()=>resolve({status:res.statusCode??0,headers:{'content-type':res.headers['content-type'],location:res.headers.location},body:Buffer.concat(chunks)}));
  });
  req.on('error',reject);req.end();
});
export function parseOfficialPage(response:ReaderResponse,url:URL,now=Date.now()):VerifiedSource {
  if(response.status!==200 || response.body.length>limit) throw new Fault(422,'SOURCE_UNREADABLE');
  const mime=response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  let title:string,text:string;
  if(mime==='text/html') {
    const charset=response.headers['content-type']?.match(/charset\s*=\s*[\"']?([^\s;\"']+)/i)?.[1];
    const $=loadBuffer(response.body,{encoding:{transportLayerEncodingLabel:charset}});
    title=$('title').first().text().trim();
    $('script,style,noscript,template,iframe,form,nav,footer,header,[hidden],[aria-hidden="true"]').remove();
    const root=$('.mpgdetail').first().length?$('.mpgdetail').first():$('main').first().length?$('main').first():$('article').first().length?$('article').first():$('body');
    root.find('p,div,li,h1,h2,h3,h4,br,tr').before('\n');
    root.find('td,th').before(' | ');
    text=root.text();
  } else if(mime==='text/plain') {title=url.hostname;text=response.body.toString('utf8');}
  else throw new Fault(422,'SOURCE_CONTENT_TYPE_DENIED');
  text=text.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
  if(text.length<30) throw new Fault(422,'SOURCE_EMPTY');
  // Bound context size; hash the exact extract given to the agent, not search snippets.
  text=text.slice(0,12000);title=(title || url.pathname || url.hostname).slice(0,200);
  return {sourceId:`web:${createHash('sha256').update(url.href).digest('hex').slice(0,32)}`,url:url.href,title,text,
    version:createHash('sha256').update(text).digest('hex'),fetchedAt:new Date(now).toISOString(),validUntil:new Date(now+24*60*60*1000).toISOString(),publishedAt:null};
}
export class OfficialReader {
  readonly hosts:ReadonlySet<string>;
  constructor(hosts:string[],private readonly transport:ReaderTransport=officialTransport,private readonly pdf=new PdfReader()) {
    if(!hosts.length || hosts.length>20 || hosts.some(host=>!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) throw new Error('INVALID_OFFICIAL_HOSTS');
    this.hosts=new Set(hosts);
  }
  async read(input:string):Promise<VerifiedSource> {
    let url=officialUrl(input,this.hosts);
    const signal=AbortSignal.timeout(4000);
    for(let redirects=0;redirects<=3;redirects++) {
      const response=await this.transport(url,signal);
      if([301,302,303,307,308].includes(response.status)) {
        if(!response.headers.location || redirects===3) throw new Fault(422,'SOURCE_REDIRECT_DENIED');
        url=officialUrl(new URL(response.headers.location,url).href,this.hosts);continue;
      }
      if(response.status===200&&response.headers['content-type']?.split(';')[0]?.trim().toLowerCase()==='application/pdf'){
        const pages=await this.pdf.read(response.body),text=pages.map(p=>`[第 ${p.page} 頁]\n${p.text}`).join('\n\n');
        const now=Date.now();
        return {sourceId:`web:${createHash('sha256').update(url.href).digest('hex').slice(0,32)}`,url:url.href,
          title:url.pathname.split('/').pop()||url.hostname,text,pages,
          version:createHash('sha256').update(text).digest('hex'),fetchedAt:new Date(now).toISOString(),
          validUntil:new Date(now+24*60*60*1000).toISOString(),publishedAt:null};
      }
      return parseOfficialPage(response,url);
    }
    throw new Fault(422,'SOURCE_REDIRECT_DENIED');
  }
}
