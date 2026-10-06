import type { BindingController } from '../liff/binding.controller.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { Fault } from '../../utils/fault.js';
import { json } from '../../utils/http.js';
import type { GeminiController } from '../gemini/gemini.controller.js';
import type { TaskController } from '../tasks/task.controller.js';
import type { LiffController } from '../liff/liff.controller.js';
import type { LineController } from './line.controller.js';
import type {KnowledgeController} from '../knowledge/knowledge.controller.js';

export function lineRouter(controller: LineController,tasks?:TaskController,gemini?:GeminiController,liff?:LiffController,binding?:BindingController,knowledge?:KnowledgeController) {
  return async (req: IncomingMessage,res: ServerResponse) => {
    try {
      const pagePath=req.url?.split('?')[0];
      if(req.method==='POST' && binding && (req.url==='/liff/identity'||req.url==='/liff/bind'||req.url==='/liff/result')) return await binding.handle(req.url==='/liff/identity'?'identity':req.url==='/liff/result'?'result':'bind',req,res);
      if(req.method==='GET' && liff && pagePath && ['/liff','/liff/','/liff/config','/liff/app.js'].includes(pagePath)) return liff.handle(pagePath,res);
      if(req.method==='POST' && req.url?.startsWith('/providers/gemini/') && gemini) return await gemini.relay(req,res);
      const taskPath=req.url?.match(/^\/internal\/v1\/agent\/(prepare|tool|complete)$/)?.[1];
      const knowledgePath=req.url?.match(/^\/internal\/v1\/knowledge\/(prepare|publish)$/)?.[1];
      if(req.method==='POST' && knowledge && (knowledgePath==='prepare'||knowledgePath==='publish'))return await knowledge.handle(knowledgePath,req,res);
      if(req.method==='POST' && tasks && (taskPath==='prepare' || taskPath==='tool' || taskPath==='complete')) return await tasks.handle(taskPath,req,res);
      if (req.method === 'GET' && req.url === '/health/live') return json(res,200,{ok:true});
      if (req.method === 'POST' && req.url === '/line/webhook') return await controller.webhook(req,res);
      if (req.method === 'POST' && req.url === '/liff/identity') return await controller.identity(req,res);
      json(res,404,{error:'NOT_FOUND'});
    } catch (error) {
      if (res.destroyed) return;
      const status = error instanceof Fault ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
      json(res,status,{ error: error instanceof Fault ? error.code : status === 400 ? 'INVALID_REQUEST' : 'SERVICE_UNAVAILABLE' });
    }
  };
}
