'use strict';
// Runs inside the pinned n8n container (no secrets in this file). The workflow graph and the
// credential reference arrive on stdin; the graph executes in memory with n8n's native engine,
// nodes and CredentialsHelper. Nothing is persisted: no execution row, no workflow row, no
// webhook, no LINE call. Only fixed codes and derived facts are printed — never raw node output.
const {createRequire}=require('node:module');
const ROOT='/usr/local/lib/node_modules/n8n/package.json';
const req=createRequire(ROOT);
const MARK='@@DIRECT_AGENT_REPORT@@';
const DEADLINE_MS=170000;
const out=report=>process.stdout.write(`${MARK}${JSON.stringify(report)}\n`);
const fail=(code,extra={})=>{out({ok:false,code,...extra});process.exitCode=1;};

async function readStdin(){
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>512*1024)throw new Error('INPUT_TOO_LARGE');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('BAD_INPUT');}
}
const urlsIn=text=>[...String(text).matchAll(/https?:\/\/[^\s)）」』>\]"'，。]+/g)].map(m=>m[0].replace(/[.,;:!?、。，；：]+$/,''));
function parseGroundedObservation(observation){
  let parsed;
  try{parsed=typeof observation==='string'?JSON.parse(observation):observation;}catch{return {textLength:0,uris:[]};}
  const response=Array.isArray(parsed)&&parsed.length===1?parsed[0]:parsed;
  const candidate=response?.candidates?.[0];
  const text=(candidate?.content?.parts??[]).map(part=>typeof part.text==='string'?part.text:'').join('').trim();
  const chunks=candidate?.groundingMetadata?.groundingChunks??[];
  const uris=chunks.map(chunk=>chunk?.web?.uri).filter(uri=>typeof uri==='string'&&uri.length>0);
  return {textLength:text.length,uris};
}

async function main(){
  const input=await readStdin();
  const {graph,ref,prompt,workflowId}=input;
  if(!graph||!Array.isArray(graph.nodes)||!ref?.id||!ref?.name||typeof prompt!=='string')throw new Error('BAD_INPUT');
  for(const n of graph.nodes)if(/webhook|postgres|respondToWebhook|executeWorkflow|toolWorkflow|memory|vectorStore|embeddings/i.test(n.type))throw new Error('GRAPH_NOT_ISOLATED');
  for(const n of graph.nodes)if(n.type.endsWith('httpRequest')||n.type.endsWith('httpRequestTool')){
    if(n.name!=='official_search')throw new Error('GRAPH_NOT_ISOLATED');
    if(n.parameters.url!=='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')throw new Error('GRAPH_NOT_ISOLATED');
  }
  req('reflect-metadata');
  const {Container}=req('@n8n/di');
  const {LicenseState}=req('@n8n/backend-common');
  const {GlobalConfig}=req('@n8n/config');
  const {InstanceSettings,ExecutionLifecycleHooks,WorkflowExecute}=req('n8n-core');
  const {Workflow,Expression,createRunExecutionData}=req('n8n-workflow');
  const {DbConnection,DeploymentKeyRepository}=req('@n8n/db');
  const dist='/usr/local/lib/node_modules/n8n/dist/';
  const {NodeTypes}=req(dist+'node-types');
  const {LoadNodesAndCredentials}=req(dist+'load-nodes-and-credentials');
  const {EncryptionBootstrapService}=req(dist+'encryption/encryption-bootstrap.service');
  const {getBase}=req(dist+'workflow-execute-additional-data');
  const {N8N_VERSION}=req(dist+'constants');

  const globalConfig=Container.get(GlobalConfig);
  const dbConnection=Container.get(DbConnection);
  let engineStarted=false,dbStarted=false;
  const cleanup=async()=>{
    try{if(engineStarted)await Expression.disposeExpressionEngine();}catch{}
    try{if(dbStarted)await dbConnection.close();}catch{}
  };
  try{
    // Community defaults without License.init(): that would renew/save certificates (network and DB writes).
    Container.get(LicenseState).setLicenseProvider({isLicensed:()=>false,getValue:()=>undefined,getPlanName:()=>'Community'});
    const nodeTypes=Container.get(NodeTypes);
    await Container.get(LoadNodesAndCredentials).init();
    await dbConnection.init();dbStarted=true;
    // Read-only bootstrap: no migrate(), no key seeding. The provider only decrypts existing credentials.
    const instanceSettings=Container.get(InstanceSettings);
    await instanceSettings.initialize(Container.get(DeploymentKeyRepository),{canSeed:false});
    await Container.get(EncryptionBootstrapService).run();
    const e=globalConfig.expressionEngine;
    await Expression.initExpressionEngine({engine:e.engine,poolSize:e.poolSize,maxCodeCacheSize:e.maxCodeCacheSize,bridgeTimeout:e.bridgeTimeout,bridgeMemoryLimit:e.bridgeMemoryLimit,idleTimeoutMs:e.idleTimeout===undefined?undefined:e.idleTimeout*1000,lazyAcquire:e.lazyAcquire,compileCache:e.compileCache});
    engineStarted=true;

    // Runtime credential reference is applied only in memory to the two Google-authenticated nodes.
    const nodes=graph.nodes.map(n=>structuredClone(n));
    for(const n of nodes){
      if(n.type==='@n8n/n8n-nodes-langchain.lmChatGoogleGemini'||n.name==='official_search')n.credentials={googlePalmApi:{id:ref.id,name:ref.name}};
    }
    const workflowData={id:workflowId||'direct-agent-memory-check',name:'direct-agent-memory-check',active:false,nodes,connections:graph.connections,settings:{executionOrder:'v1'},pinData:{}};
    const workflow=new Workflow({id:workflowData.id,name:workflowData.name,nodes,connections:graph.connections,active:false,nodeTypes,settings:workflowData.settings,pinData:{}});
    const additionalData=await getBase({workflowId:undefined});
    const refuse=async()=>{throw new Error('SUBWORKFLOW_DENIED');};
    additionalData.executeWorkflow=refuse;additionalData.executeAgent=refuse;additionalData.listAgents=async()=>[];
    additionalData.startRunnerTask=refuse;additionalData.getRunExecutionData=refuse;
    additionalData.logAiEvent=()=>{};additionalData.logHitlResponse=()=>{};additionalData.setExecutionStatus=()=>{};
    additionalData.executionId='memory-only';
    // Memory-only lifecycle: no handlers are registered, so nothing is persisted or emitted.
    additionalData.hooks=new ExecutionLifecycleHooks('manual','memory-only',workflowData);

    const trigger=nodes.find(n=>n.type==='n8n-nodes-base.manualTrigger');
    if(!trigger)throw new Error('NO_TRIGGER');
    const startNode=workflow.getNode(trigger.name);
    const executor=new WorkflowExecute(additionalData,'manual',createRunExecutionData());
    const runPromise=executor.run({workflow,startNode,pinData:{}});
    const run=await runPromise;
    const resultError=run.data?.resultData?.error;
    if(resultError)return fail('AGENT_EXECUTION_FAILED',{n8nVersion:N8N_VERSION});
    const agentRuns=run.data.resultData.runData['AI Agent']??[];
    const agentItem=agentRuns[0]?.data?.main?.[0]?.[0]?.json;
    if(!agentItem)return fail('AGENT_NO_OUTPUT',{n8nVersion:N8N_VERSION});
    const guardRuns=run.data.resultData.runData['驗證搜尋來源']??[];
    const guardItem=guardRuns[0]?.data?.main?.[0]?.[0]?.json;
    if(!guardItem)return fail('SEARCH_GUARD_NO_OUTPUT',{n8nVersion:N8N_VERSION});
    const steps=Array.isArray(agentItem.intermediateSteps)?agentItem.intermediateSteps:[];
    const searchSteps=steps.filter(s=>s?.action?.tool==='official_search');
    const answer=typeof guardItem.output==='string'?guardItem.output:'';
    const analysis=searchSteps.map(step=>{
      const toolInput=step.action?.toolInput;
      let queryText='';
      if(typeof toolInput==='string')queryText=toolInput;
      else if(toolInput&&typeof toolInput==='object')queryText=typeof toolInput.query==='string'?toolInput.query:'';
      const inputKeys=toolInput&&typeof toolInput==='object'?Object.keys(toolInput).filter(k=>k!=='id'):[];
      const grounded=parseGroundedObservation(step.observation);
      return {queryOnly:(inputKeys.length===0||(inputKeys.length===1&&inputKeys[0]==='query'))&&queryText.trim().length>0&&queryText.length<=500,...grounded};
    });
    const groundingUris=[...new Set(analysis.flatMap(a=>a.uris))];
    const answerUrls=[...new Set(urlsIn(answer))];
    const report={
      ok:true,n8nVersion:N8N_VERSION,
      toolCallCount:searchSteps.length,
      toolNames:[...new Set(steps.map(s=>s?.action?.tool).filter(Boolean))],
      observationTextLengths:analysis.map(a=>a.textLength),
      groundingUrlCount:groundingUris.length,
      answerLength:answer.trim().length,
      answerUrlCount:answerUrls.length,
      answerUrlsSubsetOfGrounding:answerUrls.length>0&&answerUrls.every(u=>groundingUris.includes(u)),
      publicQueryOnly:analysis.length>0&&analysis.every(a=>a.queryOnly),
      persistentWorkflowCreated:false,lineMessagesSent:0,memoryNodesUsed:false,
      nodesInGraph:nodes.length,
    };
    out(report);
  }finally{await cleanup();}
}

module.exports={parseGroundedObservation};
if(require.main===module){
  const timer=setTimeout(()=>{fail('RUNTIME_TIMEOUT');process.exit(1);},DEADLINE_MS);
  main().then(()=>{clearTimeout(timer);process.exit(process.exitCode??0);}).catch(error=>{
    clearTimeout(timer);
    const code=/^(BAD_INPUT|GRAPH_NOT_ISOLATED|INPUT_TOO_LARGE|NO_TRIGGER)$/.test(error?.message)?error.message:'HARNESS_FAILED';
    fail(code);
    process.exit(1);
  });
}
