import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Isolated, non-persistent verification of the generated Agent + official_search tool on the
// pinned n8n runtime. This file only orchestrates: it reads (never writes) n8n through REST, then
// executes an in-memory graph inside the existing n8n container via check-direct-agent-runtime.cjs.
export const PINNED_VERSION='2.41.7';
export const EVIDENCE_DIR='.local/verification/agent-direct-google-search';
export const TEST_PROMPT='請使用 official_search 查詢國立臺中科技大學官方網站（nutc.edu.tw）目前公開的最新消息或公告，再用繁體中文簡短摘要。最後以「來源：」逐行列出工具返回的 grounding 來源完整網址，不要自行編造或改寫網址。';
const MARK='@@DIRECT_AGENT_REPORT@@';
const fixed=code=>Object.assign(new Error(code),{code});

export function parseLocalBase(value='http://127.0.0.1:15680'){
  let url;
  try{url=new URL(value);}catch{throw fixed('N8N_BASE_URL_INVALID');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||(url.pathname!=='/'&&url.pathname!==''))throw fixed('N8N_BASE_URL_NOT_LOCAL');
  return url.origin;
}

export function googleRef(node){
  const ref=node?.credentials?.googlePalmApi;
  if(!ref||typeof ref.id!=='string'||!ref.id||typeof ref.name!=='string'||!ref.name)return undefined;
  return {id:ref.id,name:ref.name};
}

// Chat and Embeddings in the live main must already share one real Google credential; never guess.
export function liveGoogleRef(main){
  const chat=googleRef(main?.nodes?.find(n=>n.name==='Gemini Chat Model'));
  const embedding=googleRef(main?.nodes?.find(n=>n.name==='Google Gemini Embeddings'));
  if(!chat||!embedding)throw fixed('GOOGLE_CREDENTIAL_REF_MISSING');
  if(chat.id!==embedding.id||chat.name!==embedding.name)throw fixed('GOOGLE_CREDENTIAL_REF_MISMATCH');
  return chat;
}

// Minimal graph: Manual Trigger -> native Agent with the generated Chat Model and official_search only.
// No webhook, gateway, Postgres memory, RAG, personal tools, completion or LINE node is present.
export function isolatedGraph(source){
  const pick=name=>{
    const node=source?.nodes?.find(n=>n.name===name);
    if(!node)throw fixed('SOURCE_NODE_MISSING');
    return structuredClone(node);
  };
  const agent=pick('AI Agent'),guard=pick('驗證搜尋來源'),chat=pick('Gemini Chat Model'),tool=pick('official_search');
  delete agent.onError;
  agent.parameters.text=TEST_PROMPT;
  agent.parameters.options.systemMessage=agent.parameters.options.systemMessage.replace("$now.setZone('Asia/Taipei').setLocale('zh-TW').toFormat('yyyy-MM-dd cccc HH:mm:ss')", JSON.stringify('2026-10-13 星期二 12:00:00'));
  agent.position=[240,0];guard.position=[480,0];
  chat.position=[240,240];tool.position=[480,240];
  const trigger={id:'manual',name:'Manual Trigger',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
  return {
    nodes:[trigger,agent,guard,chat,tool],
    connections:{
      'Manual Trigger':{main:[[{node:'AI Agent',type:'main',index:0}]]},
      'AI Agent':{main:[[{node:'驗證搜尋來源',type:'main',index:0}]]},
      'Gemini Chat Model':{ai_languageModel:[[{node:'AI Agent',type:'ai_languageModel',index:0}]]},
      official_search:{ai_tool:[[{node:'AI Agent',type:'ai_tool',index:0}]]},
    },
  };
}

export const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

// Stable, content-free fingerprint of the workflow inventory (ids, names, versions, publication).
export function inventory(list){
  return list.map(w=>({id:w.id,name:w.name,active:Boolean(w.active),versionId:w.versionId??null,activeVersionId:w.activeVersionId??null,archived:Boolean(w.isArchived)}))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

// Returns the list of failed check names; empty means every runtime assertion held.
export function failedChecks(report){
  const failed=[];
  const check=(name,ok)=>{if(!ok)failed.push(name);};
  check('ok',report?.ok===true);
  check('n8nVersion',report?.n8nVersion===PINNED_VERSION);
  check('officialSearchCalled',Number.isInteger(report?.toolCallCount)&&report.toolCallCount>=1&&report.toolNames?.includes('official_search'));
  check('onlyOfficialSearchTool',Array.isArray(report?.toolNames)&&report.toolNames.every(n=>n==='official_search'));
  check('nonEmptyGroundedToolAnswer',Array.isArray(report?.observationTextLengths)&&report.observationTextLengths.length>=1&&report.observationTextLengths.every(n=>n>0));
  check('groundingChunks',report?.groundingUrlCount>0);
  check('nonEmptyFinalAnswer',report?.answerLength>0);
  check('answerHasSourceUrl',report?.answerUrlCount>=1);
  check('answerUrlsSubsetOfGrounding',report?.answerUrlsSubsetOfGrounding===true);
  check('publicQueryOnly',report?.publicQueryOnly===true);
  check('noPersistentWorkflow',report?.persistentWorkflowCreated===false);
  check('noLineMessage',report?.lineMessagesSent===0);
  check('noMemory',report?.memoryNodesUsed===false);
  return failed;
}

export function extractReport(stdout){
  const line=String(stdout).split('\n').findLast(l=>l.startsWith(MARK));
  if(!line)throw fixed('RUNTIME_REPORT_MISSING');
  try{return JSON.parse(line.slice(MARK.length));}catch{throw fixed('RUNTIME_REPORT_INVALID');}
}

function run(command,args,{input,timeout=30000,limit=256*1024}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(fixed('COMMAND_TIMEOUT'));},timeout);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>limit)stdout=stdout.slice(-limit);});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>limit)stderr=stderr.slice(-limit);});
    child.on('error',()=>finish(fixed('COMMAND_UNAVAILABLE')));
    child.on('close',status=>finish(undefined,{status,stdout,stderr}));
    child.stdin.on('error',()=>{});
    child.stdin.end(input??'');
  });
}

async function session(base,email,password){
  let response;
  try{response=await fetch(`${base}/rest/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailOrLdapLoginId:email,password}),redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw fixed('N8N_UNREACHABLE');}
  if(!response.ok)throw fixed(`N8N_LOGIN_HTTP_${response.status}`);
  const cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  return async path=>{
    let r;
    try{r=await fetch(`${base}/rest${path}`,{headers:{cookie},redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch{throw fixed('N8N_REQUEST_FAILED');}
    if(!r.ok)throw fixed(`N8N_GET_HTTP_${r.status}`);
    const body=await r.json();return body.data??body;
  };
}

async function readOnlyState(get){
  const list=await get('/workflows');
  const items=Array.isArray(list)?list:list.data;
  if(!Array.isArray(items))throw fixed('WORKFLOW_INVENTORY_INVALID');
  const graphs=await Promise.all(items.map(w=>get(`/workflows/${encodeURIComponent(w.id)}`)));
  const main=graphs.find(w=>w.id==='campusNativeAgentLive');
  if(!main)throw fixed('MAIN_WORKFLOW_MISSING');
  const hashes=graphs.map(w=>({id:w.id,hash:sha256({nodes:w.nodes,connections:w.connections,settings:w.settings,pinData:w.pinData,activeVersion:w.activeVersion})})).sort((a,b)=>a.id.localeCompare(b.id));
  return {inventory:inventory(items),hashes,main};
}

function loadSource(){
  try{return JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));}
  catch{throw fixed('SOURCE_WORKFLOW_UNREADABLE');}
}

export async function verify({env=process.env,source=loadSource(),harness=readFileSync(new URL('./check-direct-agent-runtime.cjs',import.meta.url),'utf8')}={}){
  const base=parseLocalBase(env.N8N_BASE_URL_CHECK??'http://127.0.0.1:15680');
  if(!env.N8N_OWNER_EMAIL||!env.N8N_OWNER_PASSWORD)throw fixed('N8N_OWNER_ENV_MISSING');
  const get=await session(base,env.N8N_OWNER_EMAIL,env.N8N_OWNER_PASSWORD);
  const before=await readOnlyState(get);
  const ref=liveGoogleRef(before.main);
  const graph=isolatedGraph(source);
  assert(!JSON.stringify(graph).includes('credentials'),'source graph must not carry credential references');

  const found=await run('docker',['compose','ps','-q','n8n']);
  const container=found.stdout.trim();
  if(!/^[0-9a-f]{12,64}$/.test(container))throw fixed('N8N_CONTAINER_NOT_FOUND');
  const inspected=await run('docker',['inspect','-f','{{.Config.Image}}',container]);
  const image=inspected.stdout.trim();
  const composeText=readFileSync('docker-compose.yml','utf8').replace(/"\s*\n\s*/g,'').replace(/\\\n\s*/g,'');
  const digest=image.match(/sha256:[0-9a-f]{64}/)?.[0];
  if(!image.includes(`n8n:${PINNED_VERSION}@`)||!digest||!composeText.includes(digest))throw fixed('N8N_IMAGE_NOT_PINNED');

  let dir;
  try{
    const placed=await run('docker',['exec','-i',container,'sh','-c','umask 077; d=$(mktemp -d /tmp/direct-agent-XXXXXX) && cat > "$d/run.cjs" && echo "$d"'],{input:harness});
    dir=placed.stdout.trim();
    if(placed.status!==0||!/^\/tmp\/direct-agent-[A-Za-z0-9]+$/.test(dir)){dir=undefined;throw fixed('HARNESS_PLACEMENT_FAILED');}
    const payload=JSON.stringify({graph,ref,prompt:TEST_PROMPT});
    const executed=await run('docker',['exec','-i','-e','N8N_LOG_LEVEL=error',container,'node',`${dir}/run.cjs`],{input:payload,timeout:200000});
    var report=extractReport(executed.stdout);
  }finally{
    if(dir)await run('docker',['exec',container,'rm','-rf',dir]).catch(()=>{});
  }
  const after=await readOnlyState(get);
  const failed=failedChecks(report);
  const unchanged=JSON.stringify(before.inventory)===JSON.stringify(after.inventory)&&before.main.checksum===after.main.checksum&&before.main.versionId===after.main.versionId&&JSON.stringify(before.hashes)===JSON.stringify(after.hashes);
  if(!unchanged)failed.push('workflowInventoryUnchanged');
  const result={
    checkedAt:new Date().toISOString(),via:'native n8n 2.41.7 Agent + generated official_search (memory-only execution)',
    image:image.replace(/@sha256:[0-9a-f]{64}$/,'@sha256:<pinned>'),imageDigestMatchesCompose:true,
    n8nVersion:report.n8nVersion,
    sourceMainSha256:sha256(JSON.stringify(source)),isolatedGraphSha256:sha256(graph),harnessSha256:sha256(harness),
    toolCallCount:report.toolCallCount,toolNames:report.toolNames,observationTextLengths:report.observationTextLengths,
    groundingUrlCount:report.groundingUrlCount,answerLength:report.answerLength,answerUrlCount:report.answerUrlCount,
    answerUrlsSubsetOfGrounding:report.answerUrlsSubsetOfGrounding,publicQueryOnly:report.publicQueryOnly,
    persistentWorkflowCreated:report.persistentWorkflowCreated,lineMessagesSent:report.lineMessagesSent,memoryNodesUsed:report.memoryNodesUsed,
    googleCredentialRefEqualChatAndEmbedding:true,
    workflowInventoryUnchanged:unchanged,workflowCount:after.inventory.length,mainChecksumUnchanged:before.main.checksum===after.main.checksum,
    ...(report.ok===true?{}:{harnessCode:/^[A-Z0-9_]+$/.test(report.code??'')?report.code:'HARNESS_FAILED'}),
    failedChecks:failed,status:failed.length?'fail':'pass',paidAttempts:1,
  };
  mkdirSync(EVIDENCE_DIR,{recursive:true,mode:0o700});chmodSync(EVIDENCE_DIR,0o700);
  const file=`${EVIDENCE_DIR}/live-gemini.json`;
  writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});chmodSync(file,0o600);
  return result;
}

async function main(){
  try{
    process.loadEnvFile(new URL('../.env',import.meta.url));
    const result=await verify();
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='pass')process.exitCode=1;
  }catch(error){
    console.error(JSON.stringify({status:'fail',code:/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'VERIFY_FAILED'}));
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
