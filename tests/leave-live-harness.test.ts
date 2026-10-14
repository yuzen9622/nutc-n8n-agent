import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs,assertConfirmReady,atomicManifest,sign} from '../scripts/check-leave-live.mjs';
import {TaskWorker} from '../apps/gateway/src/modules/tasks/task.worker.js';
test('capture worker never starts LINE loading, while normal LINE still does',async()=>{
 let loading=0,dispatch=0;let mode:'capture'|'line'='capture';const task={id:'task',userId:'owner',generation:'0',prompt:'private',lease:'lease',capability:'cap'};
 const worker=new TaskWorker({claim:async()=>({...task,deliveryMode:mode}),fail:async()=>{},deliverOne:async()=>false,cleanup:async()=>{}},async()=>{dispatch++;},async()=>{},()=>{},1000,async()=>{loading++;});
 await worker.tick();assert.equal(loading,0);assert.equal(dispatch,1);mode='line';await worker.tick();assert.equal(loading,1);
});
test('harness rejects unknown project, missing run and multiple modes',()=>{
 assert.equal(parseArgs(['--project','nutc-agent']).mode,'--preview');
 for(const args of [['--project','foreign'],['--project','nutc-agent','--confirm-authorized'],['--project','nutc-agent','--preview','--replay'],['--project','nutc-agent','--url','https://foreign']])assert.throws(()=>parseArgs(args));
});
test('capture requires atomic insert, double delivery filter and no public route',()=>{
 const source=readFileSync('apps/gateway/src/modules/tasks/task.repository.ts','utf8');assert.match(source,/INSERT INTO campus_tasks[^\n]+delivery_mode[^\n]+'capture'/);assert.equal((source.match(/t\.delivery_mode='line'/g)??[]).length,2);assert.match(source,/event_id=\$4/);assert.match(source,/CAPTURE_REPLY_CHANGED/);
 const script=readFileSync('scripts/check-leave-live.mjs','utf8');assert(!script.includes('/webhook/line'));assert(!script.includes('LineProvider'));
});
test('harness reservation survives an unknown enqueue result; signed manifest writes are atomic and private',()=>{
 const manifest={previewAcknowledged:true,pendingId:'pending',beforeHash:'baseline'},before={payloadMatches:true,pendingId:'pending',presented:true,attempts:0,hash:'baseline'};assertConfirmReady(manifest,before);
 for(const patch of [{confirmReserved:true},{confirmTask:'task'},{previewAcknowledged:false}])assert.throws(()=>assertConfirmReady({...manifest,...patch},before));
 for(const patch of [{attempts:1},{hash:'changed'},{pendingId:'other'},{presented:false}])assert.throws(()=>assertConfirmReady(manifest,{...before,...patch}));
 const base='.local/verification/leave-preview-confirmation';mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'manifest-test-')),path=join(dir,'run.json');
 try{atomicManifest(path,manifest);const read=JSON.parse(readFileSync(path,'utf8'));assert.equal(read.signature,sign(read.value));assert.equal(statSync(path).mode&0o777,0o600);assert.notEqual(read.signature,sign({...read.value,confirmReserved:true}));atomicManifest(path,{...manifest,confirmReserved:true});assert.equal(JSON.parse(readFileSync(path,'utf8')).value.confirmReserved,true);}finally{rmSync(dir,{recursive:true,force:true});}
});
