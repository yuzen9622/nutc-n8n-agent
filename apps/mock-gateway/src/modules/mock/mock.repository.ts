import type { Task, Sync } from './mock.type.js';
// Phase 1 only: restart deliberately clears synthetic tasks; no durability claim.
export class MockRepository {
  tasks = new Map<string,Task>();
  syncs = new Map<string,Sync>();
  events:Array<{workflowId:string;executionId:string;errorCode:string}> = [];
}
