import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskWorker } from '../apps/gateway/src/modules/tasks/task.worker.js';
import { DispatchProvider } from '../apps/gateway/src/modules/tasks/dispatch.provider.js';
import { taskAuthSchema,toolSchema } from '../apps/gateway/src/modules/tasks/task.schema.js';
const task={id:'6052b198-79d2-4bba-a3fd-b50a00d59394',userId:`U${'a'.repeat(32)}`,generation:'0',prompt:'private user input',lease:'2eb6c98b-ceb9-4b74-a137-484f51cdff40',capability:'a'.repeat(43)};
test('dispatcher sends only task credentials and never retries ambiguous provider errors',async()=>{
  let calls=0;
  const provider=new DispatchProvider('http://n8n:5678/webhook/campus-agent-live','secret',async(_url,options)=>{
    calls++;assert.equal(options?.redirect,'error');
    assert.deepEqual(JSON.parse(String(options?.body)),{taskId:task.id,lease:task.lease,capability:task.capability});
    throw new Error('ambiguous network failure');
  });
  let failed=0;
  const worker=new TaskWorker({claim:async()=>task,fail:async received=>{assert.equal(received.id,task.id);failed++;},deliverOne:async()=>false,cleanup:async()=>{}},
    (job,signal)=>provider.dispatch(job,signal),async()=>{});
  assert.equal(await worker.tick(),true);assert.equal(calls,1);assert.equal(failed,1);
});
test('worker treats an empty queue as idle; successful completion does not create fallback reply',async()=>{
  let claim:typeof task|null=task,failed=0;
  const worker=new TaskWorker({claim:async()=>claim,fail:async()=>{failed++;},deliverOne:async()=>false,cleanup:async()=>{}},async()=>{},async()=>{});
  await worker.tick();assert.equal(failed,0);claim=null;assert.equal(await worker.tick(),false);
});
test('live task contract rejects client-selected users, extra fields and malformed capabilities',()=>{
  const auth={taskId:task.id,lease:task.lease,capability:task.capability};
  assert(taskAuthSchema.safeParse(auth).success);
  assert(!taskAuthSchema.safeParse({...auth,userId:task.userId}).success);
  assert(!taskAuthSchema.safeParse({...auth,capability:'short'}).success);
  assert(!toolSchema.safeParse({...auth,kind:'personal',query:'schedule',url:'https://example.org'}).success);
});
