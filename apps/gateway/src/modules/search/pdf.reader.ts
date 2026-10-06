import {fork} from 'node:child_process';
import {z} from 'zod';
import {Fault} from '../../utils/fault.js';

export type PdfPage={page:number;text:string};
const resultSchema=z.object({pages:z.array(z.object({page:z.number().int().min(1).max(30),text:z.string().min(10).max(120000)}).strict()).min(1).max(30)}).strict();
let active=0;
export class PdfReader {
  constructor(private readonly workerUrl=new URL(import.meta.url.endsWith('.ts')?'./pdf.worker.ts':'./pdf.worker.js',import.meta.url),private readonly timeoutMs=10000){}
  read(bytes:Buffer):Promise<PdfPage[]>{
    if(bytes.length>1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')return Promise.reject(new Fault(422,'SOURCE_PDF_UNREADABLE'));
    if(active>=2)return Promise.reject(new Fault(503,'SOURCE_PDF_BUSY'));
    active++;
    return new Promise((resolve,reject)=>{
      const worker=fork(this.workerUrl,{execArgv:['--max-old-space-size=128','--disallow-code-generation-from-strings'],env:{},stdio:['ignore','ignore','ignore','ipc']});
      let done=false;
      const finish=(error?:Fault,pages?:PdfPage[])=>{
        if(done)return;done=true;active--;clearTimeout(timer);worker.kill('SIGKILL');
        if(error)reject(error);else resolve(pages!);
      };
      const timer=setTimeout(()=>finish(new Fault(422,'SOURCE_PDF_TIMEOUT')),this.timeoutMs);
      worker.once('error',()=>finish(new Fault(422,'SOURCE_PDF_UNREADABLE')));
      worker.once('exit',()=>finish(new Fault(422,'SOURCE_PDF_UNREADABLE')));
      worker.once('message',(message:unknown)=>{
        const parsed=resultSchema.safeParse(message);
        if(!parsed.success||parsed.data.pages.some((p,i)=>p.page!==i+1)||
          parsed.data.pages.reduce((sum,p)=>sum+Buffer.byteLength(p.text),0)>120000)return finish(new Fault(422,'SOURCE_PDF_UNREADABLE'));
        finish(undefined,parsed.data.pages);
      });
      worker.send(bytes.toString('base64'),error=>{if(error)finish(new Fault(422,'SOURCE_PDF_UNREADABLE'));});
    });
  }
}
