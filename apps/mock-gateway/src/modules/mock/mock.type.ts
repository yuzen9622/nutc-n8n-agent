import type { Scenario } from './mock.schema.js';
export type Operation = { operationId:string; kind:'public'|'personal'; action:string; iteration:number; route:string; refs:Map<string,string>; stages:Map<string,Record<string,unknown>>; repaired:boolean; fallback:boolean; failed:boolean };
export type Task = { taskId:string; requestId:string; taskCapability:string; deadlineAt:string; leaseToken?:string; state:'pending'|'running'|'completed'|'failed'; scenario:Scenario; operations:Operation[]; refs:Map<string,{operationId:string;kind:string}>; results:string[]; outboxCount:number; outcome?:string; createdAt:number };
export type TaskAuth = {capability:string;lease:string};
export type Sync = {syncRef:string; createdAt:number; index:number; sources:Array<{sourceRef:string;status:string;versionRef?:string;published:boolean;recorded:boolean;stage:string}>;finished:boolean};
