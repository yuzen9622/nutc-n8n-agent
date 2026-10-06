import {z} from 'zod';
// Exact native n8n 2.41.7 PGVector tool observation shape, captured in execution 132.
const observation=z.array(z.object({response:z.array(z.strictObject({type:z.literal('text'),text:z.string().max(12000)})).max(6)})).max(1);
const document=z.object({pageContent:z.string().min(1).max(8000),metadata:z.object({sourceId:z.string().max(128),version:z.string().max(128),chunkId:z.string().max(128)})});
export type KnowledgeEvidence={sourceId:string;version:string;chunkId:string;text:string};
export function knowledgeEvidence(observations:string[]):KnowledgeEvidence[]{
  return observations.flatMap(raw=>observation.parse(JSON.parse(raw)).flatMap(result=>result.response.map(block=>{
    const doc=document.parse(JSON.parse(block.text));
    return {...doc.metadata,text:doc.pageContent};
  })));
}
