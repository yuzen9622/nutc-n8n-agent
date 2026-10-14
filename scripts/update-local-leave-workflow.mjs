import {readFileSync,writeFileSync,mkdirSync,chmodSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requiredEnv} from './env.mjs';
function safeJson(text){try{return JSON.parse(text);}catch{throw Error('N8N_JSON_INVALID');}}
export const PINNED_N8N_IMAGE='docker.n8n.io/n8nio/n8n:2.41.7@sha256:bcef56dd44014e09774219536a3f8cb07f1b553fcba94044bd9fc0f21f8676a3';
const owned=new Set(['student_leave','student_leave_preview','student_leave_confirm','student_leave_notes']);
const ownedPreviewTools=['student_leave_preview','student_leave_confirm','student_leave_notes'];
// Object keys are order-insensitive (n8n may reorder them); array order and every value are preserved.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const LEGACY_LEAVE_SIGNATURE='0bd226b2e48478c9ad12c9ead26df0c75fc2bcdeaf740cf7502c31ad1080eefb';
const OWNED_CONNECTION={ai_tool:[[{node:'AI Agent',type:'ai_tool',index:0}]]};
function instruction(message){const match=message?.match(/^=\{\{\s*("(?:[^"\\]|\\.)*")/);if(!match)throw Error('SYSTEM_MESSAGE_UNKNOWN');return {literal:match[1],text:safeJson(match[1])};}
function block(text){const start=text.search(/   - (?:學生請假與假單進度|請假必須兩則訊息)/),end=text.indexOf('   - 寄送學校信件',start);if(start<0||end<=start)throw Error('LEAVE_PARAGRAPH_UNKNOWN');return {start,end,value:text.slice(start,end)};}
export function nonownedHash(workflow){const w=structuredClone(workflow);const nodes=w.nodes.filter(n=>!owned.has(n.name));for(const n of nodes)if(n.name==='AI Agent'){const i=instruction(n.parameters.options.systemMessage),b=block(i.text);n.parameters.options.systemMessage=n.parameters.options.systemMessage.replace(i.literal,JSON.stringify(i.text.slice(0,b.start)+'[LEAVE]'+i.text.slice(b.end)));}
 const connections=Object.fromEntries(Object.entries(w.connections).filter(([name])=>!owned.has(name)));
 return digest({nodes,connections,name:w.name,settings:w.settings,pinData:w.pinData??{}});
}
export function patchOwned(current,source){
 if(!current.nodes?.some(n=>n.name==='AI Agent')||!current.nodes.some(n=>owned.has(n.name)))throw Error('WORKFLOW_UNKNOWN');
 const signature=n=>digest({type:n.type,typeVersion:n.typeVersion,parameters:n.parameters,retryOnFail:n.retryOnFail});
 const sourceOwned=source.nodes?.filter(n=>owned.has(n.name))??[];
 if(sourceOwned.length!==3||digest(sourceOwned.map(n=>n.name).sort())!==digest([...ownedPreviewTools].sort())||Object.keys(source.connections??{}).filter(k=>owned.has(k)).sort().join()!==[...ownedPreviewTools].sort().join()||ownedPreviewTools.some(name=>digest(source.connections[name])!==digest(OWNED_CONNECTION))||JSON.stringify(Object.entries(source.connections).filter(([k])=>!owned.has(k))).includes('student_leave'))throw Error('UNKNOWN_SOURCE_LEAVE');
 const existing=current.nodes.filter(n=>owned.has(n.name));
 if(existing.some(n=>n.name==='student_leave')){if(existing.length!==1||signature(existing[0])!==LEGACY_LEAVE_SIGNATURE)throw Error('UNKNOWN_LEAVE_EDITS');}
 else if(existing.length!==3||new Set(existing.map(n=>n.name)).size!==3||existing.some(n=>{const expected=source.nodes.find(s=>s.name===n.name);return !expected||signature(n)!==signature(expected);}))throw Error('UNKNOWN_LEAVE_EDITS');
 for(const [from,ports] of Object.entries(current.connections)){if(owned.has(from)){if(digest(ports)!==digest(OWNED_CONNECTION))throw Error('UNKNOWN_LEAVE_CONNECTION');}else if(JSON.stringify(ports).includes('student_leave'))throw Error('UNKNOWN_LEAVE_CONNECTION');}
 const before=nonownedHash(current),w=structuredClone(current),old=w.nodes.find(n=>owned.has(n.name));
 if(existing.some(n=>digest(n.credentials)!==digest(old.credentials)))throw Error('SERVICE_CREDENTIAL_DRIFT');
 const local=source.nodes.filter(n=>owned.has(n.name)).map(n=>({...structuredClone(n),credentials:structuredClone(old.credentials)}));
 if(!old.credentials?.httpHeaderAuth)throw Error('SERVICE_CREDENTIAL_UNKNOWN');
 w.nodes=w.nodes.filter(n=>!owned.has(n.name));w.nodes.push(...local);
 for(const key of Object.keys(w.connections))if(owned.has(key))delete w.connections[key];
 for(const n of local)w.connections[n.name]=structuredClone(source.connections[n.name]);
 const agent=w.nodes.find(n=>n.name==='AI Agent'),i=instruction(agent.parameters.options.systemMessage),b=block(i.text),s=instruction(source.nodes.find(n=>n.name==='AI Agent').parameters.options.systemMessage),sb=block(s.text);
 agent.parameters.options.systemMessage=agent.parameters.options.systemMessage.replace(i.literal,JSON.stringify(i.text.slice(0,b.start)+sb.value+i.text.slice(b.end)));
 if(nonownedHash(w)!==before)throw Error('NONOWNED_DRIFT');return w;
}
export function guardInstance(info,cwd){
 if(info.Config?.Labels?.['com.docker.compose.project']!=='nutc-agent'||info.Config?.Labels?.['com.docker.compose.service']!=='n8n'||realpathSync(info.Config.Labels['com.docker.compose.project.working_dir'])!==realpathSync(cwd))throw Error('INSTANCE_DENIED');
 if(info.Config.Image!==PINNED_N8N_IMAGE)throw Error('IMAGE_DENIED');
 const ports=info.NetworkSettings?.Ports?.['5678/tcp'];if(!Array.isArray(ports)||ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!=='15680')throw Error('PORT_DENIED');
}
async function bounded(response){const reader=response.body?.getReader();if(!reader)throw Error('N8N_RESPONSE_INVALID');let size=0;const chunks=[];try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2*1024*1024)throw Error('N8N_RESPONSE_LIMIT');chunks.push(next.value);}}finally{await reader.cancel();}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('N8N_RESPONSE_INVALID');}}
export async function applyUpdate(api,current,source,snapshot,checkpoint=()=>{}){
 const before=nonownedHash(current);if(snapshot.workflowHash!==digest(current)||snapshot.versionId!==current.versionId||snapshot.nonownedHash!==before||!current.checksum)throw Error('VERSION_DRIFT');
 const patched=patchOwned(current,source);
 const lock=await api('/workflows/campusNativeAgentLive/collaboration/write-lock');if(lock?.clientId)throw Error('EDITOR_WRITE_LOCK');
 if(current.active){await api('/workflows/campusNativeAgentLive/deactivate','POST',{expectedChecksum:current.checksum});checkpoint('deactivated');}
 const fresh=await api('/workflows/campusNativeAgentLive');if(fresh.versionId!==snapshot.versionId||fresh.active||nonownedHash(fresh)!==before||!fresh.checksum)throw Error('VERSION_DRIFT_AFTER_DEACTIVATION');
 const nextLock=await api('/workflows/campusNativeAgentLive/collaboration/write-lock');if(nextLock?.clientId)throw Error('EDITOR_WRITE_LOCK');
 const updated=await api('/workflows/campusNativeAgentLive','PATCH',{versionId:snapshot.versionId,expectedChecksum:fresh.checksum,name:current.name,nodes:patched.nodes,connections:patched.connections,settings:current.settings});checkpoint('patched');
 if(!updated.versionId||!updated.checksum||nonownedHash(updated)!==before||digest(updated.nodes)!==digest(patched.nodes)||digest(updated.connections)!==digest(patched.connections))throw Error('PATCH_CONTENT_MISMATCH');
 const readback=await api('/workflows/campusNativeAgentLive');if(readback.versionId!==updated.versionId||readback.checksum!==updated.checksum||readback.active)throw Error('VERSION_DRIFT_BEFORE_ACTIVATION');
 if(current.active){await api('/workflows/campusNativeAgentLive/activate','POST',{versionId:updated.versionId,expectedChecksum:updated.checksum});checkpoint('activated');}
 const final=await api('/workflows/campusNativeAgentLive');if(nonownedHash(final)!==before||final.versionId!==updated.versionId||Boolean(final.active)!==Boolean(current.active)||(final.active&&final.activeVersionId!==updated.versionId))throw Error('FINAL_STATE_MISMATCH');return final;
}
export async function main(args){
 try{
 const mode=args.includes('--apply')?'apply':args.includes('--verify')?'verify':'dry-run';
 if(['--apply','--verify','--dry-run'].filter(a=>args.includes(a)).length>1)throw Error('MODE_DENIED');
 if(args[0]!=='--project'||args[1]!=='nutc-agent'||args.some(a=>!['--project','nutc-agent','--dry-run','--apply','--verify'].includes(a)))throw Error('KNOWN_PROJECT_REQUIRED');
 const id=execFileSync('docker',['compose','-p','nutc-agent','ps','-q','n8n'],{encoding:'utf8'}).trim();if(!id)throw Error('INSTANCE_DENIED');const info=safeJson(execFileSync('docker',['inspect',id],{encoding:'utf8'}))[0];guardInstance(info,'.');
 const base='http://127.0.0.1:15680';if(process.env.N8N_BASE_URL&&!['http://127.0.0.1:15680','http://localhost:15680'].includes(process.env.N8N_BASE_URL))throw Error('REMOTE_URL_DENIED');
 const login=await fetch(base+'/rest/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({emailOrLdapLoginId:requiredEnv('N8N_OWNER_EMAIL'),password:requiredEnv('N8N_OWNER_PASSWORD')}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!login.ok)throw Error('OWNER_LOGIN_DENIED');const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!cookie)throw Error('OWNER_LOGIN_DENIED');
 const clientRef=randomUUID();
 const api=async(path,method='GET',body)=>{const r=await fetch(base+'/rest'+path,{method,headers:{'content-type':'application/json',cookie,'push-ref':clientRef},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('N8N_API_DENIED');const value=await bounded(r);return value.data??value;};
 const current=await api('/workflows/campusNativeAgentLive'),source=safeJson(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
 if(current.id!=='campusNativeAgentLive'||!current.versionId||(current.active&&current.activeVersionId!==current.versionId))throw Error('UNPUBLISHED_EDITS_OR_VERSION_UNKNOWN');
 const patched=patchOwned(current,source),before=nonownedHash(current);
 const dir='.local/verification/leave-preview-confirmation/updater';mkdirSync(dir,{recursive:true,mode:0o700});const path=dir+'/guard.json';
 if(mode==='dry-run'){const snapshot={id:current.id,versionId:current.versionId,active:current.active,nonownedHash:before,workflowHash:digest(current),workflow:current};writeFileSync(path,JSON.stringify(snapshot),{mode:0o600});chmodSync(path,0o600);console.log(JSON.stringify({status:'dry-run',versionId:current.versionId,nonownedHash:before,patchHash:digest(patched)}));return;}
 if(mode==='verify'){for(const name of ['student_leave_preview','student_leave_confirm','student_leave_notes'])if(!current.nodes.some(n=>n.name===name))throw Error('LEAVE_TOOL_MISSING');if(!current.active||current.nodes.some(n=>n.name==='student_leave')||digest(patchOwned(current,source).nodes)!==digest(current.nodes))throw Error('ACTIVE_LEAVE_MISMATCH');console.log(JSON.stringify({status:'verified',versionId:current.versionId,nonownedHash:before}));return;}
 const snapshot=safeJson(readFileSync(path,'utf8'));if(snapshot.workflowHash!==digest(current)||snapshot.versionId!==current.versionId||snapshot.nonownedHash!==before)throw Error('VERSION_DRIFT');
 const progress=phase=>{const report=dir+'/progress.json';writeFileSync(report,JSON.stringify({phase,previousVersion:snapshot.versionId}),{mode:0o600});chmodSync(report,0o600);};
 const final=await applyUpdate(api,current,source,snapshot,progress);progress('verified');console.log(JSON.stringify({status:'updated',versionId:final.versionId,nonownedHash:before}));
 }catch{throw Error('LOCAL_LEAVE_UPDATE_DENIED');}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('LOCAL_LEAVE_UPDATE_DENIED; inspect restricted snapshot; no automatic retry.');process.exitCode=1;});
