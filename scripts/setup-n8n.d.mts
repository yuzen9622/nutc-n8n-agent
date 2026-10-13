export interface SetupCommand {args:string[];input:string;}
export interface SetupWorkflow {
  id:string;
  active:boolean;
  nodes:{type:string;credentials?:Record<string,{id:string;name:string}>}[];
  connections:object;
}
export interface SetupOptions {
  client:{query(sql:string,values?:string[][]):Promise<{rows:Record<string,unknown>[]}>};
  input:string;
  loadWorkflows():SetupWorkflow[]|Promise<SetupWorkflow[]>;
  runCli(command:SetupCommand):unknown|Promise<unknown>;
  log?:(message:string)=>void;
}
export const MAX_INPUT_BYTES:number;
export function setupPlan(input:string,workflows:SetupWorkflow[]):SetupCommand[];
export function setupN8n(options:SetupOptions):Promise<'initialized'>;
