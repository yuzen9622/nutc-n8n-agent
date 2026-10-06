import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PREFIX, BODY_LIMIT, Fault, HTTP } from '../../constants/index.js';
import type { Config, Scope } from '../../config/env.js';
import { errorResponse } from '../../utils/http.js';
import { createController } from './mock.controller.js';
import type { Input } from './mock.controller.js';
import * as schemas from './mock.schema.js';

type Route = {method:string;pattern:RegExp;scope:Scope;action:string;schema:z.ZodType};
const routes:Route[]=[
  {method:'POST',pattern:/^\/agent\/prepare$/,scope:'task',action:'agentPrepare',schema:schemas.agentPrepareSchema},
  {method:'POST',pattern:/^\/agent\/tool$/,scope:'task',action:'agentTool',schema:schemas.agentToolSchema},
  {method:'POST',pattern:/^\/agent\/complete$/,scope:'task',action:'agentComplete',schema:schemas.agentCompleteSchema},
  {method:'POST',pattern:/^\/demo\/tasks$/,scope:'demo',action:'demo',schema:schemas.demoSchema},
  {method:'GET',pattern:/^\/demo\/tasks\/([^/]+)\/delivery$/,scope:'demo',action:'delivery',schema:schemas.emptySchema},
  ...Object.entries({claim:schemas.emptySchema,plan:schemas.emptySchema,complete:schemas.completeSchema,fail:schemas.failSchema}).map(([action,schema])=>({method:'POST',pattern:new RegExp(`^/tasks/([^/]+)/${action}$`),scope:'task' as const,action,schema})),
  ...(['public','personal'] as const).flatMap(action=>Object.entries(action==='public'?schemas.stageSchemas:schemas.personalSchemas).map(([stage,schema])=>({method:'POST',pattern:new RegExp(`^/tasks/([^/]+)/${action}/(${stage})$`),scope:'task' as const,action,schema}))),
  {method:'POST',pattern:/^\/maintenance\/cleanup$/,scope:'maintenance',action:'cleanup',schema:schemas.emptySchema},
  {method:'GET',pattern:/^\/maintenance\/health$/,scope:'maintenance',action:'health',schema:schemas.emptySchema},
  {method:'POST',pattern:/^\/observability\/workflow-errors$/,scope:'observability',action:'error',schema:schemas.errorSchema},
  {method:'POST',pattern:/^\/knowledge\/sync\/start$/,scope:'knowledge',action:'syncStart',schema:schemas.syncStartSchema},
  {method:'POST',pattern:/^\/knowledge\/sync\/(next|fetch|parse|embed|publish|record|finish)$/,scope:'knowledge',action:'sync',schema:schemas.syncSchema},
];
export function createRouter(config:Config,controller:ReturnType<typeof createController>) {
  return async (req:IncomingMessage,res:ServerResponse) => {
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      if(req.url==='/health/live' && req.method==='GET') {res.end(JSON.stringify({success:true,data:{live:true,synthetic:true}}));return;}
      const path=req.url?.startsWith(PREFIX)?req.url.slice(PREFIX.length):'';
      const route=routes.find(r=>r.method===req.method&&r.pattern.test(path));if(!route)throw new Fault(HTTP.NOT_FOUND,'NOT_FOUND');
      const token=req.headers.authorization??'';const expected=`Bearer ${config.tokens[route.scope]}`;
      if(Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw new Fault(HTTP.UNAUTHORIZED,'SERVICE_DENIED');
      let raw='';for await(const chunk of req) {raw+=chunk;if(Buffer.byteLength(raw)>BODY_LIMIT)throw new Fault(HTTP.TOO_LARGE,'BODY_TOO_LARGE');}
      let body;try {body=route.schema.parse(raw?JSON.parse(raw):{});} catch {throw new Fault(HTTP.BAD_REQUEST,'INVALID_INPUT');}
      const match=route.pattern.exec(path)!;
      const input:Input={action:route.action,taskId:match[1]??'',stage:route.action==='sync'?match[1]!:match[2]??'',body:body as Record<string,unknown>,auth:{capability:String(req.headers['x-task-capability']??''),lease:String(req.headers['x-task-lease']??'')}};
      res.end(JSON.stringify(controller(input)));
    } catch(e) {res.statusCode=e instanceof Fault?e.status:HTTP.INTERNAL;res.end(JSON.stringify(errorResponse(e instanceof Fault?e.code:'INTERNAL_ERROR')));}
  };
}
