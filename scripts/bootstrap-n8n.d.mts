export interface BootstrapCommand {args:string[];input?:string;}
export interface BootstrapWorkflow {
  id:string;
  active:boolean;
  nodes:{credentials?:Record<string,{id:string;name:string}>}[];
  connections:object;
}
export interface BootstrapOptions {
  client:{query(sql:string):Promise<{rows:Record<string,unknown>[]}>};
  env:Record<string,string|undefined>;
  loadWorkflows():BootstrapWorkflow[];
  runCli(command:BootstrapCommand):void|Promise<void>;
  log?:(message:string)=>void;
}
export function bootstrapPlan(env:BootstrapOptions['env'],workflows:BootstrapWorkflow[]):BootstrapCommand[];
export function bootstrapN8n(options:BootstrapOptions):Promise<'initialized'|'already-initialized'|'existing-database'>;
