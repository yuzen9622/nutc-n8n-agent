import { z } from 'zod';
import { Fault } from '../../utils/fault.js';
import { officialUrl,type OfficialReader,type VerifiedSource } from './official-reader.js';
const resultsSchema=z.object({web:z.object({results:z.array(z.object({url:z.string().max(2000)})).max(20)}).optional()});
export class SearchProvider {
  constructor(private readonly key:string,private readonly reader:OfficialReader,private readonly request:typeof fetch=fetch) {}
  async search(query:string):Promise<VerifiedSource[]> {
    if(!query.trim() || query.length>500) throw new Fault(400,'INVALID_SEARCH_QUERY');
    const url=new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',`${query} (${[...this.reader.hosts].map(host=>`site:${host}`).join(' OR ')})`);
    url.searchParams.set('count','5');url.searchParams.set('search_lang','zh-hant');url.searchParams.set('safesearch','strict');
    const response=await this.request(url,{redirect:'error',signal:AbortSignal.timeout(3000),headers:{'X-Subscription-Token':this.key,accept:'application/json'}});
    if(!response.ok) throw new Fault(503,'SEARCH_UNAVAILABLE');
    if(!response.body) throw new Fault(503,'SEARCH_UNAVAILABLE');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {
      for(;;) {const chunk=await reader.read();if(chunk.done) break;size+=chunk.value.byteLength;if(size>256*1024) throw new Fault(503,'SEARCH_RESPONSE_TOO_LARGE');chunks.push(chunk.value);}
    } finally {await reader.cancel();reader.releaseLock();}
    let parsed;try {parsed=resultsSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {throw new Fault(503,'SEARCH_RESPONSE_INVALID');}
    const candidates=[...new Set((parsed.web?.results??[]).map(result=>result.url))].filter(candidate=>{
      try {officialUrl(candidate,this.reader.hosts);return true;} catch {return false;}
    }).slice(0,3);
    const pages=await Promise.allSettled(candidates.map(candidate=>this.reader.read(candidate)));
    // A failed page is omitted; a search snippet is never substituted for official text.
    return [...new Map(pages.filter((result):result is PromiseFulfilledResult<VerifiedSource>=>result.status==='fulfilled').map(result=>[result.value.sourceId,result.value])).values()];
  }
}
