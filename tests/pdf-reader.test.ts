import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {PdfReader} from '../apps/gateway/src/modules/search/pdf.reader.js';
import {OfficialReader} from '../apps/gateway/src/modules/search/official-reader.js';
import {KnowledgeService} from '../apps/gateway/src/modules/knowledge/knowledge.service.js';

// Synthetic, valid PDF fixture with a separate text stream for each page.
function pdf(texts:string[]):Buffer{
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${texts.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${texts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const text of texts){
    const stream=`BT /F1 12 Tf 30 200 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length+2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let value='%PDF-1.4\n';const offsets=[0];
  for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(value));value+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
  const start=Buffer.byteLength(value);
  value+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(value);
}
test('PDF process extracts real page boundaries and fails closed on missing text, malformed data and excessive pages',async()=>{
  const reader=new PdfReader();
  assert.deepEqual(await reader.read(pdf(['First official page text.','Second official page text.'])),[
    {page:1,text:'First official page text.'},{page:2,text:'Second official page text.'}]);
  for(const bytes of [Buffer.from('not PDF'),Buffer.from('%PDF-broken'),pdf(['First official page text.','']),pdf(Array(31).fill('Page text long enough.')),Buffer.alloc(1024*1024+1)])
    await assert.rejects(reader.read(bytes),/SOURCE_PDF_UNREADABLE/);
});
test('PDF worker deadline releases the concurrency slot and does not hang the gateway',async()=>{
  const reader=new PdfReader(new URL('./fixtures/ocr-hang.mjs',import.meta.url),50);
  for(let i=0;i<3;i++)await assert.rejects(reader.read(pdf(['Official document text.'])),/SOURCE_PDF_TIMEOUT/);
});
test('official PDF uses the same redirect allowlist and hashes page boundaries',async()=>{
  const bytes=pdf(['First official page text.','Second official page text.']);
  const reader=new OfficialReader(['student.nutc.edu.tw'],async()=>({status:200,headers:{'content-type':'application/pdf'},body:bytes}));
  const source=await reader.read('https://student.nutc.edu.tw/document.pdf');
  assert.equal(source.pages?.length,2);assert(source.text.includes('[第 2 頁]'));
  assert.equal((await reader.read(source.url)).version,source.version);
  let calls=0;
  const denied=new OfficialReader(['student.nutc.edu.tw'],async()=>{calls++;return {status:302,headers:{location:'https://attacker.example/doc.pdf'},body:Buffer.alloc(0)};});
  await assert.rejects(denied.read(source.url),/SOURCE_URL_DENIED/);assert.equal(calls,1);
});
test('knowledge preparation preserves PDF page metadata without crossing pages',async()=>{
  const reader=new OfficialReader(['student.nutc.edu.tw'],async()=>({status:200,headers:{'content-type':'application/pdf'},body:pdf(['First official page text.','Second official page text.'])}));
  const pool={query:async()=>({rowCount:0,rows:[]})} as unknown as Pool;
  const docs=await new KnowledgeService(pool,reader).prepare();
  assert(docs.length>=2);
  for(let i=0;i<docs.length;i++){assert.equal(docs[i]!.metadata.page,i%2+1);assert.equal(docs[i]!.text,i%2===0?'First official page text.':'Second official page text.');}
});
