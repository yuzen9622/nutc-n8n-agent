export const PINNED_VERSION:string;
export const EVIDENCE_DIR:string;
export const TEST_PROMPT:string;
export interface GoogleRef {id:string;name:string;}
export interface WorkflowNode {id?:string;name:string;type:string;parameters?:Record<string,unknown>;credentials?:Record<string,GoogleRef>;[key:string]:unknown;}
export interface WorkflowGraph {nodes:WorkflowNode[];connections:Record<string,unknown>;}
export function parseLocalBase(value?:string):string;
export function googleRef(node:unknown):GoogleRef|undefined;
export function liveGoogleRef(main:unknown):GoogleRef;
export function isolatedGraph(source:unknown):WorkflowGraph;
export function sha256(value:unknown):string;
export function inventory(list:Record<string,unknown>[]):Record<string,unknown>[];
export function failedChecks(report:unknown):string[];
export function extractReport(stdout:string):Record<string,unknown>;
export function verify(options?:Record<string,unknown>):Promise<Record<string,unknown>>;
