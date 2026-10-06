import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Fault, HTTP, TASK_TTL_MS, RETENTION_MS } from '../../constants/index.js';
import { MockRepository } from './mock.repository.js';
import type { Operation, Task, TaskAuth } from './mock.type.js';
import type { Scenario } from './mock.schema.js';
const id = (prefix:string) => `${prefix}_${randomUUID()}`;
const same = (a:string,b:string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class MockService {
  constructor(readonly repo = new MockRepository(), private now = () => Date.now()) {}
  create(scenario:Scenario) {
    const task:Task = {taskId:id('task'),requestId:id('request'),taskCapability:id('cap'),deadlineAt:new Date(this.now()+TASK_TTL_MS).toISOString(),state:'pending',scenario,operations:[],refs:new Map(),results:[],outboxCount:0,createdAt:this.now()};
    if(scenario === 'duplicate_event') {task.state='completed';task.outboxCount=1;task.outcome='answered';}
    this.repo.tasks.set(task.taskId,task);
    return {taskId:task.taskId,requestId:task.requestId,taskCapability:task.taskCapability,deadlineAt:task.deadlineAt};
  }
  private get(taskId:string, auth:TaskAuth, lease = true) {
    const t=this.repo.tasks.get(taskId);
    if(!t || !same(t.taskCapability,auth.capability)) throw new Fault(HTTP.FORBIDDEN,'TASK_DENIED');
    if(lease && (!t.leaseToken || !same(t.leaseToken,auth.lease))) throw new Fault(HTTP.FORBIDDEN,'LEASE_DENIED');
    if(this.now()>Date.parse(t.deadlineAt)) throw new Fault(HTTP.CONFLICT,'DEADLINE_EXCEEDED');
    return t;
  }
  claim(taskId:string,auth:TaskAuth) {
    const t=this.get(taskId,auth,false);
    if(t.state !== 'pending') return {acquired:false,state:t.state};
    t.state='running';t.leaseToken=id('lease');return {acquired:true,state:t.state,leaseToken:t.leaseToken};
  }
  private ref(t:Task,op:Operation|undefined,kind:string) {
    const value=id(kind);t.refs.set(value,{operationId:op?.operationId??'local',kind});op?.refs.set(kind,value);return value;
  }
  private checkRef(t:Task,op:Operation|undefined,value:unknown,kind:string) {
    const found=t.refs.get(String(value));
    if(!found || found.kind !== kind || (op && found.operationId!==op.operationId)) throw new Fault(HTTP.FORBIDDEN,'REF_DENIED');
  }
  plan(taskId:string,auth:TaskAuth) {
    const t=this.get(taskId,auth);
    if(t.state!=='running') throw new Fault(HTTP.CONFLICT,'TASK_NOT_RUNNING');
    let intent='public';
    if(/schedule|absence|announcements|reauth|ocr_failed|credential_invalid|unknown_personal|session_expired/.test(t.scenario)) intent='personal';
    if(t.scenario==='mixed_partial') intent='mixed';
    if(t.scenario==='unknown_intent') intent='unknown';
    if(t.scenario.endsWith('_prompt')) {
      const resultRef=[...t.refs.entries()].find(([,v])=>v.operationId==='local')?.[0]??this.ref(t,undefined,'result');
      return {intent:'local',operations:[],resultRef};
    }
    if(!t.operations.length && intent!=='unknown') {
      const kinds:Array<'public'|'personal'> = intent==='mixed'?['public','personal']:[intent as 'public'|'personal'];
      t.operations=kinds.map(kind=>({operationId:id('operation'),kind,action:t.scenario.startsWith('absence')?'absence':t.scenario.startsWith('announcements')?'announcements':t.scenario==='unknown_personal'?'unknown':'schedule',iteration:0,route:['knowledge_success','embedding_unavailable'].includes(t.scenario)?'knowledge':['both_success','source_conflict'].includes(t.scenario)?'both':'web',refs:new Map(),stages:new Map(),repaired:false,fallback:false,failed:false}));
    }
    return {intent,operations:t.operations.map(({operationId,kind,action})=>({operationId,kind,action}))};
  }
  stage(taskId:string,auth:TaskAuth,kind:'public'|'personal',stage:string,body:Record<string,unknown>) {
    const t=this.get(taskId,auth);
    if(t.state!=='running') throw new Fault(HTTP.CONFLICT,'TASK_NOT_RUNNING');
    const op=t.operations.find(o=>o.operationId===body.operationId && o.kind===kind);
    if(!op) throw new Fault(HTTP.FORBIDDEN,'OPERATION_DENIED');
    for(const [key,value] of Object.entries(body)) if(key.endsWith('Ref')) this.checkRef(t,op,value,key.slice(0,-3));
    const cacheKey=`${stage}:${op.iteration}`;
    const cached=op.stages.get(cacheKey);if(cached) return cached;
    let result:Record<string,unknown>;
    if(kind==='public') result=this.publicStage(t,op,stage);
    else result=this.personalStage(t,op,stage);
    op.stages.set(cacheKey,result);return result;
  }
  private publicStage(t:Task,op:Operation,s:string):Record<string,unknown> {
    const empty=['public_no_source','retrieval_exhausted'].includes(t.scenario);
    const need=(name:string) => {if(!op.refs.has(name)) throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');};
    switch(s) {
      case 'prepare': return {queryRef:this.ref(t,op,'query'),route:t.scenario==='unknown_route'?'unknown':op.route,iteration:op.iteration,freshnessRequired:op.route!=='knowledge'};
      case 'knowledge': need('query');return {knowledgeRef:this.ref(t,op,'knowledge'),count:2,degraded:t.scenario==='embedding_unavailable'};
      case 'search': need('query');
        if(t.scenario==='provider_timeout') {op.failed=true;throw new Fault(HTTP.UPSTREAM,'UPSTREAM_FAILED');}
        return {searchRef:this.ref(t,op,'search'),candidateCount:empty?0:2,remainingSearches:1-op.iteration};
      case 'read':need('search');return {evidenceRef:this.ref(t,op,'evidence'),count:empty?0:2};
      case 'collect':
        if(!op.refs.has('knowledge') && !op.refs.has('evidence')) throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');
        return {evidenceRef:this.ref(t,op,'evidence'),count:empty?0:2,iteration:op.iteration};
      case 'assess': need('evidence');return {assessmentRef:this.ref(t,op,'assessment'),decision:t.scenario==='unknown_decision'?'unknown':['retrieval_retry','retrieval_exhausted','rewrite_denied'].includes(t.scenario)?'retrieve':empty?'insufficient':'answer'};
      case 'rewrite-query':need('assessment');
        if(op.iteration>=1 || t.scenario==='rewrite_denied') return {allowed:false,iteration:op.iteration};
        op.iteration=1;op.route='web';return {allowed:true,iteration:1,queryRef:this.ref(t,op,'query'),route:'web'};
      case 'generate':need('evidence');op.fallback=empty;return {draftRef:this.ref(t,op,'draft')};
      case 'validate':need('draft');return {validation:t.scenario==='repair_failed'&&op.repaired?'invalid':['repair_success','repair_failed'].includes(t.scenario)&&!op.repaired?'repairable':'valid',draftRef:op.refs.get('draft')};
      case 'repair':need('draft');if(op.repaired) throw new Fault(HTTP.CONFLICT,'REPAIR_BUDGET');op.repaired=true;
        op.stages.delete(`validate:${op.iteration}`);return {draftRef:this.ref(t,op,'draft')};
      case 'fallback':op.fallback=true;return {draftRef:this.ref(t,op,'draft')};
      case 'render':need('draft');return {resultRef:this.ref(t,op,'result'),status:op.fallback?'insufficient':'answered'};
      default:throw new Fault(HTTP.NOT_FOUND,'UNKNOWN_STAGE');
    }
  }
  private personalStage(t:Task,op:Operation,s:string):Record<string,unknown> {
    const reauth=['reauth_required','mixed_partial','ocr_failed','credential_invalid'].includes(t.scenario);
    switch(s) {
      case 'check-session':return {session:reauth?'reauth_required':'active',reasonCode:t.scenario,action:op.action};
      case 'schedule':case 'absence':case 'announcements':
        if(s!==op.action) throw new Fault(HTTP.FORBIDDEN,'ACTION_DENIED');
        if(reauth || t.scenario==='session_expired') return {session:'reauth_required'};
        return {session:'active',dataRef:this.ref(t,op,'data')};
      case 'render':if(!op.refs.has('data')) throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');return {resultRef:this.ref(t,op,'result'),status:'answered'};
      case 'login-prompt':op.fallback=true;return {resultRef:this.ref(t,op,'result'),status:'reauth_required'};
      case 'unsupported-prompt':op.fallback=true;return {resultRef:this.ref(t,op,'result'),status:'unsupported'};
      default:throw new Fault(HTTP.NOT_FOUND,'UNKNOWN_STAGE');
    }
  }
  complete(taskId:string,auth:TaskAuth,refs:string[]) {
    const t=this.get(taskId,auth);
    for(const ref of refs) this.checkRef(t,undefined,ref,'result');
    if(t.state==='completed') {
      if(JSON.stringify(t.results)!==JSON.stringify(refs)) throw new Fault(HTTP.CONFLICT,'RESULT_CHANGED');
      return {status:'queued_for_delivery',outcome:t.outcome};
    }
    if(t.state!=='running') throw new Fault(HTTP.CONFLICT,'TASK_NOT_RUNNING');
    const operations=new Set(refs.map(r=>t.refs.get(r)!.operationId));
    if(operations.size!==refs.length || t.operations.some(op=>!operations.has(op.operationId))) throw new Fault(HTTP.CONFLICT,'INCOMPLETE_RESULTS');
    t.results=refs;t.state='completed';t.outboxCount=1;
    t.outcome=t.scenario==='binding_prompt'?'binding_required':t.scenario==='clarify_prompt'?'clarify':t.scenario==='unsupported_prompt'?'unsupported':t.scenario==='unknown_personal'?'unsupported':t.scenario==='mixed_partial'?'partial':t.operations.some(o=>o.fallback)?t.operations[0]!.kind==='public'?'insufficient':'reauth_required':'answered';
    return {status:'queued_for_delivery',outcome:t.outcome};
  }
  fail(taskId:string,auth:TaskAuth,errorCode:string) {
    const t=this.get(taskId,auth);if(t.state==='completed') throw new Fault(HTTP.CONFLICT,'TASK_ALREADY_COMPLETED');
    t.state='failed';t.outcome=errorCode;t.outboxCount=1;return {status:'queued_for_delivery',outcome:errorCode};
  }
  delivery(taskId:string) {
    const t=this.repo.tasks.get(taskId);if(!t) throw new Fault(HTTP.NOT_FOUND,'TASK_NOT_FOUND');
    return {taskId:t.taskId,synthetic:true,state:t.state,outboxCount:t.outboxCount,outcome:t.outcome??'pending',delivered:false,stages:t.operations.flatMap(o=>[...o.stages.keys()].map(stage=>`${o.kind}/${stage}`))};
  }
  cleanup() {
    let removed=0;
    for(const [key,t] of this.repo.tasks) {
      if(t.createdAt+RETENTION_MS<this.now()) {this.repo.tasks.delete(key);removed++;}
      else if(t.state==='running' && Date.parse(t.deadlineAt)<this.now()) {t.state='failed';t.outcome='DEADLINE_EXCEEDED';t.outboxCount=1;}
    }
    for(const [key,s] of this.repo.syncs) if(s.createdAt+RETENTION_MS<this.now()) this.repo.syncs.delete(key);
    return {removed};
  }
  health() {return {healthy:true,synthetic:true,taskCount:this.repo.tasks.size,eventCount:this.repo.events.length};}
  error(event:{workflowId:string;executionId:string;errorCode:string}) {this.repo.events.push(event);if(this.repo.events.length>1000)this.repo.events.shift();return {recorded:true};}
  syncStart(scenario:string) {
    if([...this.repo.syncs.values()].some(s=>!s.finished&&s.createdAt+600_000>this.now())) return {acquired:false};
    const syncRef=id('sync');const states=scenario==='all'?['updated','unchanged','withdrawn','failed']:[scenario];
    this.repo.syncs.set(syncRef,{syncRef,createdAt:this.now(),index:0,sources:states.map(status=>({sourceRef:id('source'),status,published:false,recorded:false,stage:'new'})),finished:false});
    return {syncRef,acquired:true};
  }
  sync(stage:string,body:Record<string,unknown>) {
    const s=this.repo.syncs.get(String(body.syncRef));if(!s)throw new Fault(HTTP.FORBIDDEN,'SYNC_DENIED');
    if(s.createdAt+600_000<this.now()) throw new Fault(HTTP.CONFLICT,'SYNC_DEADLINE');
    if(stage==='finish') {
      if(s.index<s.sources.length)throw new Fault(HTTP.CONFLICT,'SYNC_INCOMPLETE');s.finished=true;
      return {syncRef:s.syncRef,status:'finished',counts:Object.fromEntries(['updated','unchanged','withdrawn','failed'].map(k=>[k,s.sources.filter(x=>x.status===k).length])),published:s.sources.filter(x=>x.published).length};
    }
    if(s.finished)throw new Fault(HTTP.CONFLICT,'SYNC_FINISHED');
    if(stage==='next')return {syncRef:s.syncRef,done:s.index>=s.sources.length,...(s.sources[s.index]?{sourceRef:s.sources[s.index]!.sourceRef}:{})};
    const source=s.sources[s.index];
    if(!source || source.sourceRef!==body.sourceRef)throw new Fault(HTTP.FORBIDDEN,'SOURCE_DENIED');
    switch(stage) {
      case 'fetch':source.stage='fetched';return {status:['updated','failed'].includes(source.status)?'changed':source.status};
      case 'parse':if(source.stage!=='fetched')throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');source.stage='parsed';
        if(source.status==='failed')return {ok:false,status:'failed'};
        source.versionRef=id('version');return {ok:true,versionRef:source.versionRef};
      case 'embed':if(source.stage!=='parsed'||source.versionRef!==body.versionRef)throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');source.stage='embedded';return {batchDone:true,versionDone:true,allowed:true};
      case 'publish':if(source.stage!=='embedded'||source.versionRef!==body.versionRef)throw new Fault(HTTP.CONFLICT,'STAGE_ORDER');source.published=true;source.stage='published';return {published:true};
      case 'record':if(source.status==='updated'&&!source.published)throw new Fault(HTTP.CONFLICT,'UNPUBLISHED_SOURCE');source.recorded=true;s.index++;return {recorded:true};
      default:throw new Fault(HTTP.NOT_FOUND,'UNKNOWN_STAGE');
    }
  }
}
