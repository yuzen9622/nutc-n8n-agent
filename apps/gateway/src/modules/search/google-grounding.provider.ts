import {renderGroundedAnswer} from './google-grounding.render.js';
import {z} from 'zod';
import {Fault} from '../../utils/fault.js';
const web=z.object({uri:z.url().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}),title:z.string().max(2000)});
const responseSchema=z.object({candidates:z.array(z.object({finishReason:z.literal('STOP'),content:z.object({parts:z.array(z.object({text:z.string().max(20000).optional(),thought:z.boolean().optional()})).max(100)}),groundingMetadata:z.object({searchEntryPoint:z.object({renderedContent:z.string().min(1).max(100000)}),groundingChunks:z.array(z.object({web})).min(1).max(100),webSearchQueries:z.array(z.string().max(2000)).min(1).max(100)})})).length(1)});
export type GroundedAnswer={answer:string;suggestionsHtml:string;sources:{uri:string;title:string}[]};
export type GroundingConfig={key:string;model:string};
// This is a final grounded answer, never a URL-discovery feed for OfficialReader/RAG.
export class GoogleGroundingProvider {
 constructor(private readonly config:GroundingConfig,private readonly request:typeof fetch=fetch){
  if(!/^models\/[a-zA-Z0-9._-]{1,100}$/.test(config.model)||!config.key)throw new Error('INVALID_GROUNDING_CONFIG');
 }
 async searchHtml(query:string){return renderGroundedAnswer(await this.search(query));}
 async search(query:string):Promise<GroundedAnswer>{
  if(!query.trim()||query.length>500)throw new Fault(400,'INVALID_SEARCH_QUERY');
  let response:Response;
  try{response=await this.request(`https://generativelanguage.googleapis.com/v1beta/${this.config.model}:generateContent`,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{'x-goog-api-key':this.config.key,'content-type':'application/json'},
   body:JSON.stringify({systemInstruction:{parts:[{text:'你是國立臺中科技大學的校園助理。使用 Google 搜尋查證公開資訊後，以繁體中文統整回答使用者；優先引用 nutc.edu.tw 官方資料，找不到官方依據就明說無法確認。不要猜測系所、承辦人或期限。不要要求或查詢個人帳密、學號、私人紀錄。'}]},contents:[{role:'user',parts:[{text:query}]}],tools:[{google_search:{}}],generationConfig:{maxOutputTokens:2048,candidateCount:1}})
  });}catch{throw new Fault(503,'GOOGLE_SEARCH_UNAVAILABLE');}
  if(!response.ok||!response.body){await response.body?.cancel();throw new Fault(503,'GOOGLE_SEARCH_UNAVAILABLE');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>256*1024)throw new Fault(503,'GOOGLE_SEARCH_RESPONSE_TOO_LARGE');chunks.push(part.value);}}
  finally{await reader.cancel();reader.releaseLock();}
  try{
   const candidate=responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).candidates[0]!;
   const answer=candidate.content.parts.filter(part=>!part.thought).map(part=>part.text??'').join('');
   if(!answer.trim()||answer.length>20000)throw new Error('empty');
   return {answer,suggestionsHtml:candidate.groundingMetadata.searchEntryPoint.renderedContent,sources:candidate.groundingMetadata.groundingChunks.map(chunk=>chunk.web)};
  }catch{throw new Fault(503,'GOOGLE_SEARCH_RESPONSE_INVALID');}
 }
}
