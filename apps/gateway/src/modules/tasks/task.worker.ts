import { setTimeout as delay } from 'node:timers/promises';
import type { LeasedTask } from './task.repository.js';
export interface WorkerQueue {
  claim():Promise<LeasedTask|null>;
  fail(task:LeasedTask):Promise<void>;
  deliverOne(send:(userId:string,reply:string,key:string)=>Promise<void>):Promise<boolean>;
  cleanup():Promise<void>;
}
export class TaskWorker {
  private readonly controller=new AbortController();
  private execution:Promise<void>|undefined;
  constructor(private readonly queue:WorkerQueue,
    private readonly dispatch:(task:LeasedTask,signal:AbortSignal)=>Promise<void>,
    private readonly send:(userId:string,reply:string,key:string)=>Promise<void>,
    private readonly onError:()=>void=()=>{},private readonly interval=1000,
    private readonly startLoading?:(userId:string)=>Promise<void>) {}
  async tick():Promise<boolean> {
    const task=await this.queue.claim();
    if(!task) return false;
    // Only claimed/authorized tasks get an animation, never raw webhook events.
    // Await its bounded request so it cannot arrive after the actual reply.
    try { await this.startLoading?.(task.userId); } catch { this.onError(); }
    try { await this.dispatch(task,this.controller.signal); }
    catch { await this.queue.fail(task); }
    return true;
  }
  start():void {
    if(this.execution) return;
    const loop=async(action:()=>Promise<unknown>,interval:number) => {
      while(!this.controller.signal.aborted) {
        try { await action(); } catch { this.onError(); }
        try { await delay(interval,undefined,{signal:this.controller.signal}); } catch { break; }
      }
    };
    this.execution=Promise.all([
      ...Array.from({length:5},()=>loop(()=>this.tick(),this.interval)),
      loop(()=>this.queue.deliverOne(this.send),this.interval),
      loop(()=>this.queue.cleanup(),60_000),
    ]).then(()=>{});
  }
  async stop():Promise<void> {this.controller.abort();await this.execution;}
}
