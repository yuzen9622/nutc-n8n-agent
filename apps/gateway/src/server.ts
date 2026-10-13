import {N8nGroundingProvider} from './modules/search/n8n-grounding.provider.js';
import { BindingRepository } from './modules/liff/binding.repository.js';
import { BindingService } from './modules/liff/binding.service.js';
import { BindingController } from './modules/liff/binding.controller.js';
import { SchoolProvider } from './modules/liff/school.provider.js';
import { LiffController } from './modules/liff/liff.controller.js';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { loadConfig } from './config/env.js';
import { assertRuntimeKey } from '../../shared/runtime-key-guard.mjs';
import { LineRepository } from './modules/line/line.repository.js';
import { LineProvider } from './modules/line/line.provider.js';
import { LineService } from './modules/line/line.service.js';
import { LineController } from './modules/line/line.controller.js';
import { lineRouter } from './modules/line/line.router.js';
import { publicRouter } from './modules/ingress/public.router.js';
import { startGateway, stopGateway, type GatewayRuntime } from './server-lifecycle.js';

import { TaskRepository } from './modules/tasks/task.repository.js';
import { TaskService } from './modules/tasks/task.service.js';
import { TaskController } from './modules/tasks/task.controller.js';
import { DispatchProvider } from './modules/tasks/dispatch.provider.js';
import { OfficialReader } from './modules/search/official-reader.js';
import { SearchProvider } from './modules/search/search.provider.js';
import { TaskWorker } from './modules/tasks/task.worker.js';
import {KnowledgeController} from './modules/knowledge/knowledge.controller.js';
import {KnowledgeService} from './modules/knowledge/knowledge.service.js';

const config = loadConfig();
const pool = new Pool({ connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,statement_timeout:5000 });
pool.on('error',() => console.error('Database connection unavailable'));
await assertRuntimeKey(pool,process.env.APP_MASTER_KEY).catch(async error=>{await pool.end();throw error;});
const identities=new LineRepository(pool,config.sessionSecret,config.liffId);
const provider=new LineProvider(config.channelId,config.accessToken);
const tasks=new TaskRepository(pool,config.sessionSecret,config.liffId);
const service = new LineService(identities,provider);
const search=config.hosts && config.braveKey?new SearchProvider(config.braveKey,new OfficialReader(config.hosts)):undefined;
const school=config.school?new SchoolProvider(config.school.origin,config.school.token):undefined;
const controller=new TaskController(new TaskService(tasks,identities,search,school,config.grounding?new N8nGroundingProvider(config.grounding):undefined),config.serviceToken);
const dispatch=new DispatchProvider(config.webhookUrl,config.webhookToken);
const worker=new TaskWorker(tasks,(task,signal)=>dispatch.dispatch(task,signal),(user,reply,key)=>provider.push(user,reply,key),()=>console.error('Task processing unavailable'),1000,user=>provider.startLoading(user));
const liff=config.publicOrigin && config.liffId?new LiffController(config.publicOrigin,config.liffId):undefined;
const bindings=new BindingRepository(pool);
const binding=config.publicOrigin?new BindingController(new BindingService(bindings,provider,school),config.publicOrigin,bindings,tasks):undefined;
const knowledge=new KnowledgeController(new KnowledgeService(pool),config.serviceToken);
const server = createServer(lineRouter(new LineController(service,config.channelSecret,config.destination,config.publicOrigin),controller,liff,binding,knowledge));
server.requestTimeout=40_000; server.headersTimeout=10_000;
// Public listener exists only with a validated PUBLIC_ORIGIN; it proxies solely through publicRouter to fixed loopback.
const PUBLIC_PORT=3101;
if(config.publicOrigin && config.port!==3100){await pool.end();throw new Error('PUBLIC_GATEWAY_REQUIRES_PORT_3100');}
const publicServer=config.publicOrigin?createServer(publicRouter(config.publicOrigin,config.liffId,fetch,'http://127.0.0.1:3100')):undefined;
if(publicServer){publicServer.requestTimeout=45_000;publicServer.headersTimeout=15_000;}
const runtime:GatewayRuntime={
  internal:{server,port:config.port,host:config.host},
  public:publicServer?{server:publicServer,port:PUBLIC_PORT,host:config.host}:undefined,
  startWorker:()=>worker.start(),stopWorker:()=>worker.stop(),endPool:()=>pool.end(),
};
await startGateway(runtime);
console.log(publicServer?'Gateway, public ingress and task worker ready':'Gateway and task worker ready');
let shuttingDown=false;
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => {
  if(shuttingDown)return;
  shuttingDown=true;
  void (async()=>{
    await stopGateway(runtime);
  })().catch(()=>{console.error('Gateway shutdown failed');process.exitCode=1;});
});
