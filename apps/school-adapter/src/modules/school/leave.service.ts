import {CookieJar} from 'tough-cookie';
import type {PoolClient} from 'pg';
import {leavePreviewIntentSchema,type LeaveAuth,type LeaveReply,type LeaveReceipt} from '../../../../shared/leave-contract.js';
import {SchoolClient} from './school.client.js';
import {SCHOOL} from '../../constants/school.js';
import {schoolHtml} from './login.parse.js';
import {LeaveSelectionError,parseLeaveForm,parseLeaveClasses,selectLeaveRows,buildLeaveSubmissionPayload,parseLeaveCreateResponse,parseLeaveRecordSummary,parseLeaveRecordDetail} from './leave.parse.js';
import type {LeaveRepository,LeavePending,LeavePayload,LeaveTask} from './leave.repository.js';
import type {SchoolSessionRepository} from './session.repository.js';
const safeLog=(event:string,code:string)=>console.info(JSON.stringify({event,code}));
export class LeaveService {
 constructor(private readonly repository:LeaveRepository,private readonly sessions:SchoolSessionRepository,private readonly clientFactory=(jar:CookieJar)=>new SchoolClient(jar)){}
 private async withClient<T>(auth:LeaveAuth,sessionId:string,handler:(client:SchoolClient,t:LeaveTask,c:PoolClient)=>Promise<T>){return this.sessions.withExpected(this.repository,auth,sessionId,async(stored,t,c)=>{
  const jar=await CookieJar.deserialize(stored.cookies);try{const data=await handler(this.clientFactory(jar),t,c);return {cookies:JSON.stringify(await jar.serialize()),data};}finally{await jar.removeAllCookies();}
 });}
 private async discovery(client:SchoolClient,intent:LeavePayload['intent'],signal:AbortSignal){
  const response=await client.fetch(SCHOOL.absenceNoteCreate,signal);const form=parseLeaveForm(schoolHtml(response.body,response.contentType));
  const code=form.types[intent.leave_type];if(!code)throw Error('LEAVE_TYPE_UNAVAILABLE');
  const classes=await client.postJson(intent.date,signal);const rows=selectLeaveRows(parseLeaveClasses(classes.body.toString('utf8')),intent.selection);
  return {payload:{intent,rows,code},hidden:form.hidden};
 }
 private receipt(payload:LeavePayload):LeaveReceipt{return {state:'pending',code:'LEAVE_PREVIEW_READY',date:payload.intent.date,leaveType:payload.intent.leave_type,reason:payload.intent.reason,courses:payload.rows.map(r=>({period:r.sec,name:r.name}))};}
 async preview(auth:LeaveAuth,input:unknown):Promise<LeaveReply>{
  const t=await this.repository.beginPreview(auth),signal=AbortSignal.timeout(40000);
  const parsed=leavePreviewIntentSchema.safeParse(input);
  if(!parsed.success){safeLog('leave_preview_validation_failed','LEAVE_INTENT_INVALID');return {sessionId:t.sessionId,receipt:{state:'validation',code:'LEAVE_INTENT_INVALID'}};}
  try {
   const found=await this.withClient(auth,t.sessionId,client=>this.discovery(client,parsed.data,signal));
   const p=await this.repository.save(auth,t,found.payload);
   safeLog('leave_preview_ready','LEAVE_PREVIEW_READY');return {sessionId:t.sessionId,previewId:p.id,receipt:this.receipt(found.payload)};
  }catch(error){const selection=error instanceof Error&&error.message==='LEAVE_NEED_SELECTION';safeLog('leave_preview_validation_failed',selection?'LEAVE_NEED_SELECTION':'LEAVE_PREVIEW_UNAVAILABLE');return {sessionId:t.sessionId,receipt:{state:selection?'need_selection':'validation',code:selection?'LEAVE_NEED_SELECTION':'LEAVE_PREVIEW_UNAVAILABLE',...(error instanceof LeaveSelectionError?{courses:error.courses}:{})}};}
 }
 private async records(client:SchoolClient,signal:AbortSignal){const r=await client.fetch(SCHOOL.absenceNotes,signal);return parseLeaveRecordSummary(schoolHtml(r.body,r.contentType));}
 async confirm(auth:LeaveAuth):Promise<LeaveReply>{
  const t=await this.repository.validate(auth),signal=AbortSignal.timeout(40000);
  let p:LeavePending|undefined,attempt:string|undefined;
  try {
   const preflight=await this.withClient(auth,t.sessionId,async(client,task,c)=>{
    const pending=await this.repository.confirmPending(c,auth,task);p=pending;const payload=this.repository.payload(pending);
    const fresh=await this.discovery(client,payload.intent,signal);
    if(JSON.stringify(fresh.payload)!==JSON.stringify(payload))throw Error('LEAVE_FORM_CHANGED');
    const records=await this.records(client,signal);return {pending,payload,before:records.map(r=>r.id),hidden:fresh.hidden};
   });p=preflight.pending;
   // Durable marker commits independently, before taking the network session transaction.
   attempt=await this.repository.attempt(auth,p,preflight.before);
   safeLog('leave_submission_started','LEAVE_ATTEMPT_COMMITTED');
   let evidence='',receipt:LeaveReceipt={state:'ambiguous',code:'LEAVE_RESPONSE_UNKNOWN'};
   try {
    await this.withClient(auth,t.sessionId,async(client,task,c)=>{
     const own=await c.query("SELECT 1 FROM campus_leave_previews WHERE id=$1 AND state='attempted' AND attempt_id=$2 AND confirm_origin_task_id=$3 AND confirm_lease=$4 FOR UPDATE",[p!.id,attempt,task.id,auth.lease]);if(!own.rowCount||new Date(task.leased_until).getTime()-Date.now()<30000)throw Error('LEAVE_ATTEMPT_DENIED');
     const payload=buildLeaveSubmissionPayload({date:preflight.payload.intent.date,an_type:preflight.payload.code,reason:preflight.payload.intent.reason,detail:preflight.payload.rows.map(r=>[r.ccid,r.sec]),hidden:preflight.hidden});
     // Sole create callsite. Never retry this call, regardless of transport/DB result.
     const response=await client.fetch(SCHOOL.absenceNoteCreate,signal,new URLSearchParams(payload),{referer:SCHOOL.absenceNotes,multipartFiles:['att']});
     const raw={bodyBase64:response.body.toString('base64'),contentType:response.contentType,url:response.url,status:response.status,redirectHistory:response.redirectHistory??[]};
     let semantic:ReturnType<typeof parseLeaveCreateResponse>={state:'unknown',code:'LEAVE_RESPONSE_UNKNOWN'};
     try{semantic=parseLeaveCreateResponse(schoolHtml(response.body,response.contentType));}catch{/* Unknown MIME/shape is retained encrypted, never retried. */}
     evidence=JSON.stringify({...raw,semantic});
     const after=await this.records(client,signal),newIds=after.filter(r=>!preflight.before.includes(r.id)).map(r=>r.id),matches:number[]=[];
     for(const id of newIds){const r=await client.fetch(SCHOOL.absenceNoteCreate.replace('anid=0',`anid=${id}`),signal);const detail=parseLeaveRecordDetail(schoolHtml(r.body,r.contentType));const expected=preflight.payload;
      if(detail.date===expected.intent.date&&detail.type===expected.intent.leave_type&&detail.reason===expected.intent.reason&&JSON.stringify([...detail.tuples].sort((a,b)=>a[1]-b[1]))===JSON.stringify(expected.rows.map(r=>[r.ccid,r.sec])))matches.push(id);
     }
     evidence=JSON.stringify({...raw,semantic,newIds,matches});
     receipt=semantic.state==='accepted'&&matches.length===1?{state:'succeeded',code:'LEAVE_SUBMISSION_VERIFIED'}:semantic.state==='rejected'&&matches.length===0?{state:'rejected',code:'LEAVE_UPSTREAM_REJECTED'}:{state:'ambiguous',code:'LEAVE_OUTCOME_AMBIGUOUS'};
    });
   }catch{receipt={state:'ambiguous',code:'LEAVE_OUTCOME_AMBIGUOUS'};}
   await this.repository.finish(p,attempt,receipt,evidence);
   safeLog(receipt.state==='succeeded'?'leave_submission_verified':receipt.state==='rejected'?'leave_upstream_rejected':'leave_outcome_ambiguous',receipt.code);
   return {sessionId:t.sessionId,previewId:p.id,receipt};
  }catch(error){
   if(p&&!attempt&&error instanceof Error&&error.message==='LEAVE_FORM_CHANGED')await this.repository.cancel(auth,p);
   const attempted=attempt!==undefined||(await this.repository.transaction(async c=>{await this.repository.guard(c,auth,t.sessionId);const pending=await this.repository.pending(c,t);return pending?.state==='attempted'||pending?.state==='ambiguous';}));
   const receipt:LeaveReceipt={state:attempted?'ambiguous':'consumed',code:attempted?'LEAVE_OUTCOME_AMBIGUOUS':'LEAVE_CONFIRM_DENIED'};
   safeLog(attempted?'leave_outcome_ambiguous':'leave_preview_validation_failed',receipt.code);return {sessionId:t.sessionId,receipt};
  }
 }
}
