import {writeFileSync,mkdirSync} from 'node:fs';
const ids=Object.fromEntries([1,2,3,4,5,6,7].map(i=>[i,`campusWF0${i}phase1`]));
const creds=Object.fromEntries(['task','demo','maintenance','knowledge','observability','webhook'].map(s=>[s,{id:`campus-${s}-synthetic`,name:`Campus synthetic ${s}`} ]));
const names={1:'campus-message-v1',2:'campus-public-qa-v1',3:'campus-personal-query-v1',4:'campus-workflow-error-v1',5:'campus-maintenance-v1',6:'campus-demo-v1',7:'campus-knowledge-sync-v1'};
const manifests=[];
function workflow(number,build) {
 const nodes=[],connections={};let index=0;
 const node=(id,label,type,parameters={},extra={})=>{const name=`${id} ${label}`;nodes.push({id,name,type:`n8n-nodes-base.${type}`,typeVersion:({httpRequest:4.4,set:3.4,if:2.2,switch:3.3,executeWorkflow:1.3,executeWorkflowTrigger:1.1,webhook:2.1,stickyNote:1,scheduleTrigger:1.2})[type]??1,position:[(index++%8)*260,Math.floor((index-1)/8)*260],parameters,...extra});return name;};
 const edge=(from,to,output=0)=>{connections[from]??={main:[]};while(connections[from].main.length<=output)connections[from].main.push([]);connections[from].main[output].push({node:to,type:'main',index:0});};
 const set=(id,label,expr)=>node(id,label,'set',{mode:'raw',jsonOutput:`={{ JSON.stringify(${expr}) }}`,options:{}});
 const trig=(id,label,type='executeWorkflowTrigger')=>node(id,label,type,type==='executeWorkflowTrigger'?{inputSource:'passthrough'}:{});
 const condition=(id,label,expr)=>node(id,label,'if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:`${id}-rule`,leftValue:`={{ ${expr} }}`,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
 const sw=(id,label,field,values)=>node(id,label,'switch',{rules:{values:values.map(value=>({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{leftValue:`={{ $json.${field} }}`,rightValue:value,operator:{type:'string',operation:'equals'}}],combinator:'and'},renameOutput:true,outputKey:value}))},options:{fallbackOutput:'extra'}});
 const http=(id,label,path,body='{}',scope='task',method='POST',task=true)=>{
  const capture=set(`${id}C`,'保存引用上下文','$json');
  const url=task?`={{ 'http://mock-gateway:3000/internal/v1/tasks/' + $json.taskId + '/${path}' }}`:`http://mock-gateway:3000/internal/v1/${path}`;
  const params={method,url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{timeout:20000,response:{response:{responseFormat:'json'}}},...(method==='POST'?{sendBody:true,specifyBody:'json',jsonBody:`={{ JSON.stringify(${body}) }}`}:{})};
  if(task)Object.assign(params,{sendHeaders:true,headerParameters:{parameters:[{name:'X-Task-Capability',value:'={{ $json.taskCapability }}'},{name:'X-Task-Lease',value:'={{ $json.leaseToken || "" }}'}]}});
  const request=node(id,label,'httpRequest',params,{credentials:{httpHeaderAuth:creds[scope]},retryOnFail:false});
  const restore=set(`${id}R`,'回復引用上下文',`({...$('${capture}').item.json, ...$json.data})`);
  edge(capture,request);edge(request,restore);
  return {start:capture,end:restore,request};
 };
 const call=(id,label,n,kind)=>{
  const prep=set(`${id}C`,'核定操作輸入',`({...$json, operationId:$json.operations.find(o=>o.kind==='${kind}').operationId, resultRefs:$json.resultRefs || []})`);
  const run=node(id,label,'executeWorkflow',{source:'database',workflowId:{__rl:true,value:ids[n],mode:'id'},mode:'each',options:{waitForSubWorkflow:true}});edge(prep,run);return {start:prep,end:run,request:run};
 };
 const note=(id,text,x,y)=>node(id,'資料邊界','stickyNote',{content:text,height:180,width:520},{position:[x,y]});
 build({node,edge,set,trig,condition,sw,http,call,note,nodes});
 // Stage-aligned canvas: the visible API is centered between its context adapters.
 const layouts={
  1:{M01:[0,0],M01N:[220,0],M02:[220,220],M03:[650,80],M04:[1150,80],M04D:[1400,950],M05:[1550,80],M06:[2050,80],M07:[2500,-160],M08:[2500,160],M09:[2500,480],M10:[3150,480],M11:[3650,480],M12:[3150,780],M13:[4150,80],M14:[4650,80],M15U:[2450,1100],M15E:[3100,1100],M15:[3800,1100]},
  2:{Q01:[0,0],Q02:[400,0],Q03:[900,0],Q04:[1350,-250],Q05:[1850,-250],Q06:[2200,80],Q07:[2850,80],Q08:[3500,0],Q09:[4000,0],Q10:[4400,250],Q11:[4900,250],Q12:[4400,650],Q12A:[3800,650],Q13:[5400,0],Q14:[6050,0],Q15:[6550,0],Q16:[6900,350],Q17:[7550,350],Q17A:[8050,350],Q18:[7550,800],Q19:[8500,0],Q20:[9000,0]},
  3:{P01:[0,0],P02:[400,0],P03:[900,0],P04:[1200,0],P05:[1650,-250],P06:[1650,80],P07:[1650,410],P08A:[2200,0],P08:[2650,0],P09:[2650,700],P09U:[1650,1000],P10:[3250,0]},
  4:{E01:[0,0],E02:[300,0],E03:[750,0]},
  5:{T01:[0,0],T01M:[0,230],T02:[450,80],T03:[1100,80],T04:[1600,80],T05:[2050,400],T06:[2050,80]},
  6:{D01:[0,0],D02:[300,0],D01T:[300,260],D03:[750,0],D04:[1250,0],D05:[1700,0],D06:[2200,0]},
  7:{K01:[0,0],K02:[0,230],K03:[450,80],K03A:[950,80],K03D:[950,1100],K04:[1400,80],K04A:[1900,80],K05:[2350,80],K05A:[2850,80],K06:[3300,80],K06A:[3800,80],K07:[4250,80],K07A:[4750,80],K07B:[4250,450],K08:[5200,80],K09:[5700,700],K10:[6200,80]}
 };
 for(const n of nodes) {
  const exact=layouts[number][n.id];const anchor=exact?null:layouts[number][n.id.replace(/[CR]$/,'')];
  if(exact)n.position=exact;
  else if(anchor)n.position=[anchor[0]+(n.id.endsWith('C')?-220:220),anchor[1]];
 }
 for(const n of nodes.filter(n=>n.id.endsWith('NOTE')))n.position=[0,-650];
 const obj={id:ids[number],name:names[number],active:false,nodes,connections,settings:{executionOrder:'v1',executionTimeout:number===7?600:100,saveDataErrorExecution:'all',saveDataSuccessExecution:'all',saveManualExecutions:true,callerPolicy:'workflowsFromSameOwner',...(number!==4?{errorWorkflow:ids[4]}:{})},pinData:{},tags:[]};
 mkdirSync('workflows',{recursive:true});writeFileSync(`workflows/WF-0${number}.json`,JSON.stringify(obj,null,2)+'\n');manifests.push({number,id:ids[number],name:names[number],nodeTypes:[...new Map(nodes.map(n=>[n.type,{type:n.type,typeVersion:n.typeVersion}])).values()]});
}
workflow(1,({node,edge,set,trig,condition,sw,http,call,note,nodes})=>{
 const webhook=node('M01','接收內部任務','webhook',{httpMethod:'POST',path:'campus-message-v1',authentication:'headerAuth',responseMode:'onReceived',options:{}},{webhookId:'campus-message-synthetic',credentials:{httpHeaderAuth:creds.webhook}});
 const normalize=set('M01N','Webhook body 引用','$json.body');edge(webhook,normalize);
 const entry=trig('M02','子流程入口');const claim=http('M03','領取任務','claim');edge(entry,claim.start);edge(normalize,claim.start);
 const acquired=condition('M04','是否取得執行權','$json.acquired === true');edge(claim.end,acquired);
 const stop=set('M04D','停止重複任務','({...$json,status:"duplicate_stopped"})');edge(acquired,stop,1);
 const plan=http('M05','意圖與參數規劃','plan');edge(acquired,plan.start);
 const intent=sw('M06','意圖分流','intent',['public','personal','mixed','local']);edge(plan.end,intent);
 const pub=call('M07','公開問答 WF-02',2,'public'), personal=call('M08','個人查詢 WF-03',3,'personal'),mixPub=call('M09','混合公開 WF-02',2,'public'),mixPersonal=call('M10','混合個人 WF-03',3,'personal');
 edge(intent,pub.start);edge(intent,personal.start,1);edge(intent,mixPub.start,2);edge(mixPub.end,mixPersonal.start);
 const collect=set('M11','彙整結果引用','$json');edge(mixPersonal.end,collect);
 const local=set('M12','使用提示結果','({...$json,resultRefs:[$json.resultRef]})');edge(intent,local,3);
 const complete=http('M13','完成並安排回覆','complete','{resultRefs:$json.resultRefs}');for(const a of [pub.end,personal.end,collect,local])edge(a,complete.start);
 const status=set('M14','回覆排程狀態','({taskId:$json.taskId,requestId:$json.requestId,status:$json.status,outcome:$json.outcome})');edge(complete.end,status);
 const unknown=set('M15U','未知意圖錯誤','({...$json,errorCode:"UNKNOWN_INTENT"})');edge(intent,unknown,4);
 const error=set('M15E','技術失敗引用',`({...$('${claim.end}').first().json,errorCode:'UPSTREAM_FAILED'})`);
 const fail=http('M15','回報可處理錯誤','fail','{errorCode:$json.errorCode}');edge(unknown,fail.start);edge(error,fail.start);edge(fail.end,status);
 for(const h of [plan,pub,personal,mixPub,mixPersonal,complete]) {nodes.find(n=>n.name===h.request).onError='continueErrorOutput';edge(h.request,error,1);}
 note('MZONE1','## 接收與授權\nWebhook／子流程 → claim。只有 acquired 繼續；重複事件正常停止。',0,-420);
 note('MZONE2','## 意圖規劃\nplan 只回核定 operations 與引用；Switch 有未知意圖出口。',1300,-420);
 note('MZONE3','## 公開問答\nWF-02：knowledge／web／both。只傳 queryRef、evidenceRef、resultRef。',2200,-420);
 note('MZONE4','## 個人查詢與混合\nWF-03：本人 Session；mixed 順序處理並保留兩個結果引用。',2900,-420);
 note('MZONE5','## 回覆\ncomplete 驗證結果引用、建立唯一合成 outbox。queued 不代表 delivered。',3900,-420);
 note('MZONE6','## 異常處理\nclaim 前錯誤交 WF-04；取得 lease 後走 fail。錯誤處理本身失敗不迴圈。',3100,1370);
 note('MNOTE','## 合成資料專用：接收 → 意圖規劃 → 公開／個人 → 回覆\n所有 HTTP 明確保存及回復 context；混合採順序執行。輸出 queued_for_delivery 不代表 LINE 已收到。',0,-230);
});
workflow(2,({edge,set,trig,condition,sw,http,note})=>{
 const entry=trig('Q01','公開操作輸入');
 const op='{operationId:$json.operationId}';
 const stage=(id,label,path,fields='')=>http(id,label,`public/${path}`,`{operationId:$json.operationId${fields}}`);
 const prepare=stage('Q02','準備核定路徑','prepare');edge(entry,prepare.start);
 const route=sw('Q03','來源分流','route',['knowledge','both','web']);edge(prepare.end,route);
 const knowledge=stage('Q04','知識庫檢索','knowledge',',queryRef:$json.queryRef');edge(route,knowledge.start);edge(route,knowledge.start,1);
 const needweb=condition('Q05','需要網頁','$json.route === "both"');edge(knowledge.end,needweb);
 const search=stage('Q06','官方搜尋','search',',queryRef:$json.queryRef');edge(route,search.start,2);edge(needweb,search.start);
 const read=stage('Q07','讀官方原文','read',',searchRef:$json.searchRef');edge(search.end,read.start);
 const collect=stage('Q08','彙整證據','collect');edge(read.end,collect.start);edge(needweb,collect.start,1);
 const iter=condition('Q09','已使用補查','$json.iteration === 1');edge(collect.end,iter);
 const assess=stage('Q10','評估證據','assess',',evidenceRef:$json.evidenceRef');edge(iter,assess.start,1);
 const decision=sw('Q11','證據決策','decision',['answer','retrieve','clarify','insufficient']);edge(assess.end,decision);
 const rewrite=stage('Q12','核定補查條件','rewrite-query',',assessmentRef:$json.assessmentRef');edge(decision,rewrite.start,1);
 const allowed=condition('Q12A','補查預算允許','$json.allowed === true');edge(rewrite.end,allowed);edge(allowed,route);
 const generate=stage('Q13','生成答案','generate',',evidenceRef:$json.evidenceRef');edge(iter,generate.start);edge(decision,generate.start);
 const validate=stage('Q14','引用與格式驗證','validate',',draftRef:$json.draftRef');edge(generate.end,validate.start);
 const validation=sw('Q15','驗證分流','validation',['valid','repairable']);edge(validate.end,validation);
 const repair=stage('Q16','一次格式修復','repair',',draftRef:$json.draftRef');edge(validation,repair.start,1);
 const revalidate=stage('Q17','再驗證','validate',',draftRef:$json.draftRef');edge(repair.end,revalidate.start);
 const valid=condition('Q17A','再驗證有效','$json.validation === "valid"');edge(revalidate.end,valid);
 const fallback=stage('Q18','追問或不足提示','fallback',',reasonCode:"insufficient"');
 for(const [a,out] of [[route,3],[decision,2],[decision,3],[decision,4],[allowed,1],[validation,2],[valid,1]])edge(a,fallback.start,out);
 const render=stage('Q19','產生呈現引用','render',',draftRef:$json.draftRef');edge(validation,render.start);edge(valid,render.start);edge(fallback.end,render.start);
 const result=set('Q20','子流程結果','({...$json,resultRefs:[...($json.resultRefs || []),$json.resultRef]})');edge(render.end,result);
 note('QNOTE','## 公開問答：只傳 refs\nknowledge／web／both；Gateway 限制一次補查、一次修復。Phase 1 為合成證據，沒有 Gemini、Brave 或學校外連。',0,-230);
});
workflow(3,({edge,set,trig,condition,sw,http,note})=>{
 const stage=(id,label,path,fields='')=>http(id,label,`personal/${path}`,`{operationId:$json.operationId${fields}}`);
 const entry=trig('P01','個人操作輸入'), session=stage('P02','檢查本人 Session','check-session');edge(entry,session.start);
 const active=condition('P03','登入有效','$json.session === "active"');edge(session.end,active);
 const kind=sw('P04','資料種類','action',['schedule','absence','announcements']);edge(active,kind);
 const login=stage('P09','重新登入提示','login-prompt');edge(active,login.start,1);
 const fetched=condition('P08A','查詢後 Session 有效','$json.session === "active"');edge(fetched,login.start,1);
 ['schedule','absence','announcements'].forEach((s,i)=>{const h=stage(`P0${i+5}`,['我的課表','我的缺曠','學生公告'][i],s);edge(kind,h.start,i);edge(h.end,fetched);});
 const render=stage('P08','本地呈現','render',',dataRef:$json.dataRef');edge(fetched,render.start);
 const unsupported=stage('P09U','不支援操作提示','unsupported-prompt');edge(kind,unsupported.start,3);
 const result=set('P10','子流程結果','({...$json,resultRefs:[...($json.resultRefs || []),$json.resultRef]})');for(const h of [render,login,unsupported])edge(h.end,result);
 note('PNOTE','## 個人資料邊界\n帳密、Cookie、OCR 圖片及私人原文永不進 n8n。登入／OCR 在 school-adapter，這裡僅模擬 Session 結果。查詢後再次處理逾期。',0,-230);
});
workflow(4,({edge,set,trig,http,note})=>{
 const entry=trig('E01','執行錯誤','errorTrigger'), redacted=set('E02','只留監控識別','({workflowId:String($json.workflow?.id || "unknown"),executionId:String($json.execution?.id || "unknown"),errorCode:"WORKFLOW_FAILED"})');edge(entry,redacted);
 const log=http('E03','記錄監控事件','observability/workflow-errors','{workflowId:$json.workflowId,executionId:$json.executionId,errorCode:$json.errorCode}','observability','POST',false);edge(redacted,log.start);
 note('ENOTE','## 異常處理\n不送 stack／完整 error；此 workflow 不掛自己為 errorWorkflow。合成任務逾期由 maintenance watchdog 收斂。',0,-230);
});
workflow(5,({node,edge,trig,condition,http,note,set})=>{
 const entry=node('T01','每五分鐘維護','scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:5}]}}),manual=trig('T01M','手動維護','manualTrigger');
 const clean=http('T02','清理過期資料','maintenance/cleanup','{}','maintenance','POST',false);edge(entry,clean.start);edge(manual,clean.start);
 const health=http('T03','彙整健康狀態','maintenance/health','{}','maintenance','GET',false);edge(clean.end,health.start);
 const unhealthy=condition('T04','健康異常','$json.healthy !== true');edge(health.end,unhealthy);
 const event=http('T05','記錄維運事件','observability/workflow-errors','{workflowId:$workflow.id,executionId:$execution.id,errorCode:"WORKFLOW_FAILED"}','observability','POST',false);edge(unhealthy,event.start);
 edge(unhealthy,set('T06','維護完成','({healthy:true,synthetic:true})'),1);
 note('TNOTE','## 維護\n只用 maintenance／observability credentials；不查學生資料、不推播。',0,-230);
});
workflow(6,({node,edge,set,trig,http,note})=>{
 const entry=trig('D01','手動展示','manualTrigger'), selector=set('D02','選擇合成情境','({scenario:"public_success"})');edge(entry,selector);
 const test=trig('D01T','測試子流程入口');
 const create=http('D03','建立合成任務','demo/tasks','{scenario:$json.scenario}','demo','POST',false);edge(selector,create.start);edge(test,create.start);
 const run=node('D04','執行主流程 WF-01','executeWorkflow',{source:'database',workflowId:{__rl:true,value:ids[1],mode:'id'},mode:'each',options:{waitForSubWorkflow:true}});edge(create.end,run);
 const delivery=http('D05','讀取 mock delivery','demo/tasks/PLACEHOLDER/delivery','{}','demo','GET',false);edge(run,delivery.start);
 // Only the opaque task ID is interpolated; no arbitrary URL input.
 // Set URL after node creation below via returned name.
 const report=set('D06','展示合成結果','({taskId:$json.taskId,synthetic:$json.synthetic,state:$json.state,outcome:$json.outcome,outboxCount:$json.outboxCount,delivered:$json.delivered,stages:$json.stages})');edge(delivery.end,report);
 note('DNOTE','## Demo（僅 staging）\n修改 D02 scenario，按 Execute workflow。所有 delivery 均 synthetic，delivered=false；duplicate_event 不再建立 outbox。情境清單見 tests/fixtures/scenarios.json。',0,-230);
});
workflow(7,({node,edge,set,trig,condition,sw,http,note})=>{
 const daily=node('K01','每日同步','scheduleTrigger',{rule:{interval:[{field:'days',triggerAtHour:3}]}}),manual=trig('K02','手動同步','manualTrigger');
 const stage=(id,label,path,body='{syncRef:$json.syncRef,sourceRef:$json.sourceRef,versionRef:$json.versionRef}')=>http(id,label,`knowledge/sync/${path}`,body,'knowledge','POST',false);
 const start=stage('K03','領取同步','start','{scenario:"all"}');edge(daily,start.start);edge(manual,start.start);
 const acquired=condition('K03A','同步執行權','$json.acquired === true');edge(start.end,acquired);edge(acquired,set('K03D','同步已由其他執行領取','({acquired:false,status:"duplicate_stopped"})'),1);
 const next=stage('K04','下一登錄來源','next','{syncRef:$json.syncRef}');edge(acquired,next.start);
 const done=condition('K04A','來源處理完成','$json.done === true');edge(next.end,done);
 const fetch=stage('K05','抓取與 hash','fetch','{syncRef:$json.syncRef,sourceRef:$json.sourceRef}');edge(done,fetch.start,1);
 const changed=condition('K05A','來源有變更','$json.status === "changed"');edge(fetch.end,changed);
 const parse=stage('K06','解析與切段','parse','{syncRef:$json.syncRef,sourceRef:$json.sourceRef}');edge(changed,parse.start);
 const parsed=condition('K06A','解析成功','$json.ok === true');edge(parse.end,parsed);
 const embed=stage('K07','合成 embedding 批次','embed');edge(parsed,embed.start);
 const versionDone=condition('K07A','版本批次完成','$json.versionDone === true');edge(embed.end,versionDone);
 const allowed=condition('K07B','批次預算允許','$json.allowed === true');edge(versionDone,allowed,1);edge(allowed,embed.start);
 const publish=stage('K08','驗證與合成發布','publish');edge(versionDone,publish.start);
 const record=stage('K09','記錄來源狀態','record','{syncRef:$json.syncRef,sourceRef:$json.sourceRef}');edge(changed,record.start,1);edge(parsed,record.start,1);edge(allowed,record.start,1);edge(publish.end,record.start);edge(record.end,next.start);
 const finish=stage('K10','完成同步','finish','{syncRef:$json.syncRef}');edge(done,finish.start);
 note('KNOTE','## 知識同步（合成）\nall：updated／unchanged／withdrawn／failed。發布僅為 memory fixture，不寫真知識库、不呼叫 embedding。pgvector 可用性另以 SQL 驗證。',0,-230);
});
// Fixed task URL for D05; retain capture/restore pairing around HTTP.
import {readFileSync} from 'node:fs';
const demo=JSON.parse(readFileSync('workflows/WF-06.json','utf8'));demo.nodes.find(n=>n.id==='D05').parameters.url="={{ 'http://mock-gateway:3000/internal/v1/demo/tasks/' + $json.taskId + '/delivery' }}";writeFileSync('workflows/WF-06.json',JSON.stringify(demo,null,2)+'\n');
writeFileSync('workflows/manifest.json',JSON.stringify({n8nVersion:'2.41.7',validationReport:'../docs/verification/runtime-manifest.json',syntheticOnly:true,importOrder:[2,3,4,5,7,1,6],credentials:creds,workflows:manifests.sort((a,b)=>a.number-b.number)},null,2)+'\n');
