import { successResponse } from '../../utils/http.js';
import type { MockService } from './mock.service.js';
import type { TaskAuth } from './mock.type.js';
import type { Scenario } from './mock.schema.js';
export type Input = {action:string;taskId:string;stage:string;body:Record<string,unknown>;auth:TaskAuth};
export function createController(service:MockService) {
  return (input:Input) => {
    const {action,taskId,stage,body,auth}=input;
    const calls:Record<string,()=>unknown>={
      demo:()=>service.create(body.scenario as Scenario),delivery:()=>service.delivery(taskId),claim:()=>service.claim(taskId,auth),plan:()=>service.plan(taskId,auth),
      public:()=>service.stage(taskId,auth,'public',stage,body),personal:()=>service.stage(taskId,auth,'personal',stage,body),
      complete:()=>service.complete(taskId,auth,body.resultRefs as string[]),fail:()=>service.fail(taskId,auth,body.errorCode as string),
      cleanup:()=>service.cleanup(),health:()=>service.health(),error:()=>service.error(body as {workflowId:string;executionId:string;errorCode:string}),
      syncStart:()=>service.syncStart(body.scenario as string),sync:()=>service.sync(stage,body),
    };
    return successResponse(calls[action]!());
  };
}
