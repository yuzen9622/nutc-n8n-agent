import type {BootstrapOwnerOptions,OwnerBootstrapResult} from './n8n-owner-bootstrap.mjs';
export interface SupervisedChild {
  pid?:number;
  on(event:'error',listener:(error:unknown)=>void):void;
  on(event:'close',listener:(code:number|null,signal:string|null)=>void):void;
  kill(signal?:string):void;
}
export interface SuperviseN8nOptions {
  env?:Record<string,string|undefined>;
  spawnFn?:(command:string,args:string[],options:{env:Record<string,string|undefined>;detached:boolean;stdio:string[]})=>SupervisedChild;
  bootstrap?:(options:BootstrapOwnerOptions)=>Promise<OwnerBootstrapResult>;
  markerPath?:string;
  writeMarker?:(path:string)=>void;
  removeMarker?:(path:string)=>void;
  killGroup?:(child:SupervisedChild,signal:string)=>void;
  processRef?:{on(name:string,handler:()=>void):void;off(name:string,handler:()=>void):void};
  groupAlive?:(child:SupervisedChild)=>boolean;
  killGraceMs?:number;
  pollMs?:number;
  reapMs?:number;
  log?:(message:string)=>void;
}
export function superviseN8n(options?:SuperviseN8nOptions):Promise<number>;
