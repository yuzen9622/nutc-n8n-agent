import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitKnowledge} from '../apps/gateway/src/modules/knowledge/knowledge.service.js';
import {parseOfficialPage} from '../apps/gateway/src/modules/search/official-reader.js';
import {parseAgentAnswer} from '../apps/gateway/src/modules/tasks/task.schema.js';
import {knowledgeEvidence} from '../apps/gateway/src/modules/knowledge/knowledge.evidence.js';
test('knowledge evidence accepts native observations but never model answer sourceIds as retrieval proof',()=>{
  const doc={pageContent:'官方正文',metadata:{sourceId:'web:one',version:'v1',chunkId:'c1'}};
  assert.deepEqual(knowledgeEvidence([JSON.stringify([{response:[{type:'text',text:JSON.stringify(doc)}]}])]),[{...doc.metadata,text:doc.pageContent}]);
  assert.throws(()=>knowledgeEvidence([JSON.stringify({answer:'捏造',sourceIds:['web:one']})]));
  assert.throws(()=>knowledgeEvidence([JSON.stringify([{response:[{type:'text',text:JSON.stringify({...doc,metadata:{sourceId:'web:one'}})}]}])]));
});
test('Agent answer permits only one complete JSON wrapper and preserves strict shape',()=>{
  const value={answer:'已查詢',sourceIds:[]};
  assert.deepEqual(parseAgentAnswer('```json\n'+JSON.stringify(value)+'\n```'),value);
  assert.throws(()=>parseAgentAnswer('前言\n```json\n'+JSON.stringify(value)+'\n```'));
  assert.throws(()=>parseAgentAnswer(JSON.stringify({...value,userId:'other'})));
});
test('knowledge splits retain all characters and bound UTF-8 payload, including long paragraphs',()=>{
  const input='第一段。'.repeat(500)+'\n\n第二段。'.repeat(30);
  const chunks=splitKnowledge(input);
  assert(chunks.length>1);assert(chunks.every(v=>Buffer.byteLength(v)<=2000));
  assert.equal(chunks.join('').replace(/\s/g,''),input.replace(/\s/g,''));
});
test('RPage official article excludes surrounding navigation and preserves paragraph text',()=>{
  const text='這是學校正式文章，保留完整的段落內容與辦理流程說明。'.repeat(3);
  const page=parseOfficialPage({status:200,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from(`<title>辦理說明</title><main>其他處室選單<div class="mpgdetail"><p>${text}</p></div>分享瀏覽數</main>`)},new URL('https://student.nutc.edu.tw/p/404-1020-553.php'));
  assert.equal(page.text,text);assert.equal(page.title,'辦理說明');
});
