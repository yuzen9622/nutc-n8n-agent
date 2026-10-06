import {fork} from 'node:child_process';
import {SchoolError} from '../../utils/school-error.js';
import {SCHOOL} from '../../constants/school.js';
let active=0;
export class LocalOcr {
 constructor(private readonly workerUrl=new URL('./ocr.worker.js',import.meta.url)){}
 recognize(image:Buffer,signal:AbortSignal):Promise<string>{
  if(signal.aborted)return Promise.reject(new SchoolError('SCHOOL_TIMEOUT'));
  if(!image.length||image.length>SCHOOL.captchaLimit)return Promise.reject(new SchoolError('SCHOOL_CAPTCHA_INVALID'));
  if(active>=2)return Promise.reject(new SchoolError('OCR_BUSY'));
  active++;
  return new Promise((resolve,reject)=>{
   const worker=fork(this.workerUrl,{execArgv:['--max-old-space-size=256'],env:{PATH:process.env.PATH},stdio:['ignore','ignore','ignore','ipc']});
   let done=false;
   const finish=(error?:SchoolError,code?:string)=>{if(done)return;done=true;active--;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.kill('SIGKILL');if(error)reject(error);else resolve(code??'');};
   const abort=()=>finish(new SchoolError('SCHOOL_TIMEOUT'));
   const timer=setTimeout(()=>finish(new SchoolError('OCR_TIMEOUT')),SCHOOL.ocrDeadlineMs);
   signal.addEventListener('abort',abort,{once:true});
   worker.once('error',()=>finish(new SchoolError('OCR_FAILED')));
   worker.once('exit',()=>finish(new SchoolError('OCR_FAILED')));
   worker.once('message',(message:unknown)=>{
    if(!message||typeof message!=='object'||!('code' in message)||typeof message.code!=='string')return finish(new SchoolError('OCR_FAILED'));
    finish(undefined,message.code);
   });
   worker.send(image.toString('base64'),error=>{if(error)finish(new SchoolError('OCR_FAILED'));});
  });
 }
}
