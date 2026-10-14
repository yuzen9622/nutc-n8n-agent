import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchOwned,nonownedHash,guardInstance,PINNED_N8N_IMAGE,applyUpdate,digest} from '../scripts/update-local-leave-workflow.mjs';
const source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
test('workflow exact tools, no model IDs, confirm has no business fromAI',()=>{
 assert.equal(source.nodes.filter((n:{type:string})=>n.type.endsWith('.httpRequestTool')).length,9);
 for(const name of ['student_leave_preview','student_leave_confirm','student_leave_notes'])assert(source.nodes.some((n:{name:string})=>n.name===name));
 const confirm=source.nodes.find((n:{name:string})=>n.name==='student_leave_confirm');assert(!confirm.parameters.jsonBody.includes('$fromAI'));assert.equal(confirm.parameters.options.timeout,45000);
 assert.equal(source.active,false);assert.equal(source.settings.saveDataSuccessExecution,'none');
});
test('owned updater preserves every nonowned field and credentials',()=>{
 const current=structuredClone(source);current.versionId='v1';current.active=true;current.nodes.find((n:{name:string})=>n.name==='official_search').credentials={googlePalmApi:{id:'real-google',name:'Existing Google'}};
 const hash=nonownedHash(current),patched=patchOwned(current,source);assert.equal(nonownedHash(patched),hash);assert.deepEqual(patched.nodes.find((n:{name:string})=>n.name==='official_search'),current.nodes.find((n:{name:string})=>n.name==='official_search'));
 assert.throws(()=>patchOwned({nodes:[],connections:{}},source));
 const edited=structuredClone(current);edited.nodes.find((n:{name:string})=>n.name==='student_leave_preview').parameters.toolDescription+=' unexpected user edit';assert.throws(()=>patchOwned(edited,source),/UNKNOWN_LEAVE_EDITS/);
});
test('guarded updater rejects foreign project, image and port',()=>{
 const info={Config:{Labels:{'com.docker.compose.project':'nutc-agent','com.docker.compose.service':'n8n','com.docker.compose.project.working_dir':process.cwd()},Image:PINNED_N8N_IMAGE},NetworkSettings:{Ports:{'5678/tcp':[{HostIp:'127.0.0.1',HostPort:'15680'}]}}};guardInstance(info,'.');
 for(const patch of [{...info,Config:{...info.Config,Image:'n8n:latest'}},{...info,NetworkSettings:{Ports:{}}},{...info,Config:{...info.Config,Labels:{...info.Config.Labels,'com.docker.compose.project':'foreign'}}}])assert.throws(()=>guardInstance(patch,'.'));
});
test('version/checksum guarded updater stops on drift, editor lock and partial patch; never reactivates failed patch',async()=>{
 for(const scenario of ['normal','locked','drift','patch-failure']){
  const current={...structuredClone(source),versionId:'v1',active:true,activeVersionId:'v1',checksum:'c1'},snapshot={versionId:'v1',workflowHash:digest(current),nonownedHash:nonownedHash(current)};
  let db=structuredClone(current);const calls:string[]=[];
  const api=async(path:string,method='GET',body?:any)=>{
   calls.push(method+' '+path);
   if(path.endsWith('/write-lock'))return scenario==='locked'?{clientId:'someone-else'}:null;
   if(path.endsWith('/deactivate')){assert.equal(body.expectedChecksum,'c1');db.active=false;db.checksum='deactivated';if(scenario==='drift')db.versionId='foreign';return db;}
   if(method==='PATCH'){assert.equal(body.expectedChecksum,'deactivated');assert.equal(body.versionId,'v1');if(scenario==='patch-failure')throw Error('fixed failure');db={...db,...body,versionId:'v2',checksum:'c2'};return structuredClone(db);}
   if(path.endsWith('/activate')){assert.equal(body.versionId,'v2');assert.equal(body.expectedChecksum,'c2');db.active=true;db.activeVersionId='v2';db.checksum='c3';return db;}
   return structuredClone(db);
  };
  if(scenario==='normal'){const result=await applyUpdate(api,current,source,snapshot);assert.equal(result.active,true);assert.equal(nonownedHash(result),snapshot.nonownedHash);}
  else {await assert.rejects(applyUpdate(api,current,source,snapshot));assert(!calls.some(c=>c.endsWith('/activate')));if(scenario==='locked')assert(!calls.some(c=>c.startsWith('POST')));if(scenario==='drift')assert(!calls.some(c=>c.startsWith('PATCH')));}
 }
});
const named=(w:any,name:string)=>w.nodes.find((n:{name:string})=>n.name===name);
const activeLegacy=()=>JSON.parse(readFileSync('tests/fixtures/active-legacy-leave-workflow.json','utf8'));
const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
test('digest ignores object key order only; array order and values still count',()=>{
 assert.equal(digest({a:1,b:{c:[1,2],d:3}}),digest({b:{d:3,c:[1,2]},a:1}));
 assert.notEqual(digest({a:[1,2]}),digest({a:[2,1]}));assert.notEqual(digest({a:1}),digest({a:2}));
});
test('active-like legacy student_leave (toolDescription first) patches; old-search nonowned workflow is untouched by a source with future nonowned nodes',()=>{
 const current=activeLegacy();assert.equal(Object.keys(named(current,'student_leave').parameters)[0],'toolDescription');
 const sourceWithNonowned=structuredClone(source),future=structuredClone(named(source,'official_search'));future.id='future-nonowned';future.name='future_nonowned';sourceWithNonowned.nodes.push(future);
 assert(!sourceWithNonowned.nodes.every((n:{name:string})=>current.nodes.some((c:{name:string})=>c.name===n.name)||['student_leave_preview','student_leave_confirm','student_leave_notes'].includes(n.name)),'source must contain nodes absent from active');
 named(current,'official_search').credentials={googlePalmApi:{id:'real-google',name:'Existing Google'}};named(current,'official_search').parameters.sentinel={keep:[3,2,1]};
 const before=structuredClone(current),patched=patchOwned(current,sourceWithNonowned);
 assert.deepEqual(current,before);
 assert.deepEqual(patched.nodes.map((n:{name:string})=>n.name).filter((n:string)=>!n.startsWith('student_leave_')&&n!=='student_leave'),before.nodes.map((n:{name:string})=>n.name).filter((n:string)=>n!=='student_leave'));
 for(const n of before.nodes.filter((n:{name:string})=>n.name!=='student_leave'&&n.name!=='AI Agent'))assert.deepEqual(named(patched,n.name),n);
 assert(!patched.nodes.some((n:{name:string})=>n.name==='驗證搜尋來源'));
 assert.deepEqual(patched.settings,before.settings);assert.equal(nonownedHash(patched),nonownedHash(current));
 for(const [from,ports] of Object.entries(before.connections))if(from!=='student_leave')assert.deepEqual(patched.connections[from],ports);
 assert.deepEqual(Object.keys(patched.connections).filter(k=>k.startsWith('student_leave')).sort(),['student_leave_confirm','student_leave_notes','student_leave_preview']);
 for(const n of ['student_leave_preview','student_leave_confirm','student_leave_notes'])assert.deepEqual(named(patched,n).credentials,named(before,'student_leave').credentials);
 assert.equal(named(patched,'official_search').credentials.googlePalmApi.id,'real-google');
 // Idempotent re-run, and key reordering of the patched workflow is semantically identical.
 assert.equal(digest(patchOwned(patched,sourceWithNonowned).nodes),digest(patched.nodes));assert.equal(digest(reorder(patched.nodes)),digest(patched.nodes));assert.equal(nonownedHash(reorder(patched)),nonownedHash(patched));
});
test('any semantic change to the legacy node or owned set is still rejected',()=>{
 const edits:Array<(n:any)=>void>=[n=>{n.parameters.toolDescription+='x';},n=>{n.parameters.url+='x';},n=>{n.parameters.jsonBody+='x';},n=>{n.parameters.method='GET';},n=>{n.parameters.options={timeout:1};},n=>{n.parameters.extra=1;},n=>{n.typeVersion+=1;},n=>{n.type+='x';},n=>{n.retryOnFail=!n.retryOnFail;},n=>{delete n.parameters.authentication;}];
 for(const edit of edits){const current=activeLegacy();edit(named(current,'student_leave'));assert.throws(()=>patchOwned(current,source),/UNKNOWN_LEAVE_EDITS/);}
 const mixed=activeLegacy();mixed.nodes.push({...structuredClone(named(source,'student_leave_preview'))});assert.throws(()=>patchOwned(mixed,source),/UNKNOWN_LEAVE_EDITS/);
 const badConn=activeLegacy();badConn.connections.student_leave.ai_tool[0][0].index=1;assert.throws(()=>patchOwned(badConn,source),/UNKNOWN_LEAVE_CONNECTION/);
 const foreign=activeLegacy();foreign.connections['Webhook']={main:[[{node:'student_leave',type:'main',index:0}]]};assert.throws(()=>patchOwned(foreign,source),/UNKNOWN_LEAVE_CONNECTION/);
 const noCred=activeLegacy();delete named(noCred,'student_leave').credentials;assert.throws(()=>patchOwned(noCred,source));
 const badSource=structuredClone(source);badSource.nodes=badSource.nodes.filter((n:{name:string})=>n.name!=='student_leave_notes');assert.throws(()=>patchOwned(activeLegacy(),badSource),/UNKNOWN_SOURCE_LEAVE/);
 const extra=structuredClone(source);extra.nodes.push({...structuredClone(named(source,'student_leave_notes')),name:'student_leave'});assert.throws(()=>patchOwned(activeLegacy(),extra),/UNKNOWN_SOURCE_LEAVE/);
 const badSrcConn=structuredClone(source);badSrcConn.connections.student_leave_confirm.ai_tool[0][0].node='Other';assert.throws(()=>patchOwned(activeLegacy(),badSrcConn),/UNKNOWN_SOURCE_LEAVE/);
 const missingConn=structuredClone(source);delete missingConn.connections.student_leave_confirm;assert.throws(()=>patchOwned(activeLegacy(),missingConn),/UNKNOWN_SOURCE_LEAVE|TypeError/);
});
test('PATCH/readback key reorder is not a mismatch; semantic mutation of readback is',async()=>{
 for(const scenario of ['reorder','mutate']){
  const current={...activeLegacy(),checksum:'c1'};const snapshot={versionId:'active-v1',workflowHash:digest(current),nonownedHash:nonownedHash(current)};
  let db=structuredClone(current);
  const api=async(path:string,method='GET',body?:any)=>{
   if(path.endsWith('/write-lock'))return null;
   if(path.endsWith('/deactivate')){db.active=false;db.checksum='d';return db;}
   if(method==='PATCH'){db={...db,...structuredClone(body),versionId:'v2',checksum:'c2'};if(scenario==='reorder')db=reorder(db);else named(db,'student_leave_preview').parameters.toolDescription+='tamper';return structuredClone(db);}
   if(path.endsWith('/activate')){db.active=true;db.activeVersionId='v2';db.checksum='c3';return db;}
   return structuredClone(db);
  };
  if(scenario==='reorder')assert.equal((await applyUpdate(api,current,source,snapshot)).active,true);
  else await assert.rejects(applyUpdate(api,current,source,snapshot),/PATCH_CONTENT_MISMATCH/);
 }
});
test('guardInstance accepts only loopback 127.0.0.1:15680',()=>{
 const base=(host:string,port='15680')=>({Config:{Labels:{'com.docker.compose.project':'nutc-agent','com.docker.compose.service':'n8n','com.docker.compose.project.working_dir':process.cwd()},Image:PINNED_N8N_IMAGE},NetworkSettings:{Ports:{'5678/tcp':[{HostIp:host,HostPort:port}]}}});
 guardInstance(base('127.0.0.1'),'.');
 for(const info of [base('0.0.0.0'),base('::'),base('::1'),base(''),base('127.0.0.1','15681'),base('127.0.0.1','5678')])assert.throws(()=>guardInstance(info,'.'),/PORT_DENIED/);
});
