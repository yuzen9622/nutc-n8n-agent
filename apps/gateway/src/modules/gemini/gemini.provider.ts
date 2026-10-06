import { createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { BudgetRepository } from '../budget/budget.repository.js';
import { Fault } from '../../utils/fault.js';

export type GeminiProxyConfig={token:string;chatKey:string;embeddingKey:string;chatModel:string;embeddingModel:string;chatMaxCostMicroUsd:number;embeddingMaxCostMicroUsd:number};
const object=z.record(z.string(),z.unknown());
const maxRequestBytes=128*1024,maxResponseBytes=4*1024*1024;
export class GeminiProvider {
  constructor(private readonly config:GeminiProxyConfig,private readonly budget:BudgetRepository,private readonly request:typeof fetch=fetch) {
    if(!/^models\/[a-zA-Z0-9._-]{1,100}$/.test(config.chatModel) || !/^models\/[a-zA-Z0-9._-]{1,100}$/.test(config.embeddingModel)) throw Error('INVALID_GEMINI_MODEL');
  }
  async relay(path:string,apiKey:string|undefined,raw:Buffer):Promise<{status:number;contentType:string;body:Buffer}> {
    const hash=(text:string)=>createHash('sha256').update(text).digest();
    if(!apiKey || !timingSafeEqual(hash(apiKey),hash(this.config.token))) throw new Fault(401,'PROVIDER_PROXY_DENIED');
    const matched=path.match(/^\/providers\/gemini\/v1beta\/(models\/[a-zA-Z0-9._-]+):(generateContent|streamGenerateContent|embedContent|batchEmbedContents)(\?alt=sse)?$/);
    if(!matched || raw.length>maxRequestBytes) throw new Fault(400,'PROVIDER_REQUEST_DENIED');
    const model=matched[1]!,operation=matched[2]!,embedding=['embedContent','batchEmbedContents'].includes(operation);
    if(model!==(embedding?this.config.embeddingModel:this.config.chatModel) || (matched[3] && operation!=='streamGenerateContent')) throw new Fault(400,'PROVIDER_MODEL_DENIED');
    let body:Record<string,unknown>;try {body=object.parse(JSON.parse(raw.toString('utf8')));} catch {throw new Fault(400,'PROVIDER_REQUEST_INVALID');}
    // Native nodes use text-only inputs here. Images, file URIs, caches and built-in paid tools are not enabled.
    const rejectEmbedded=(value:unknown):boolean=>{
      if(Array.isArray(value)) return value.some(rejectEmbedded);
      if(!value || typeof value!=='object') return false;
      return Object.entries(value).some(([key,nested])=>['inlineData','inline_data','fileData','file_data','cachedContent','googleSearch','google_search','codeExecution','code_execution','urlContext','url_context'].includes(key) || rejectEmbedded(nested));
    };
    if(rejectEmbedded(body)) throw new Fault(400,'PROVIDER_INPUT_TYPE_DENIED');
    const permitted=embedding?(operation==='batchEmbedContents'?['requests']:['model','content','taskType','title','outputDimensionality']):['contents','systemInstruction','tools','toolConfig','generationConfig','safetySettings'];
    if(Object.keys(body).some(key=>!permitted.includes(key))) throw new Fault(400,'PROVIDER_REQUEST_FIELD_DENIED');
    if(embedding) {
      const requests=operation==='batchEmbedContents'?body.requests:[body];
      if(!Array.isArray(requests) || requests.length<1 || requests.length>16 || requests.some(item=>!item || typeof item!=='object' || ('model' in item && item.model!==model))) throw new Fault(400,'EMBEDDING_BATCH_DENIED');
    } else {
      const generation=body.generationConfig===undefined?{}:object.parse(body.generationConfig);
      const output=generation.maxOutputTokens;
      if(output!==undefined && (!Number.isInteger(output) || Number(output)<=0)) throw new Fault(400,'INVALID_OUTPUT_LIMIT');
      if(body.tools!==undefined && (!Array.isArray(body.tools) || body.tools.some(tool=>!tool || typeof tool!=='object' || Object.keys(tool).some(key=>key!=='functionDeclarations') || !Array.isArray(tool.functionDeclarations)))) throw new Fault(400,'PROVIDER_TOOL_DENIED');
      if(generation.candidateCount!==undefined && generation.candidateCount!==1) throw new Fault(400,'PROVIDER_CANDIDATE_DENIED');
      if(generation.responseModalities!==undefined && (!Array.isArray(generation.responseModalities) || generation.responseModalities.some(value=>value!=='TEXT'))) throw new Fault(400,'PROVIDER_MODALITY_DENIED');
      // Billing upper-bound configuration must cover this body ceiling and max output, including thinking.
      body.generationConfig={...generation,maxOutputTokens:Math.min(Number(output??2048),2048)};
    }
    // Native subnodes share one proxy credential and do not attach task identifiers.
    // Reserve globally for every actual HTTP attempt, including SDK retries, before forwarding.
    const reservation=await this.budget.reserve(null,embedding?'embedding':'gemini',embedding?this.config.embeddingMaxCostMicroUsd:this.config.chatMaxCostMicroUsd);
    const upstream=new URL(`https://generativelanguage.googleapis.com/v1beta/${model}:${operation}${matched[3]??''}`);
    const response=await this.request(upstream,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{'x-goog-api-key':embedding?this.config.embeddingKey:this.config.chatKey,'content-type':'application/json'},body:JSON.stringify(body)});
    // Record the ORIGINAL upstream status before mapping errors for the client.
    // Database failure retains the full reservation; it must not cause an extra model retry.
    try{await this.budget.recordTokenOnlyResponse(reservation,response.status);}catch{/* retain reservation */}
    if(!response.ok) {
      await response.body?.cancel();
      // Provider errors may contain reflected prompts or credentials; return a fixed envelope.
      const status=response.status===429?429:response.status>=500?503:400;
      return {status,contentType:'application/json',body:Buffer.from(JSON.stringify({error:{code:status,message:'Model provider unavailable',status:status===429?'RESOURCE_EXHAUSTED':'UNAVAILABLE'}}))};
    }
    const contentType=response.headers.get('content-type')??'';
    if(!/^(application\/json|text\/event-stream)(;|$)/i.test(contentType) || !response.body) throw new Fault(503,'PROVIDER_RESPONSE_INVALID');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
    try {for(;;) {const part=await reader.read();if(part.done) break;bytes+=part.value.byteLength;if(bytes>maxResponseBytes) throw new Fault(503,'PROVIDER_RESPONSE_TOO_LARGE');chunks.push(part.value);}}
    finally {await reader.cancel();reader.releaseLock();}
    const result=Buffer.concat(chunks);
    // Verified 2026-10-06 introductory text tariff; fail closed after its end date.
    // Charging every reported token at the highest output rate overestimates actual usage.
    if(!embedding && model==='models/gemini-3.8-flash' && Date.now()<Date.parse('2027-01-01T00:00:00Z')){
      try{
        const payloads=contentType.startsWith('text/event-stream')?result.toString('utf8').split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))):[JSON.parse(result.toString('utf8'))];
        const usage=payloads.at(-1)?.usageMetadata;
        if(Number.isSafeInteger(usage?.totalTokenCount) && usage.totalTokenCount>0){
          const upper=Math.ceil(usage.totalTokenCount*3.75);
          if(upper<=this.config.chatMaxCostMicroUsd)await this.budget.settle(reservation,upper);
        }
      }catch{/* Missing/invalid final usage or settlement failure retains the full reservation. */}
    }
    return {status:200,contentType,body:result};
  }
}
