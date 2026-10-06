import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {Fault} from '../../utils/fault.js';
import {OfficialReader,type VerifiedSource} from '../search/official-reader.js';
import {knowledgeCatalog} from './knowledge.catalog.js';

export type KnowledgeDocument={text:string;metadata:Record<string,unknown> & {batchId:string;chunkId:string;sourceId:string;version:string}};
type BatchDocument={source:VerifiedSource;chunks:KnowledgeDocument[]};
// Conservative UTF-8 byte ceiling, not a claim to match the provider tokenizer.
// Paragraph boundaries are preferred; short final paragraphs remain intact. No overlap.
export function splitKnowledge(text:string):string[]{
  const result:string[]=[];let chunk='';
  for(const paragraph of text.split(/\n\s*\n/).filter(Boolean)){
    if(Buffer.byteLength(chunk+'\n\n'+paragraph)>2000 && chunk){result.push(chunk);chunk='';}
    for(const character of paragraph){
      if(Buffer.byteLength(chunk+character)>2000){result.push(chunk);chunk='';}
      chunk+=character;
    }
    chunk+='\n\n';
  }
  if(chunk.trim())result.push(chunk.trim());
  return result.map(value=>value.trim());
}
export class KnowledgeService {
  constructor(private readonly pool:Pool,private readonly reader=new OfficialReader(['student.nutc.edu.tw'])){}
  async prepare(){
    const batchId=randomUUID(),documents:BatchDocument[]=[];
    // A failed fetch leaves the entire previous publication untouched.
    for(const entry of knowledgeCatalog){
      const source=await this.reader.read(entry.url);
      if(source.pages)source.title=entry.section;
      const sections=source.pages??[{page:null,text:source.text}];
      const chunks=sections.flatMap(part=>splitKnowledge(part.text).map(text=>({text,page:part.page}))).map(({text,page},index):KnowledgeDocument=>({text,metadata:{
        batchId,chunkId:createHash('sha256').update(source.sourceId+source.version+index+text).digest('hex'),
        sourceId:source.sourceId,url:source.url,title:source.title,version:source.version,
        page,section:entry.section,chunkIndex:index,fetchedAt:source.fetchedAt,publishedAt:null,
        validUntil:source.validUntil,effectiveFrom:null,effectiveUntil:null,schoolType:entry.schoolType,
        embeddingModel:'models/gemini-embedding-001',dimensions:3072,
        notice:'官方網頁未標示發布或施行日期；不同頁面若有衝突須指出，不能推定此頁優先。',
      }}));
      documents.push({source,chunks});
    }
    if(documents.flatMap(d=>d.chunks).length>30)throw new Fault(422,'CORPUS_TOO_LARGE');
    await this.pool.query('INSERT INTO campus_knowledge_batches(id,documents) VALUES($1,$2)',[batchId,JSON.stringify(documents)]);
    const result=[];
    for(const doc of documents.flatMap(d=>d.chunks)){
      const cached=await this.pool.query(`INSERT INTO campus_knowledge_staging(id,text,metadata,embedding)
        SELECT gen_random_uuid(),$1,$2,embedding FROM campus_knowledge_chunks
        WHERE source_id=$3 AND version=$4 AND metadata->>'chunkId'=$5 AND text=$1
        AND metadata->>'embeddingModel'='models/gemini-embedding-001'`,[doc.text,JSON.stringify(doc.metadata),doc.metadata.sourceId,doc.metadata.version,doc.metadata.chunkId]);
      result.push({...doc,needsEmbedding:cached.rowCount!==1});
    }
    return result;
  }
  async publish(batchId:string){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('campus-corpus-publication',0))");
      const batch=(await client.query('SELECT * FROM campus_knowledge_batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];
      if(!batch)throw new Fault(404,'BATCH_NOT_FOUND');
      if(batch.state==='published'){await client.query('COMMIT');return {batchId,status:'published',duplicate:true};}
      if(new Date(batch.created_at).getTime()<Date.now()-30*60*1000)throw new Fault(409,'BATCH_EXPIRED');
      const documents=batch.documents as BatchDocument[],expected=documents.flatMap(d=>d.chunks);
      const staged=(await client.query("SELECT *,vector_dims(embedding) AS dimensions FROM campus_knowledge_staging WHERE metadata->>'batchId'=$1 FOR SHARE",[batchId])).rows;
      if(staged.length!==expected.length)throw new Fault(409,'BATCH_INCOMPLETE');
      for(const doc of expected){
        const matches=staged.filter(row=>row.metadata.chunkId===doc.metadata.chunkId);
        if(matches.length!==1 || matches[0].text!==doc.text || matches[0].dimensions!==3072 || Object.entries(doc.metadata).some(([k,v])=>JSON.stringify(matches[0].metadata[k])!==JSON.stringify(v)))throw new Fault(422,'CHUNK_MISMATCH');
      }
      for(const {source} of [...documents].sort((a,b)=>a.source.sourceId.localeCompare(b.source.sourceId))){
        await client.query('INSERT INTO campus_sources(source_id,url,title,current_version,fetched_at,valid_until) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[source.sourceId,source.url,source.title,source.version,source.fetchedAt,source.validUntil]);
        const current=(await client.query('SELECT * FROM campus_sources WHERE source_id=$1 FOR UPDATE',[source.sourceId])).rows[0];
        if(!current || current.state!=='active' || current.url!==source.url)throw new Fault(409,'SOURCE_WITHDRAWN');
        if(new Date(current.fetched_at)>new Date(source.fetchedAt))throw new Fault(409,'SOURCE_SUPERSEDED');
        await client.query('INSERT INTO campus_source_versions(source_id,version,text,published_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[source.sourceId,source.version,source.text,null]);
        await client.query('UPDATE campus_sources SET title=$2,current_version=$3,fetched_at=$4,valid_until=$5 WHERE source_id=$1',[source.sourceId,source.title,source.version,source.fetchedAt,source.validUntil]);
      }
      await client.query(`INSERT INTO campus_knowledge_chunks(id,source_id,version,text,metadata,embedding)
        SELECT id,metadata->>'sourceId',metadata->>'version',text,metadata,embedding FROM campus_knowledge_staging
        WHERE metadata->>'batchId'=$1 ON CONFLICT(source_id,version,(metadata->>'chunkId')) DO UPDATE SET metadata=EXCLUDED.metadata`,[batchId]);
      await client.query("UPDATE campus_knowledge_batches SET state='published',published_at=now() WHERE id=$1",[batchId]);
      await client.query('COMMIT');return {batchId,status:'published',documents:documents.length,chunks:expected.length};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
