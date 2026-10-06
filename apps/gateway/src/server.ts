import {GoogleGroundingProvider} from './modules/search/google-grounding.provider.js';
import { BindingRepository } from './modules/liff/binding.repository.js';
import { BindingService } from './modules/liff/binding.service.js';
import { BindingController } from './modules/liff/binding.controller.js';
import { SchoolProvider } from './modules/liff/school.provider.js';
import { LiffController } from './modules/liff/liff.controller.js';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { loadConfig } from './config/env.js';
import { LineRepository } from './modules/line/line.repository.js';
import { LineProvider } from './modules/line/line.provider.js';
import { LineService } from './modules/line/line.service.js';
import { LineController } from './modules/line/line.controller.js';
import { lineRouter } from './modules/line/line.router.js';

import { TaskRepository } from './modules/tasks/task.repository.js';
import { TaskService } from './modules/tasks/task.service.js';
import { TaskController } from './modules/tasks/task.controller.js';
import { DispatchProvider } from './modules/tasks/dispatch.provider.js';
import { GeminiController } from './modules/gemini/gemini.controller.js';
import { GeminiProvider } from './modules/gemini/gemini.provider.js';
import { OfficialReader } from './modules/search/official-reader.js';
import { SearchProvider } from './modules/search/search.provider.js';
import { BudgetRepository } from './modules/budget/budget.repository.js';
import { TaskWorker } from './modules/tasks/task.worker.js';
import {KnowledgeController} from './modules/knowledge/knowledge.controller.js';
import {KnowledgeService} from './modules/knowledge/knowledge.service.js';

const config = loadConfig();
const pool = new Pool({ connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,statement_timeout:5000 });
pool.on('error',() => console.error('Database connection unavailable'));
const identities=new LineRepository(pool,config.sessionSecret,config.liffId);
const provider=new LineProvider(config.channelId,config.accessToken);
const tasks=new TaskRepository(pool,config.sessionSecret,config.liffId);
const service = new LineService(identities,provider);
const search=config.hosts && config.braveKey?new SearchProvider(config.braveKey,new OfficialReader(config.hosts)):undefined;
const budget=new BudgetRepository(pool,config.dailyBudgetMicroUsd,config.totalBudgetMicroUsd);
const gemini=config.gemini?new GeminiController(new GeminiProvider(config.gemini,budget)):undefined;
const school=config.school?new SchoolProvider(config.school.origin,config.school.token):undefined;
const controller=new TaskController(new TaskService(tasks,identities,search,budget,config.searchCostMicroUsd,school,config.grounding?new GoogleGroundingProvider(config.grounding,budget):undefined),config.serviceToken);
let worker:TaskWorker|undefined;
if(config.enabled && config.webhookUrl && config.webhookToken) {
  const dispatch=new DispatchProvider(config.webhookUrl,config.webhookToken);
  worker=new TaskWorker(tasks,(task,signal)=>dispatch.dispatch(task,signal),(user,reply,key)=>provider.push(user,reply,key),()=>console.error('Task processing unavailable'),1000,user=>provider.startLoading(user));
}
const liff=config.publicOrigin && config.liffId?new LiffController(config.publicOrigin,config.liffId):undefined;
const bindings=new BindingRepository(pool);
const binding=config.publicOrigin?new BindingController(new BindingService(bindings,provider,school),config.publicOrigin,bindings,tasks):undefined;
const knowledge=new KnowledgeController(new KnowledgeService(pool),config.serviceToken);
const server = createServer(lineRouter(new LineController(service,config.channelSecret,config.destination,config.publicOrigin),controller,gemini,liff,binding,knowledge));
server.requestTimeout=40_000; server.headersTimeout=10_000;
server.listen(config.port,config.host,() => {worker?.start();console.log(config.enabled?'Gateway and task worker ready':'Gateway ready; task worker disabled');});
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => {
  server.close();
  void (async()=>{await worker?.stop();await pool.end();})();
});
