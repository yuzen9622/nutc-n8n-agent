import {readFileSync,writeFileSync,mkdirSync,chmodSync,realpathSync,existsSync,openSync,closeSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requiredEnv} from './env.mjs';
export function parseArgs(args){if(args[0]!=='--project'||args[1]!=='nutc-agent')throw Error('KNOWN_PROJECT_REQUIRED');const modes=['--preview','--confirm-authorized','--replay','--reconcile'].filter(m=>args.includes(m));if(modes.length>1)throw Error('MODE_DENIED');const index=args.indexOf('--run'),run=index>=0?args[index+1]:undefined;if(run&&!/^[a-f0-9-]{36}$/.test(run))throw Error('RUN_DENIED');if(modes[0]&&modes[0]!=='--preview'&&!run)throw Error('RUN_REQUIRED');if(args.some(a=>!['--project','nutc-agent','--run',run,...modes].includes(a)))throw Error('ARGUMENT_DENIED');return {mode:modes[0]??'--preview',run};}
function json(text){try{return JSON.parse(text);}catch{throw Error('LOCAL_RESULT_INVALID');}}
export const sign=value=>createHmac('sha256',requiredEnv('APP_MASTER_KEY')).update('leave-live:v1:'+JSON.stringify(value)).digest('hex');
function execute(service,source){try{return json(execFileSync('docker',['compose','-p','nutc-agent','exec','-T',service,'node','--input-type=module'],{input:source,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:130000}).trim());}catch{throw Error('LIVE_STAGE_UNAVAILABLE');}}
function guard(){for(const service of ['gateway','school-adapter']){const id=execFileSync('docker',['compose','-p','nutc-agent','ps','-q',service],{encoding:'utf8'}).trim();const label=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project.working_dir"}}',id],{encoding:'utf8'}).trim();if(realpathSync(label)!==realpathSync('.'))throw Error('INSTANCE_DENIED');}}
function school(run,reply,baseline){ return execute('school-adapter',`
import {Pool} from 'pg';import {createHmac,createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';import {CookieJar} from 'tough-cookie';
import {loadSchoolConfig} from './dist/apps/school-adapter/src/config/env.js';import {SessionCrypto} from './dist/apps/school-adapter/src/modules/school/session.crypto.js';import {SchoolSessionRepository} from './dist/apps/school-adapter/src/modules/school/session.repository.js';import {SchoolClient} from './dist/apps/school-adapter/src/modules/school/school.client.js';import {LeaveCrypto} from './dist/apps/school-adapter/src/modules/school/leave.crypto.js';import {parseLeaveRecordSummary} from './dist/apps/school-adapter/src/modules/school/leave.parse.js';import {schoolHtml} from './dist/apps/school-adapter/src/modules/school/login.parse.js';
const c=loadSchoolConfig(),pool=new Pool({connectionString:c.SCHOOL_DATABASE_URL});try{
const owners=await pool.query("SELECT s.user_id,s.id,i.generation FROM campus_school_sessions s JOIN campus_identities i USING(user_id) WHERE NOT i.revoked AND s.expires_at>now() AND s.last_used_at>now()-interval '30 minutes'");if(owners.rowCount!==1)throw Error('OWNER_SESSION_DENIED');const owner=owners.rows[0];
const repository=new SchoolSessionRepository(pool,new SessionCrypto(c.SCHOOL_SESSION_KEY,c.SCHOOL_ACCOUNT_HASH_KEY));
const ids=await repository.withSession(owner.user_id,async stored=>{const jar=await CookieJar.deserialize(stored.cookies);try{const r=await new SchoolClient(jar).fetch('https://ais.nutc.edu.tw/student/apps/my_absence_notes.aspx',AbortSignal.timeout(12000));return {cookies:JSON.stringify(await jar.serialize()),data:parseLeaveRecordSummary(schoolHtml(r.body,r.contentType)).map(r=>r.id).sort((a,b)=>a-b)};}finally{await jar.removeAllCookies();}});
const run=${JSON.stringify(run)},text=${JSON.stringify(reply??'')};
const pending=(await pool.query('SELECT * FROM campus_leave_previews WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[owner.user_id])).rows[0];
let payloadMatches=false,summaryMatches=false,responseAccepted=false,newMatchingCount=0,uniqueNewRecordMatches=false;
let newIds;const baseline=${JSON.stringify(baseline??null)};if(baseline){const [iv,tag,data]=baseline.split('.'),key=createHash('sha256').update('leave-live-evidence:'+process.env.APP_MASTER_KEY).digest(),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(run));decipher.setAuthTag(Buffer.from(tag,'base64url'));const old=JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'));newIds=ids.filter(id=>!old.includes(id));}
if(pending?.encrypted_payload){const crypto=new LeaveCrypto(c.SCHOOL_SESSION_KEY),payload=JSON.parse(crypto.open(pending.encrypted_payload,pending,'payload'));payloadMatches=payload.intent.date==='2026/10/14'&&payload.intent.leave_type==='心理調適假'&&payload.intent.reason==='心理不舒服'&&payload.code===17&&JSON.stringify(payload.rows.map(r=>r.sec))==='[2,3,4]';summaryMatches=payloadMatches&&text.includes('尚未送出')&&text.includes('2026/10/14')&&text.includes('心理調適假')&&text.includes('心理不舒服')&&text.includes('下一則訊息')&&text.includes('確認送出')&&payload.rows.every(r=>text.includes('第'+r.sec+'節')&&text.includes(r.name));if(pending.encrypted_outcome){const result=JSON.parse(crypto.open(pending.encrypted_outcome,pending,'outcome'));let evidence;try{evidence=JSON.parse(result.evidence);}catch{evidence={};}responseAccepted=evidence.semantic?.state==='accepted';newMatchingCount=evidence.matches?.length??0;uniqueNewRecordMatches=newIds?.length===1&&newMatchingCount===1&&newIds[0]===evidence.matches[0]&&ids.includes(evidence.matches[0]);}}
const attempts=Number((await pool.query('SELECT count(*)::int n FROM campus_leave_previews WHERE user_id=$1 AND attempted_at IS NOT NULL',[owner.user_id])).rows[0].n);
const hash=createHmac('sha256',process.env.APP_MASTER_KEY).update(run+':'+JSON.stringify(ids)).digest('hex');
const key=createHash('sha256').update('leave-live-evidence:'+process.env.APP_MASTER_KEY).digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(run));const encrypted=Buffer.concat([cipher.update(JSON.stringify(ids)),cipher.final()]);
console.log(JSON.stringify({owner:owner.user_id,generation:String(owner.generation),session:owner.id,count:ids.length,hash,encryptedBefore:[iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.'),payloadMatches,summaryMatches,responseAccepted,newMatchingCount,uniqueNewRecordMatches,attempts,attemptId:pending?.attempt_id,pendingId:pending?.id,presented:Boolean(pending?.presented_at),state:pending?.state}));
}finally{await pool.end();}
`);}
function gateway(run,stage,action,taskId){return execute('gateway',`
import {Pool} from 'pg';import {loadConfig} from './dist/apps/gateway/src/config/env.js';import {TaskRepository} from './dist/apps/gateway/src/modules/tasks/task.repository.js';
const config=loadConfig(),pool=new Pool({connectionString:config.databaseUrl}),queue=new TaskRepository(pool,config.sessionSecret,config.liffId),stage=${JSON.stringify(stage)};try{
const run=${JSON.stringify(run)},owner=stage.owner,session=stage.session;
${action==='enqueue'?`const id=await queue.enqueueCapture(run,owner,session,${JSON.stringify(stage.prompt)},stage.generation);console.log(JSON.stringify({taskId:id}));`:action==='ack'?`await queue.ackCapture(run,${JSON.stringify(taskId)},owner,session,stage.reply);console.log(JSON.stringify({acknowledged:true}));`:`let reply;for(let i=0;i<100;i++){try{reply=await queue.captureResult(run,${JSON.stringify(taskId)},owner,session);break;}catch{const task=await pool.query('SELECT state FROM campus_tasks WHERE id=$1',[${JSON.stringify(taskId)}]);if(task.rows[0]?.state==='failed'||task.rows[0]?.state==='cancelled')throw Error('CAPTURE_FAILED');await new Promise(r=>setTimeout(r,1000));}}if(!reply)throw Error('CAPTURE_TIMEOUT');const proof=(await pool.query('SELECT t.delivery_mode,o.attempts FROM campus_tasks t JOIN campus_outbox o ON o.task_id=t.id WHERE t.id=$1',[${JSON.stringify(taskId)}])).rows[0];if(proof?.delivery_mode!=='capture'||proof.attempts!==0)throw Error('CAPTURE_LINE_PROOF_FAILED');console.log(JSON.stringify({reply,lineDeliveryAttempts:proof.attempts,loadingSkipped:proof.delivery_mode==='capture'}));`}
}finally{await pool.end();}
`);}
export function assertConfirmReady(manifest,before){if(!manifest.previewAcknowledged||!before.payloadMatches||before.pendingId!==manifest.pendingId||!before.presented||before.attempts!==0||before.hash!==manifest.beforeHash||manifest.confirmTask||manifest.confirmReserved)throw Error('CONFIRM_PREREQUISITE_DENIED');}
export function atomicManifest(path,value){const temporary=path+'.'+randomUUID()+'.tmp',fd=openSync(temporary,'wx',0o600);try{writeFileSync(fd,JSON.stringify({value,signature:sign(value)}));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,path);chmodSync(path,0o600);}
export async function main(args){let lock,lockPath;try{
const {mode,run:requested}=parseArgs(args);guard();
if(mode!=='--reconcile')execFileSync(process.execPath,['scripts/update-local-leave-workflow.mjs','--project','nutc-agent','--verify'],{stdio:['ignore','pipe','pipe'],timeout:30000});
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(mode!=='--reconcile'&&date!=='2026-10-14')throw Error('LIVE_DATE_DENIED');
const run=requested??randomUUID(),dir='.local/verification/leave-preview-confirmation/live';mkdirSync(dir,{recursive:true,mode:0o700});const path=dir+'/'+run+'.json';
if(mode!=='--reconcile'){lockPath=dir+'/operation.lock';lock=openSync(lockPath,'wx',0o600);writeFileSync(lock,JSON.stringify({run,pid:process.pid}));fsyncSync(lock);}
const save=value=>atomicManifest(path,value);
let manifest;if(existsSync(path)){const envelope=json(readFileSync(path,'utf8'));if(sign(envelope.value)!==envelope.signature)throw Error('MANIFEST_DENIED');manifest=envelope.value;}else if(mode!=='--preview')throw Error('RUN_NOT_FOUND');
const before=school(run);if(manifest&&(manifest.owner!==before.owner||manifest.generation!==before.generation||manifest.session!==before.session))throw Error('OWNER_SESSION_CHANGED');
if(manifest&&manifest.requestFingerprint!==sign({date:'2026/10/14',periods:[2,3,4],type:'心理調適假',reason:'心理不舒服'}))throw Error('REQUEST_FINGERPRINT_CHANGED');
if(mode==='--reconcile'){console.log(JSON.stringify({run,mode,state:before.state,responseAccepted:before.responseAccepted,newMatchingCount:before.newMatchingCount,attempts:before.attempts,recordCount:before.count,recordHash:before.hash}));return;}
if(mode==='--preview'){
 if(before.attempts!==0)throw Error('PRIOR_ATTEMPT_DENIED');
 if(!manifest){manifest={run,owner:before.owner,generation:before.generation,session:before.session,beforeCount:before.count,beforeHash:before.hash,encryptedBefore:before.encryptedBefore,requestFingerprint:sign({date:'2026/10/14',periods:[2,3,4],type:'心理調適假',reason:'心理不舒服'})};save(manifest);}
 if(!manifest.previewTask){if(manifest.previewReserved)throw Error('PREVIEW_ENQUEUE_OUTCOME_UNKNOWN');manifest.previewReserved=true;save(manifest);manifest.previewTask=gateway(run,{...before,prompt:'今天早上請假三節，請心理假，心理不舒服。'},'enqueue').taskId;save(manifest);}
 const captured=gateway(run,before,'capture',manifest.previewTask),inspection=school(run,captured.reply);
 if(inspection.owner!==manifest.owner||inspection.generation!==manifest.generation||inspection.session!==manifest.session)throw Error('OWNER_SESSION_CHANGED');
 if(!inspection.payloadMatches||!inspection.summaryMatches||inspection.attempts!==0||inspection.hash!==manifest.beforeHash)throw Error('PREVIEW_PROOF_FAILED');
 gateway(run,{...before,reply:captured.reply},'ack',manifest.previewTask);manifest.pendingId=inspection.pendingId;manifest.previewAcknowledged=true;save(manifest);
 console.log(JSON.stringify({run,mode,status:'preview_verified',summaryMatches:true,createAttempts:0,recordHash:inspection.hash,recordCount:inspection.count,lineDeliveryAttempts:captured.lineDeliveryAttempts,loadingSkipped:captured.loadingSkipped}));return;
}
if(!manifest.previewAcknowledged||!before.payloadMatches||before.pendingId!==manifest.pendingId||!before.presented)throw Error('CONFIRM_PREREQUISITE_DENIED');
if(mode==='--confirm-authorized'){
 assertConfirmReady(manifest,before);
 manifest.confirmReserved=true;save(manifest);manifest.confirmTask=gateway(run,{...before,prompt:'確認送出'},'enqueue').taskId;save(manifest);
 const captured=gateway(run,before,'capture',manifest.confirmTask),after=school(run,undefined,manifest.encryptedBefore);
 if(after.owner!==manifest.owner||after.generation!==manifest.generation||after.session!==manifest.session)throw Error('OWNER_SESSION_CHANGED');
 manifest.afterHash=after.hash;manifest.afterCount=after.count;manifest.outcome=after.state;manifest.attemptId=after.attemptId;save(manifest);
 gateway(run,{...before,reply:captured.reply},'ack',manifest.confirmTask);
 if(after.state!=='succeeded'||!after.responseAccepted||after.newMatchingCount!==1||!after.uniqueNewRecordMatches||after.attempts!==1||after.count!==manifest.beforeCount+1)throw Error('OUTCOME_NOT_VERIFIED_NO_RETRY');
 console.log(JSON.stringify({run,mode,status:'submission_verified',newMatchingCount:1,responseAccepted:true,attempts:1,recordHash:after.hash,lineDeliveryAttempts:captured.lineDeliveryAttempts,loadingSkipped:captured.loadingSkipped}));return;
}
if(before.attempts!==1||!manifest.afterHash||before.hash!==manifest.afterHash||manifest.replayTask)throw Error('REPLAY_PREREQUISITE_DENIED');
manifest.replayTask=gateway(run,{...before,prompt:'確認送出'},'enqueue').taskId;save(manifest);const captured=gateway(run,before,'capture',manifest.replayTask),after=school(run,undefined,manifest.encryptedBefore);gateway(run,{...before,reply:captured.reply},'ack',manifest.replayTask);if(after.attempts!==1||after.hash!==manifest.afterHash||/申請已送出/.test(captured.reply))throw Error('REPLAY_PROOF_FAILED');console.log(JSON.stringify({run,mode,status:'replay_verified',attempts:1,recordHash:after.hash,lineDeliveryAttempts:captured.lineDeliveryAttempts,loadingSkipped:captured.loadingSkipped}));
}catch{throw Error('LIVE_LEAVE_CHECK_STOPPED; no automatic retry; use read-only reconcile.');}finally{if(lock!==undefined){closeSync(lock);unlinkSync(lockPath);}}}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('LIVE_LEAVE_CHECK_STOPPED; no automatic retry; restricted manifest retained.');process.exitCode=1;});
