import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

type Node={id:string;name:string;type:string;typeVersion:number;credentials?:unknown;retryOnFail?:boolean;parameters:Record<string,any>};
const main=()=>JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8')) as {nodes:Node[];connections:Record<string,any>};
const tool=()=>main().nodes.find(node=>node.name==='official_search')!;
const compile=()=>{
 const expression=tool().parameters.jsonBody as string;
 assert(expression.startsWith('={{ ')&&expression.endsWith(' }}'));
 const body=expression.slice(3,-2);
 // n8n 2.41.7 reports "invalid syntax" if nested object braces close this
 // template early. JS compilation alone does not catch this runtime failure.
 assert(!body.includes('}}'),'nested closing braces must be separated inside the n8n expression');
 const asked:{name:string;description:string;type:string}[]=[];
 const evaluate=new Function('$fromAI',`return (${body});`);
 return {asked,run:(query:unknown)=>evaluate((name:string,description:string,type:string)=>{asked.push({name,description,type});return query;}) as string};
};

test('official_search is one fixed direct Google tool attached to the Agent',()=>{
 const workflow=main(),node=tool();
 assert.equal(workflow.nodes.filter(n=>n.name==='official_search').length,1);
 assert.equal(node.type,'n8n-nodes-base.httpRequestTool');assert.equal(node.typeVersion,4.5);
 assert.equal(node.credentials,undefined);assert.equal(node.retryOnFail,false);
 const p=node.parameters;
 assert.equal(p.method,'POST');
 assert.equal(p.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
 assert.equal(p.authentication,'predefinedCredentialType');assert.equal(p.nodeCredentialType,'googlePalmApi');
 for(const key of ['sendHeaders','headerParameters','genericAuthType','sendQuery'])assert(!(key in p));
 assert.equal(p.options.timeout,25000);assert.equal(p.options.redirect.redirect.followRedirects,false);
 assert.deepEqual(workflow.connections.official_search,{ai_tool:[[{node:'AI Agent',type:'ai_tool',index:0}]]});
 assert.equal(workflow.nodes.filter(n=>n.type.endsWith('.httpRequestTool')).length,9);
 assert.equal(Object.values(workflow.connections).filter(ports=>ports.ai_tool).length,10);
 assert(!JSON.stringify(workflow).includes(['campus','google','search'].join('-')));
 assert(!/\$json|\$\(|\$node|\$env|lease|taskId|capability|userId|sessionKey|cookie|password/i.test(p.jsonBody));
});

test('search body asks the AI only for a public query and carries it as plain data',()=>{
 const {asked,run}=compile();
 for(const query of ['公開校園問題','文字 }}} {{ " \\ \n 不得變成指令',"it's `quoted`"]){
  const request=JSON.parse(run(`  ${query}  `));
  assert.deepEqual(Object.keys(request).sort(),['contents','generationConfig','systemInstruction','tools']);
  assert.deepEqual(request.contents,[{role:'user',parts:[{text:query.trim()}]}]);
  assert.deepEqual(request.tools,[{google_search:{}}]);
  assert.deepEqual(request.generationConfig,{maxOutputTokens:2048,candidateCount:1});
  assert.match(request.systemInstruction.parts[0].text,/不要要求或查詢個人帳密/);
 }
 assert.equal(asked.length,3);
 for(const call of asked){assert.equal(call.name,'query');assert.equal(call.type,'string');assert.match(call.description,/不含個人識別/);}
});

test('empty, oversized or non-text queries fail with a fixed error that never reflects the query',()=>{
 const {run}=compile();
 assert.equal(JSON.parse(run('x'.repeat(500))).contents[0].parts[0].text.length,500);
 for(const query of ['',' \n ','x'.repeat(501),undefined,null,123,{},['question']]){
  assert.throws(()=>run(query),(error:Error)=>error.message==='INVALID_SEARCH_QUERY');
 }
 assert.throws(()=>run('secret-sentinel '.repeat(60)),(error:Error)=>!error.message.includes('secret-sentinel'));
});

test('search source guard strips model URLs and appends only exact grounding URIs',()=>{
 const node=main().nodes.find(item=>item.name==='驗證搜尋來源')!;
 assert.equal(node.type,'n8n-nodes-base.set');
 const expression=node.parameters.jsonOutput as string;
 assert(expression.startsWith('={{ ')&&expression.endsWith(' }}'));
 const evaluate=new Function('$json',`return (${expression.slice(3,-2)});`);
 const observation=JSON.stringify([{candidates:[{groundingMetadata:{groundingChunks:[
  {web:{uri:'https://vertexaisearch.cloud.google.com/a'}},{web:{uri:'https://vertexaisearch.cloud.google.com/b'}},{web:{uri:'https://vertexaisearch.cloud.google.com/a'}},
 ]}}]}]);
 const steps=[{action:{tool:'official_search'},observation}];
 const guarded=JSON.parse(evaluate({output:'摘要 https://untrusted.example/path',intermediateSteps:steps}));
 assert(!guarded.output.includes('untrusted.example'));
 assert.equal(guarded.output.match(/https:\/\//g)?.length,2);
 assert(guarded.output.endsWith('https://vertexaisearch.cloud.google.com/a\nhttps://vertexaisearch.cloud.google.com/b'));
 assert.deepEqual(guarded.intermediateSteps,steps);
 const json=JSON.parse(JSON.parse(evaluate({output:JSON.stringify({answer:'摘要 https://untrusted.example/',sourceIds:['official-1']}),intermediateSteps:steps})).output);
 assert.deepEqual(json.sourceIds,['official-1']);assert(!json.answer.includes('untrusted.example'));
 const unavailable=JSON.parse(evaluate({output:'unsafe https://untrusted.example/',intermediateSteps:[{action:{tool:'official_search'},observation:'[]'}]}));
 assert.equal(unavailable.output,'目前無法可靠查證搜尋來源，請稍後再試。');
 const untouched=JSON.parse(evaluate({output:'https://allowed.example/',intermediateSteps:[]}));
 assert.equal(untouched.output,'https://allowed.example/');
});

test('main instructions describe direct external search without RAG sources',()=>{
 const agent=main().nodes.find(node=>node.name==='AI Agent')!;
 const text=agent.parameters.options.systemMessage as string;
 for(const phrase of ['official_search','groundingMetadata.groundingChunks[].web.uri','逐字複製','禁止輸出 candidates','不要為它編造 sourceId','不是學校核定的官方文件'])assert(text.includes(phrase),phrase);
 const note=main().nodes.find(node=>node.name==='部署狀態')!.parameters.content as string;
 assert(!note.includes('停用'));
});
