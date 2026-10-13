import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('search body avoids premature n8n expression closing and preserves query as text',()=>{
 const workflow=JSON.parse(readFileSync('workflows/agent/campusGoogleSearch.json','utf8'));
 const main=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
 assert.equal(main.nodes.find((node:{name:string})=>node.name==='official_search').parameters.options.timeout,35000);
 assert.equal(workflow.nodes.find((node:{id:string})=>node.id==='google').parameters.options.timeout,25000);
 const expression=workflow.nodes.find((node:{id:string})=>node.id==='google').parameters.jsonBody as string;
 assert(expression.startsWith('={{ ')&&expression.endsWith(' }}'));
 const body=expression.slice(3,-2);
 // n8n 2.41.7 reports "invalid syntax" if nested object braces close this
 // template early. JS compilation alone does not catch this runtime failure.
 assert(!body.includes('}}'),'nested closing braces must be separated inside the n8n expression');
 const evaluate=new Function('$json',`return (${body});`);
 for(const query of ['公開校園問題','文字 }}} {{ " \\ \n 不得變成指令']){
  const request=JSON.parse(evaluate({body:{query}}));
  assert.equal(request.contents[0].parts[0].text,query);
  assert.deepEqual(request.tools,[{google_search:{}}]);
  assert.equal(request.generationConfig.maxOutputTokens,2048);
  assert.equal(request.generationConfig.candidateCount,1);
 }
});
