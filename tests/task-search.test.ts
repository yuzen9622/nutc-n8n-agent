import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskService} from '../apps/gateway/src/modules/tasks/task.service.js';
import {Fault} from '../apps/gateway/src/utils/fault.js';
const auth={taskId:'task',lease:'lease',capability:'capability'};
test('configured public search records evidence without a budget dependency',async()=>{
 const steps:string[]=[];const sources=[{sourceId:'source'}];
 const repository={authorizeTool:async(value:unknown)=>{assert.deepEqual(value,auth);steps.push('authorize');return {id:'task',userId:'owner'};},recordEvidence:async(value:unknown,results:unknown)=>{assert.deepEqual(value,auth);assert.equal(results,sources);steps.push('evidence');}};
 const search={search:async(query:string)=>{assert.equal(query,'public question');steps.push('search');return sources;}};
 const service=new TaskService(repository as never,{} as never,search as never);
 const result=await service.tool(auth,'web','public question');
 assert('sources' in result);assert.deepEqual(result.sources,sources);
 assert.deepEqual(steps,['authorize','search','evidence']);
});
test('tool authorization and unconfigured search still fail closed before provider calls',async()=>{
 let requests=0;
 const search={search:async()=>{requests++;return [];}};
 const denied={authorizeTool:async()=>{throw new Fault(403,'TASK_DENIED');}};
 await assert.rejects(new TaskService(denied as never,{} as never,search as never).tool(auth,'web','question'),/TASK_DENIED/);
 assert.equal(requests,0);
 const repository={authorizeTool:async()=>({id:'task',userId:'owner'})};
 await assert.rejects(new TaskService(repository as never,{} as never).tool(auth,'web','question'),/SEARCH_NOT_CONFIGURED/);
});
