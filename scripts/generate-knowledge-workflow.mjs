import {writeFileSync} from 'node:fs';
const ai='@n8n/n8n-nodes-langchain.',core='n8n-nodes-base.';
const node=(id,name,type,typeVersion,position,parameters,extra={})=>({id,name,type,typeVersion,position,parameters,...extra});
const service={httpHeaderAuth:{id:'campus-live-service',name:'Campus live service'}};
const http=(id,name,x,path,body)=>node(id,name,core+'httpRequest',4.4,[x,0],{method:'POST',url:'http://gateway:3100/internal/v1/knowledge/'+path,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:15000}},{credentials:service,retryOnFail:false});
const metadata=['batchId','chunkId','sourceId','url','title','version','page','section','chunkIndex','fetchedAt','publishedAt','validUntil','effectiveFrom','effectiveUntil','schoolType','embeddingModel','dimensions','notice'];
const nodes=[
 node('manual','管理者手動匯入',core+'manualTrigger',1,[0,0],{}),
 http('fetch','讀取核定官方文件',240,'prepare','{}'),
 node('loop','逐段建立向量',core+'splitInBatches',3,[480,0],{batchSize:1,options:{}}),
 node('changed','內容是否變更',core+'if',2.2,[720,200],{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{leftValue:'={{ $json.needsEmbedding }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}),
 node('insert','暫存 PGVector',ai+'vectorStorePGVector',1.3,[1000,200],{mode:'insert',tableName:'campus_knowledge_staging',options:{}},{credentials:{postgres:{id:'campus-agent-postgres',name:'Campus Agent Postgres'}},retryOnFail:false}),
 node('embedding','真實 Gemini Embeddings',ai+'embeddingsGoogleGemini',1,[960,460],{modelName:'models/gemini-embedding-001'},{credentials:{googlePalmApi:{id:'campus-live-gemini-proxy',name:'Campus Gemini proxy'}}}),
 node('loader','官方段落與來源',ai+'documentDefaultDataLoader',1.1,[1200,460],{dataType:'json',jsonMode:'expressionData',jsonData:'={{ $json.text }}',textSplittingMode:'custom',options:{metadata:{metadataValues:metadata.map(name=>({name,value:`={{ $json.metadata.${name} }}`}))}}}),
 node('splitter','保留已切好的段落',ai+'textSplitterRecursiveCharacterTextSplitter',1,[1200,680],{chunkSize:8000,chunkOverlap:0,options:{}}),
 http('publish','驗證整批並原子發布',760,'publish',"={{ JSON.stringify({batchId:$('讀取核定官方文件').first().json.metadata.batchId}) }}"),
 node('note','發布規則',core+'stickyNote',1,[0,-240],{content:'## 官方語料匯入\n固定核定來源 → 逐段原生 Gemini Embeddings → PGVector 暫存 → 驗證全批 → 原子發布。\n不接受任意網址；不匯入學生私人資料。僅由管理者手動啟動。',width:640,height:180}),
];
const connections={};const link=(a,b,type='main',index=0)=>{connections[a]??={};connections[a][type]??=[];while(connections[a][type].length<=index)connections[a][type].push([]);connections[a][type][index].push({node:b,type,index:0});};
link('管理者手動匯入','讀取核定官方文件');link('讀取核定官方文件','逐段建立向量');link('逐段建立向量','驗證整批並原子發布');link('逐段建立向量','內容是否變更','main',1);link('內容是否變更','暫存 PGVector');link('內容是否變更','逐段建立向量','main',1);link('暫存 PGVector','逐段建立向量');link('真實 Gemini Embeddings','暫存 PGVector','ai_embedding');link('官方段落與來源','暫存 PGVector','ai_document');link('保留已切好的段落','官方段落與來源','ai_textSplitter');
writeFileSync('workflows/agent/campusKnowledgeIngest.json',JSON.stringify({id:'campusKnowledgeIngest',name:'Campus 官方語料 · 原生 Embeddings 匯入',active:false,nodes,connections,settings:{executionOrder:'v1',executionTimeout:300,saveDataErrorExecution:'all',saveDataSuccessExecution:'all',saveManualExecutions:true},pinData:{}},null,2)+'\n');
console.log('Generated atomic official knowledge ingestion workflow.');
