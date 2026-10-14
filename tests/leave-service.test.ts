import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LeaveCrypto} from '../apps/school-adapter/src/modules/school/leave.crypto.js';
import {LeaveService} from '../apps/school-adapter/src/modules/school/leave.service.js';
test('leave AEAD binds owner/generation/session/task/id and field with full tag',()=>{
 const crypto=new LeaveCrypto('a'.repeat(64)),b={user_id:'owner',generation:'1',school_session_id:'session',origin_task_id:'task',id:'preview'},sealed=crypto.seal('PRIVATE_SENTINEL',b,'payload');assert(!sealed.includes('PRIVATE_SENTINEL'));assert.equal(crypto.open(sealed,b,'payload'),'PRIVATE_SENTINEL');
 for(const field of Object.keys(b))assert.throws(()=>crypto.open(sealed,{...b,[field]:'wrong'},'payload'));
 assert.throws(()=>crypto.open(sealed,b,'outcome'));const parts=sealed.split('.');parts[2]='YQ';assert.throws(()=>crypto.open(parts.join('.'),b,'payload'));
});
test('invalid preview intent is rejected before school transport and safe logs omit reason',async()=>{
 let network=0;const repo={beginPreview:async()=>({sessionId:'session'})};const service=new LeaveService(repo as never,{} as never,()=>{network++;throw Error('PRIVATE_SENTINEL');});const events:string[]=[];const original=console.info;console.info=(text:string)=>events.push(text);
 try{const result=await service.preview({taskId:'task',lease:'lease',capability:'cap'}, {date:'2026/99/99',leave_type:'心理假',reason:'PRIVATE_SENTINEL',selection:{mode:'morning_count',count:3}});assert.equal(result.receipt.state,'validation');assert.equal(network,0);assert(events.every(e=>!e.includes('PRIVATE_SENTINEL')));}finally{console.info=original;}
});
